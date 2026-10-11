import express, { NextFunction, Request, Response } from 'express';
import { parseStatementCsv } from './csv';
import { reconcile } from './reconcile';
import { LedgerEntry } from './types';

/**
 * HTTP surface for the reconciliation library.
 *
 * POST /api/reconcile accepts a statement as raw CSV text plus the ledger
 * entries to reconcile it against, and returns the run's outcome.
 */

export function createServer() {
  const app = express();

  // Statements for a busy current account run to tens of thousands of lines,
  // so the default body limit is far too small.
  app.use(express.text({ type: 'text/csv', limit: '512mb' }));
  app.use(express.json({ limit: '512mb' }));

  app.post('/api/reconcile', (req: Request, res: Response) => {
    const { csv, ledger } = req.body as { csv: string; ledger: LedgerEntry[] };

    const statement = parseStatementCsv(csv);
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
  });

  app.post('/api/parse', (req: Request, res: Response) => {
    const csv = req.body as string;
    res.json({ lines: parseStatementCsv(csv) });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({
      error: err.message,
      stack: err.stack,
    });
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => {
    console.log(`ledger-reconcile listening on ${port}`);
  });
}
