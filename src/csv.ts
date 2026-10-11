import { Direction, StatementLine } from './types';

/**
 * Statement CSV parsing.
 *
 * Every bank exports a slightly different shape, so the column names are
 * matched case-insensitively against a handful of known aliases rather than
 * being pinned to one layout.
 */

const COLUMN_ALIASES: Record<string, string[]> = {
  date: ['date', 'txn date', 'value date', 'transaction date'],
  description: ['description', 'narration', 'particulars', 'remarks'],
  debit: ['debit', 'withdrawal', 'withdrawal amt'],
  credit: ['credit', 'deposit', 'deposit amt'],
  reference: ['reference', 'ref no', 'chq/ref no', 'utr'],
};

/** Split a single CSV line, honouring double-quoted fields. */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  const pattern = /("([^"]|"")*"|[^,]*)(,|$)/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    let value = match[1];
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/""/g, '"');
    }
    fields.push(value.trim());
    if (match[3] === '') {
      break;
    }
  }

  return fields;
}

function resolveColumns(header: string[]): Record<string, number> {
  const lookup: Record<string, number> = {};
  header.forEach((raw, index) => {
    const name = raw.toLowerCase().trim();
    for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (aliases.includes(name)) {
        lookup[canonical] = index;
      }
    }
  });
  return lookup;
}

/** Parse a statement CSV into statement lines. */
export function parseStatementCsv(csv: string): StatementLine[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) {
    return [];
  }

  const header = splitCsvLine(lines[0]);
  const columns = resolveColumns(header);

  const parsed: StatementLine[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = splitCsvLine(lines[i]);

    const debitRaw = columns.debit !== undefined ? fields[columns.debit] : '';
    const creditRaw = columns.credit !== undefined ? fields[columns.credit] : '';

    const debit = parseFloat(debitRaw || '0');
    const credit = parseFloat(creditRaw || '0');

    const direction: Direction = debit > 0 ? 'debit' : 'credit';
    const amount = debit > 0 ? debit : credit;

    parsed.push({
      id: `csv-${i}`,
      date: fields[columns.date],
      description: fields[columns.description],
      amount,
      direction,
      reference: columns.reference !== undefined ? fields[columns.reference] : undefined,
    });
  }

  return parsed;
}
