import type { AddressInfo } from 'net';
import type { Server } from 'http';
import express, { Express } from 'express';
import { createServer, errorHandler, ServerOptions } from '../src/server';

/**
 * The server is exercised over a real socket on an ephemeral port rather than
 * through a test-only request helper, so the body parsers, the route and the
 * error middleware all run exactly as they do in production.
 */
async function withApp<T>(app: Express, run: (baseUrl: string) => Promise<T>): Promise<T> {
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const { port } = server.address() as AddressInfo;
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const withServer = <T,>(options: ServerOptions, run: (baseUrl: string) => Promise<T>) =>
  withApp(createServer(options), run);

/** `Response.json()` is typed as `unknown` under Node's fetch types. */
async function json(res: { json(): Promise<unknown> }): Promise<any> {
  return (await res.json()) as any;
}

const csv = [
  'Date,Narration,Withdrawal,Deposit,Chq/Ref No',
  '2026-04-10,UPI/ACME SUPPLIES,1500,,UTR123456789012',
].join('\n');

const ledger = [
  {
    id: 'L1',
    date: '2026-04-10',
    description: 'ACME Supplies',
    amount: 1500,
    direction: 'debit',
    reference: 'UTR123456789012',
  },
];

const postJson = (baseUrl: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

describe('POST /api/reconcile', () => {
  it('reconciles a statement against the ledger', async () => {
    await withServer({}, async (baseUrl) => {
      const res = await postJson(baseUrl, '/api/reconcile', { csv, ledger });
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.summary).toMatchObject({ statementLines: 1, matched: 1 });
    });
  });

  it('answers 400 when csv is missing', async () => {
    await withServer({}, async (baseUrl) => {
      const res = await postJson(baseUrl, '/api/reconcile', { ledger });
      expect(res.status).toBe(400);
      expect((await json(res)).error).toMatch(/"csv" to be a string/);
    });
  });

  it('answers 400 when ledger is not an array', async () => {
    await withServer({}, async (baseUrl) => {
      const res = await postJson(baseUrl, '/api/reconcile', { csv, ledger: 'nope' });
      expect(res.status).toBe(400);
      expect((await json(res)).error).toMatch(/"ledger" to be an array/);
    });
  });

  it('answers 400 for a ledger entry with a bad date', async () => {
    await withServer({}, async (baseUrl) => {
      const res = await postJson(baseUrl, '/api/reconcile', {
        csv,
        ledger: [{ ...ledger[0], date: '10-04-2026' }],
      });
      expect(res.status).toBe(400);
      expect((await json(res)).error).toMatch(/ledger\[0\]\.date/);
    });
  });

  it('answers 400, not 500, for an unreadable statement', async () => {
    await withServer({}, async (baseUrl) => {
      const res = await postJson(baseUrl, '/api/reconcile', {
        csv: 'Narration,Withdrawal\nUPI/ACME,1500',
        ledger,
      });
      expect(res.status).toBe(400);
      expect((await json(res)).error).toMatch(/missing required column/);
    });
  });

  it('answers 413 for a statement beyond the row limit', async () => {
    await withServer({ maxStatementLines: 5 }, async (baseUrl) => {
      const long = ['Date,Narration,Withdrawal,Deposit']
        .concat(Array.from({ length: 20 }, (_, i) => `2026-04-10,ROW ${i},1,`))
        .join('\n');
      const res = await postJson(baseUrl, '/api/reconcile', { csv: long, ledger });
      expect(res.status).toBe(413);
    });
  });

  it('counts rows the way the parser splits them, including a bare CR', async () => {
    await withServer({ maxStatementLines: 5 }, async (baseUrl) => {
      // Classic-Mac line endings. Counting only "\n" would see one row here
      // and wave a twenty-row statement straight through the bound.
      const long = ['Date,Narration,Withdrawal,Deposit']
        .concat(Array.from({ length: 20 }, (_, i) => `2026-04-10,ROW ${i},1,`))
        .join('\r');
      const res = await postJson(baseUrl, '/api/reconcile', { csv: long, ledger });
      expect(res.status).toBe(413);
    });
  });

  it('answers 413 for a ledger beyond the entry limit', async () => {
    await withServer({ maxLedgerEntries: 5 }, async (baseUrl) => {
      const many = Array.from({ length: 20 }, (_, i) => ({ ...ledger[0], id: `L${i}` }));
      const res = await postJson(baseUrl, '/api/reconcile', { csv, ledger: many });
      expect(res.status).toBe(413);
      expect((await json(res)).error).toMatch(/Ledger has 20 entries/);
    });
  });

  it('answers 413 when the work is too large even though each side is inside its limit', async () => {
    // 4 lines and 4 entries: both well under their own caps, 16 comparisons
    // over a limit of 10. The per-side limits cannot express this, which is
    // the whole reason the product is bounded separately.
    await withServer(
      { maxStatementLines: 100, maxLedgerEntries: 100, maxReconcileWork: 10 },
      async (baseUrl) => {
        const statement = ['Date,Narration,Withdrawal,Deposit']
          .concat(Array.from({ length: 4 }, (_, i) => `2026-04-10,ROW ${i},1,`))
          .join('\n');
        const entries = Array.from({ length: 4 }, (_, i) => ({ ...ledger[0], id: `L${i}` }));
        const res = await postJson(baseUrl, '/api/reconcile', { csv: statement, ledger: entries });
        expect(res.status).toBe(413);
        expect((await json(res)).error).toMatch(/is 16 comparisons; the limit is 10/);
      }
    );
  });

  it('answers 400, not 500, for a statement date that is not an ISO date', async () => {
    await withServer({}, async (baseUrl) => {
      const res = await postJson(baseUrl, '/api/reconcile', {
        csv: 'Date,Narration,Withdrawal,Deposit\n10/04/2026,ACME,1500,',
        ledger,
      });
      expect(res.status).toBe(400);
      expect((await json(res)).error).toMatch(/not an ISO date/);
    });
  });

  it('accepts a null reference, which is what an export means by "none"', async () => {
    await withServer({}, async (baseUrl) => {
      const res = await postJson(baseUrl, '/api/reconcile', {
        csv,
        ledger: [{ ...ledger[0], reference: null }],
      });
      expect(res.status).toBe(200);
      // Still reconciles, on amount and narration rather than on reference.
      expect((await json(res)).summary).toMatchObject({ matched: 1 });
    });
  });

  it('answers 400, not 500, for a ledger reference that is not a string', async () => {
    // matchesByReference calls .trim() on it, so a number used to reach the
    // matcher and come back as a 500 on a plainly malformed request.
    await withServer({}, async (baseUrl) => {
      const res = await postJson(baseUrl, '/api/reconcile', {
        csv,
        ledger: [{ ...ledger[0], reference: 123 }],
      });
      expect(res.status).toBe(400);
      expect((await json(res)).error).toMatch(/ledger\[0\]\.reference/);
    });
  });
});

describe('errorHandler', () => {
  /**
   * The real routes validate their input, so every failure they can produce is
   * a 4xx — posting bad input never reaches the 500 branch and so proves
   * nothing about it. The handler is mounted here behind a route that throws
   * on purpose, which is the only way to actually see what a caller is told
   * when something unexpected goes wrong.
   */
  it('returns no stack trace or internal message on an unexpected error', async () => {
    const app = express();
    app.post('/boom', () => {
      const err = new Error('ENOENT: /srv/ledger-reconcile/src/server.ts missing');
      err.stack = 'Error: secret\n    at /srv/ledger-reconcile/src/server.ts:1:1';
      throw err;
    });
    app.use(errorHandler);

    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await withApp(app, async (baseUrl) => {
        const res = await fetch(`${baseUrl}/boom`, { method: 'POST' });
        expect(res.status).toBe(500);
        const body = await json(res);
        expect(body).toEqual({ error: 'Internal Server Error' });
        expect(JSON.stringify(body)).not.toContain('src/server');
        expect(JSON.stringify(body)).not.toContain('ENOENT');
      });
      // It is not silently swallowed either — the operator still gets it.
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it('keeps a 4xx status and its message', async () => {
    const app = express();
    app.post('/bad', () => {
      throw Object.assign(new Error('entity too large'), { status: 413 });
    });
    app.use(errorHandler);

    await withApp(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/bad`, { method: 'POST' });
      expect(res.status).toBe(413);
      // Not an HttpError, so the message is replaced rather than echoed back.
      expect((await json(res)).error).toBe('Payload Too Large');
    });
  });
});

describe('POST /api/parse', () => {
  it('parses a CSV body', async () => {
    await withServer({}, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/parse`, {
        method: 'POST',
        headers: { 'content-type': 'text/csv' },
        body: csv,
      });
      expect(res.status).toBe(200);
      expect((await json(res)).lines).toHaveLength(1);
    });
  });

  it('answers 400, not 500, when the body is not CSV text', async () => {
    await withServer({}, async (baseUrl) => {
      const res = await postJson(baseUrl, '/api/parse', { csv });
      expect(res.status).toBe(400);
      expect((await json(res)).error).toMatch(/text\/csv/);
    });
  });
});

describe('authentication', () => {
  it('rejects a request with no bearer token when one is configured', async () => {
    await withServer({ apiToken: 'secret' }, async (baseUrl) => {
      const res = await postJson(baseUrl, '/api/reconcile', { csv, ledger });
      expect(res.status).toBe(401);
    });
  });

  it('turns an anonymous caller away before buffering their body', async () => {
    // The limit is smaller than the body, so the body parser would answer 413
    // if it ran first. A 401 is the proof that the token is checked before any
    // of the request is read or parsed on an anonymous caller's behalf.
    await withServer({ apiToken: 'secret', bodyLimit: '1b' }, async (baseUrl) => {
      const res = await postJson(baseUrl, '/api/reconcile', { csv, ledger });
      expect(res.status).toBe(401);
    });
  });

  it('accepts a request carrying the token', async () => {
    await withServer({ apiToken: 'secret' }, async (baseUrl) => {
      const res = await postJson(
        baseUrl,
        '/api/reconcile',
        { csv, ledger },
        { authorization: 'Bearer secret' }
      );
      expect(res.status).toBe(200);
    });
  });
});
