import express, { NextFunction, Request, Response } from 'express';
import { CsvParseError, parseStatementCsv } from './csv';
import { reconcile } from './reconcile';
import { LedgerEntry } from './types';

/**
 * HTTP surface for the reconciliation library.
 *
 * POST /api/reconcile accepts a statement as raw CSV text plus the ledger
 * entries to reconcile it against, and returns the run's outcome.
 */

/** An error carrying the status the client should see. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface ServerOptions {
  /**
   * When set, every request must present `Authorization: Bearer <token>`.
   * These endpoints accept and return financial records, so this should be
   * set anywhere the server is reachable by anything but the local machine.
   */
  apiToken?: string;
  /** Largest body accepted, as an express `limit` string. */
  bodyLimit?: string;
  /** Largest statement accepted, in rows. */
  maxStatementLines?: number;
  /** Largest ledger accepted, in entries. */
  maxLedgerEntries?: number;
  /**
   * Largest run accepted, as statement lines × ledger entries — the number of
   * comparisons the matcher will make, which is the real cost of a request.
   */
  maxReconcileWork?: number;
}

/**
 * A real statement for a busy current account is a few MB. The old 512mb
 * limit let a handful of concurrent requests exhaust the heap, because
 * express buffers the whole body before the handler runs.
 */
const DEFAULT_BODY_LIMIT = '10mb';

/**
 * Parsing and reconciliation are synchronous and reconciliation rescans the
 * ledger per statement line, so a large enough statement would hold the event
 * loop for the whole run and stall every other request. Bounding the input is
 * what keeps that to a known, short cost; a workload that genuinely needs
 * larger files wants a job queue and a worker, not a bigger number here.
 */
const DEFAULT_MAX_STATEMENT_LINES = 50_000;

/**
 * `reconcile` walks the ledger once per statement line, so the work is the
 * product of the two sides. Bounding only the statement leaves the other half
 * of that product open: a one-row statement with a million ledger entries is a
 * small body that still takes the event loop away from everyone else.
 */
const DEFAULT_MAX_LEDGER_ENTRIES = 50_000;

/**
 * The per-side limits bound memory and validation. They do not bound the run:
 * 50,000 against 50,000 is 2.5 billion comparisons, which is seconds of a
 * blocked event loop, not the "known, short cost" the limits were meant to
 * buy. The product is the thing to cap, so it is capped here directly.
 *
 * Five million comparisons is a few tens of milliseconds, and covers the real
 * shapes — a month of one account against a year of books. A workload past
 * that wants an indexed matcher or a job queue and a worker; it does not want
 * a larger number here, and saying so is more honest than quietly allowing it.
 */
const DEFAULT_MAX_RECONCILE_WORK = 5_000_000;

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, `Expected "${field}" to be a string.`);
  }
  return value;
}

function requireLedger(value: unknown, maxEntries: number): LedgerEntry[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, 'Expected "ledger" to be an array of ledger entries.');
  }
  if (value.length > maxEntries) {
    throw new HttpError(
      413,
      `Ledger has ${value.length} entries; the limit is ${maxEntries}.`
    );
  }
  value.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new HttpError(400, `ledger[${index}] is not an object.`);
    }
    const { id, date, description, amount, direction } = entry as Partial<LedgerEntry>;
    if (typeof id !== 'string' || id === '') {
      throw new HttpError(400, `ledger[${index}].id must be a non-empty string.`);
    }
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new HttpError(400, `ledger[${index}].date must be an ISO date (YYYY-MM-DD).`);
    }
    if (typeof description !== 'string') {
      throw new HttpError(400, `ledger[${index}].description must be a string.`);
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      throw new HttpError(400, `ledger[${index}].amount must be a finite number.`);
    }
    if (direction !== 'debit' && direction !== 'credit') {
      throw new HttpError(400, `ledger[${index}].direction must be "debit" or "credit".`);
    }
    // Optional, but if present it has to be a string: `matchesByReference`
    // calls `.trim()` on it, so a number here is a TypeError inside the
    // matcher — a 500 for what is plainly a malformed request.
    const { reference } = entry as Partial<LedgerEntry>;
    if (reference !== undefined && typeof reference !== 'string') {
      throw new HttpError(400, `ledger[${index}].reference must be a string when present.`);
    }
  });
  return value as LedgerEntry[];
}

/**
 * Turns an error into a response body a client is allowed to see.
 *
 * Exported so it can be mounted on a throwaway app behind a route that throws
 * on purpose. The 500 branch is for the failure nobody anticipated — by
 * definition not something a crafted request reliably reaches — so a test that
 * only posts bad input is testing the validators, not this. Posting bad input
 * gets a 4xx, which is the point of the validators and is covered separately.
 */
