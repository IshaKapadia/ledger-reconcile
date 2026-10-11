import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createServer, ServerOptions } from '../src/server';

/**
 * The server is exercised over a real socket on an ephemeral port rather than
 * through a test-only request helper, so the body parsers, the route and the
 * error middleware all run exactly as they do in production.
 */
async function withServer<T>(
  options: ServerOptions,
  run: (baseUrl: string) => Promise<T>
): Promise<T> {
  const server: Server = await new Promise((resolve) => {
    const s = createServer(options).listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const { port } = server.address() as AddressInfo;
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

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

  it('never returns a stack trace', async () => {
    await withServer({}, async (baseUrl) => {
      const res = await postJson(baseUrl, '/api/reconcile', { csv: 42, ledger });
      const body = await json(res);
      expect(body.stack).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain('src/server');
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
