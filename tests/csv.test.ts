import { parseStatementCsv, splitCsvLine } from '../src/csv';

describe('splitCsvLine', () => {
  it('splits a plain line', () => {
    expect(splitCsvLine('2026-04-10,ACME,1500')).toEqual(['2026-04-10', 'ACME', '1500']);
  });

  it('keeps a comma inside a quoted field', () => {
    expect(splitCsvLine('2026-04-10,"ACME SUPPLIES, PVT LTD",1500'))
      .toEqual(['2026-04-10', 'ACME SUPPLIES, PVT LTD', '1500']);
  });

  it('unescapes a doubled quote', () => {
    expect(splitCsvLine('"he said ""hi""",2')).toEqual(['he said "hi"', '2']);
  });
});

describe('parseStatementCsv', () => {
  const csv = [
    'Date,Narration,Withdrawal,Deposit,Chq/Ref No',
    '2026-04-10,UPI/ACME SUPPLIES,1500,,UTR123456789012',
    '2026-04-11,SALARY CREDIT,,85000,',
  ].join('\n');

  it('reads rows into statement lines', () => {
    const lines = parseStatementCsv(csv);
    expect(lines).toHaveLength(2);
  });

  it('reads a withdrawal as a debit', () => {
    const [first] = parseStatementCsv(csv);
    expect(first).toMatchObject({
      date: '2026-04-10',
      description: 'UPI/ACME SUPPLIES',
      amount: 1500,
      direction: 'debit',
      reference: 'UTR123456789012',
    });
  });

  it('reads a deposit as a credit', () => {
    const [, second] = parseStatementCsv(csv);
    expect(second).toMatchObject({ amount: 85000, direction: 'credit' });
  });

  it('returns nothing for an empty file', () => {
    expect(parseStatementCsv('')).toEqual([]);
  });
});