export function errorHandler(
  err: Error & { status?: number },
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // express's own body parsers set `status` too, so malformed JSON stays a
  // 400 and an oversized body stays a 413 instead of all becoming 500s.
  const status =
    typeof err.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 500;

  if (status === 500) {
    // Never return `err.stack` or an internal message: it hands a caller the
    // file layout and internals of a financial service. Log it instead.
    console.error('[ledger-reconcile] unhandled error', err);
    res.status(500).json({ error: 'Internal Server Error' });
    return;
  }

  const safe = err instanceof HttpError || err instanceof CsvParseError;
  const fallback =
    status === 413 ? 'Payload Too Large' : status === 401 ? 'Unauthorized' : 'Bad Request';
  res.status(status).json({ error: safe ? err.message : fallback });
}

export function createServer(options: ServerOptions = {}) {
  const {
    apiToken,
    bodyLimit = DEFAULT_BODY_LIMIT,
    maxStatementLines = DEFAULT_MAX_STATEMENT_LINES,
    maxLedgerEntries = DEFAULT_MAX_LEDGER_ENTRIES,
    maxReconcileWork = DEFAULT_MAX_RECONCILE_WORK,
  } = options;

  const app = express();

  // Authentication runs before the body parsers, not after. Registered the
  // other way round, an anonymous caller still gets the whole body buffered
  // and JSON-parsed on their behalf before being told to go away — which is
  // the cheap half of a denial of service, available without a token.
  if (apiToken) {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      const header = req.get('authorization') ?? '';
      if (header !== `Bearer ${apiToken}`) {
        next(new HttpError(401, 'Unauthorized.'));
        return;
      }
      next();
    });
  }

  app.use(express.text({ type: 'text/csv', limit: bodyLimit }));
  app.use(express.json({ limit: bodyLimit }));

  const guardSize = (csv: string) => {
    // Cheap upper bound on the row count before any parsing work is done.
    // Counting only "\n" would undercount a classic-Mac style file, where a
    // bare "\r" ends the line — the parser breaks rows on it, so the guard
    // has to see it too or the bound is one the input can walk straight past.
    const approximateRows = csv.length === 0 ? 0 : (csv.match(/\r\n|\r|\n/g)?.length ?? 0) + 1;
    if (approximateRows > maxStatementLines) {
      throw new HttpError(
        413,
        `Statement has roughly ${approximateRows} rows; the limit is ${maxStatementLines}.`
      );
    }
  };

  app.post('/api/reconcile', (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body;
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw new HttpError(400, 'Expected a JSON object with "csv" and "ledger".');
      }

      const csv = requireString((body as Record<string, unknown>).csv, 'csv');
      const ledger = requireLedger((body as Record<string, unknown>).ledger, maxLedgerEntries);
      guardSize(csv);

      const statement = parseStatementCsv(csv);

      // Checked once the statement row count is exact rather than estimated,
      // and before `reconcile` is entered, because the cost being bounded is
      // the one thing that cannot be interrupted once it has started.
      const work = statement.length * ledger.length;
      if (work > maxReconcileWork) {
        throw new HttpError(
          413,
          `Reconciling ${statement.length} statement lines against ${ledger.length} ` +
            `ledger entries is ${work} comparisons; the limit is ${maxReconcileWork}.`
        );
      }

      const result = reconcile(statement, ledger);

      res.json({
        summary: {
          statementLines: statement.length,
          matched: result.matched.length,
          outstandingOnStatement: result.unmatchedStatement.length,
          outstandingInLedger: result.unmatchedLedger.length,
        },
        ...result,
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/parse', (req: Request, res: Response, next: NextFunction) => {
    try {
      // express.text only populates a string body for Content-Type: text/csv.
      // Anything else leaves an object here, which is the client's mistake and
      // should read as a 400 rather than as a server error.
      if (typeof req.body !== 'string') {
        throw new HttpError(400, 'Expected a CSV body sent as Content-Type: text/csv.');
      }
      guardSize(req.body);
      res.json({ lines: parseStatementCsv(req.body) });
    } catch (err) {
      next(err);
    }
  });

  app.use(errorHandler);

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const apiToken = process.env.API_TOKEN;
  if (!apiToken) {
    console.warn(
      '[ledger-reconcile] API_TOKEN is not set; the endpoints are unauthenticated. ' +
        'Do not expose this process beyond localhost.'
    );
  }
  createServer({ apiToken }).listen(port, () => {
    console.log(`ledger-reconcile listening on ${port}`);
  });
}
