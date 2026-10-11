import { reconcile } from '../src/reconcile';
import { LedgerEntry, StatementLine } from '../src/types';

const line = (over: Partial<StatementLine> = {}): StatementLine => ({
  id: 's1',
  date: '2026-04-10',
  description: 'UPI/ACME SUPPLIES',
  amount: 1500,
  direction: 'debit',
  ...over,
});

const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: 'l1',
  date: '2026-04-10',
  description: 'ACME SUPPLIES',
  amount: 1500,
  direction: 'debit',
  ...over,
});

describe('reconcile', () => {
  it('pairs a statement line with its ledger entry on an exact match', () => {
    const result = reconcile([line()], [entry()]);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]).toMatchObject({
      statementId: 's1',
      ledgerId: 'l1',
      strategy: 'exact',
    });
    expect(result.unmatchedStatement).toHaveLength(0);
    expect(result.unmatchedLedger).toHaveLength(0);
  });

  it('prefers a shared bank reference over a narration match', () => {
    const result = reconcile(
      [line({ reference: 'UTR9988776655' })],
      [
        entry({ id: 'l-narration' }),
        entry({ id: 'l-reference', description: 'NOTHING ALIKE', reference: 'UTR9988776655' }),
      ]
    );

    expect(result.matched[0].ledgerId).toBe('l-reference');
    expect(result.matched[0].strategy).toBe('reference');
  });

  it('tolerates the books and the bank disagreeing by a day', () => {
    const result = reconcile([line({ date: '2026-04-10' })], [entry({ date: '2026-04-11' })]);

    expect(result.matched).toHaveLength(1);
  });

  it('refuses to match once the dates drift beyond tolerance', () => {
    const result = reconcile(
      [line({ date: '2026-04-10' })],
      [entry({ date: '2026-04-20' })]
    );

    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedStatement).toHaveLength(1);
    expect(result.unmatchedLedger).toHaveLength(1);
  });

  it('never lets one ledger entry settle two statement lines', () => {
    const result = reconcile(
      [line({ id: 's1' }), line({ id: 's2' })],
      [entry({ id: 'l1' })]
    );

    expect(result.matched).toHaveLength(1);
    expect(result.unmatchedStatement.map((l) => l.id)).toEqual(['s2']);
  });

  it('does not match a debit against a credit of the same size', () => {
    const result = reconcile([line({ direction: 'debit' })], [entry({ direction: 'credit' })]);

    expect(result.matched).toHaveLength(0);
  });

  it('reports both sides as unmatched when there is nothing to pair', () => {
    const result = reconcile([line()], []);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedStatement).toHaveLength(1);
  });
});
