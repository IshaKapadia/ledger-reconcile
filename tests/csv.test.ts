import { CsvParseError, parseCsv, parseStatementCsv, splitCsvLine } from '../src/csv';

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

describe('parseCsv', () => {
  it('keeps a line break inside a quoted field on one row', () => {
    const rows = parseCsv('Date,Narration\n2026-04-10,"UPI/ACME\nSUPPLIES"');
    expect(rows).toEqual([
      ['Date', 'Narration'],
      ['2026-04-10', 'UPI/ACME\nSUPPLIES'],
    ]);
  });

  it('reads CRLF line endings', () => {
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
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

  // parseFloat stops at the first comma, so this used to read as ₹1.
  it('reads an amount printed with Indian digit grouping', () => {
    const grouped = [
      'Date,Narration,Withdrawal,Deposit',
      '2026-04-12,RENT,"1,50,000.00",',
    ].join('\n');
    expect(parseStatementCsv(grouped)[0]).toMatchObject({
      amount: 150000,
      direction: 'debit',
    });
  });

  // `Number('8.29') === 8.29`, so asserting that on a bare "8.29" would pass
  // whatever the parser did with the paise. These two put the decimal behind
  // something that has to be undone first, and pin the boundary at a paisa.
  it('keeps the paise on a grouped amount', () => {
    const grouped = ['Date,Narration,Withdrawal,Deposit', '2026-04-12,FEE,"1,234.56",'].join('\n');
    expect(parseStatementCsv(grouped)[0].amount).toBe(1234.56);
  });

  it('refuses an amount finer than a paisa rather than rounding it', () => {
    const subPaisa = ['Date,Narration,Withdrawal,Deposit', '2026-04-12,FEE,8.295,'].join('\n');
    expect(() => parseStatementCsv(subPaisa)).toThrow(CsvParseError);
    expect(() => parseStatementCsv(subPaisa)).toThrow(/more precision than a paisa/);
  });

  it('treats a negative withdrawal as a reversal, not a zero credit', () => {
    const reversal = [
      'Date,Narration,Withdrawal,Deposit',
      '2026-04-13,CHARGES REVERSED,-250,',
    ].join('\n');
    expect(parseStatementCsv(reversal)[0]).toMatchObject({
      amount: 250,
      direction: 'credit',
    });
  });

  it('prefers the value date over another date column', () => {
    const twoDates = [
      'Txn Date,Value Date,Narration,Withdrawal,Deposit',
      '2026-04-10,2026-04-12,CHEQUE CLEARED,500,',
    ].join('\n');
    expect(parseStatementCsv(twoDates)[0].date).toBe('2026-04-12');
  });

  it('resolves aliases regardless of case and wording', () => {
    const aliased = [
      'VALUE DATE,particulars,Debit,Credit',
      '2026-04-10,NEFT OUT,100,',
    ].join('\n');
    expect(parseStatementCsv(aliased)[0]).toMatchObject({
      date: '2026-04-10',
      description: 'NEFT OUT',
      amount: 100,
      direction: 'debit',
    });
  });

  describe('rejects a statement it cannot read', () => {
    it('names the missing columns rather than emitting undefined fields', () => {
      const noDate = ['Narration,Withdrawal,Deposit', 'UPI/ACME,1500,'].join('\n');
      expect(() => parseStatementCsv(noDate)).toThrow(CsvParseError);
      expect(() => parseStatementCsv(noDate)).toThrow(/missing required column\(s\): date/);
    });

    it('refuses a row with no amount instead of inventing a zero credit', () => {
      const totalRow = [
        'Date,Narration,Withdrawal,Deposit',
        '2026-04-10,UPI/ACME,1500,',
        '2026-04-30,CLOSING BALANCE,,',
      ].join('\n');
      expect(() => parseStatementCsv(totalRow)).toThrow(/Row 3: no amount/);
    });

    it('refuses a row with both columns filled', () => {
      const both = [
        'Date,Narration,Withdrawal,Deposit',
        '2026-04-10,ODD ROW,100,200',
      ].join('\n');
      expect(() => parseStatementCsv(both)).toThrow(/both withdrawal and deposit/);
    });

    it('refuses a non-numeric amount rather than producing NaN', () => {
      const text = [
        'Date,Narration,Withdrawal,Deposit',
        '2026-04-10,ODD ROW,n/a,',
      ].join('\n');
      expect(() => parseStatementCsv(text)).toThrow(/is not an amount/);
    });

    it('counts the line in the file, not the position after blanks are dropped', () => {
      const withBlank = [
        'Date,Narration,Withdrawal,Deposit',
        '2026-04-10,UPI/ACME,1500,',
        '',
        '2026-04-30,CLOSING BALANCE,,',
      ].join('\n');
      // Dropping the blank line puts the bad row third in the array; it is the
      // fourth line of the file, and that is the one somebody has to open.
      expect(() => parseStatementCsv(withBlank)).toThrow(/Row 4: no amount/);
    });

    it('counts a narration that spans lines as the line it started on', () => {
      const wrapped = [
        'Date,Narration,Withdrawal,Deposit',
        '2026-04-10,"UPI/ACME',
        'SUPPLIES",1500,',
        '2026-04-30,CLOSING BALANCE,,',
      ].join('\n');
      expect(() => parseStatementCsv(wrapped)).toThrow(/Row 4: no amount/);
    });

    it('refuses a row with a blank date', () => {
      const blank = [
        'Date,Narration,Withdrawal,Deposit',
        ',UPI/ACME,1500,',
      ].join('\n');
      expect(() => parseStatementCsv(blank)).toThrow(/Row 2: date is missing/);
    });
  });
});
