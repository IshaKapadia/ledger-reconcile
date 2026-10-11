import { round2 } from './money';
import { Direction, StatementLine } from './types';

/**
 * Statement CSV parsing.
 *
 * Every bank exports a slightly different shape, so the column names are
 * matched case-insensitively against a handful of known aliases rather than
 * being pinned to one layout.
 *
 * The parser is deliberately strict. A reconciliation run is only worth
 * anything if both sides are believed, so a row this module cannot read is an
 * error rather than a best guess: a silently mis-read amount reappears later
 * as an unexplained difference that somebody has to chase by hand.
 */

/** Raised when a statement cannot be read. Carries a 400 for HTTP callers. */
export class CsvParseError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = 'CsvParseError';
  }
}

type CanonicalColumn = 'date' | 'description' | 'debit' | 'credit' | 'reference';

/**
 * Aliases are listed in priority order, not in the order a bank happens to
 * print them. A statement carrying both "Value Date" and "Txn Date" resolves
 * to the value date, which is what `StatementLine.date` promises, rather than
 * to whichever column sits further right.
 */
const COLUMN_ALIASES: Record<CanonicalColumn, string[]> = {
  date: ['value date', 'date', 'transaction date', 'txn date'],
  description: ['narration', 'description', 'particulars', 'remarks'],
  debit: ['withdrawal', 'withdrawal amt', 'debit'],
  credit: ['deposit', 'deposit amt', 'credit'],
  reference: ['utr', 'chq/ref no', 'reference', 'ref no'],
};

/**
 * Tokenise CSV text into rows of fields.
 *
 * This scans character by character rather than splitting on newlines first,
 * because a narration may legitimately contain a line break inside a quoted
 * field. Splitting on newlines up front cuts such a row in half: the first
 * part loses its amount columns and the remainder arrives as a phantom row.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field.trim());
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') {
        i++;
      }
      row.push(field.trim());
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  row.push(field.trim());
  rows.push(row);

  // Drop rows that are entirely empty — a trailing newline, or a blank
  // separator line in the middle of a hand-edited export.
  return rows.filter((fields) => fields.some((value) => value !== ''));
}

/** Split a single CSV line, honouring double-quoted fields. */
export function splitCsvLine(line: string): string[] {
  return parseCsv(line)[0] ?? [];
}

function resolveColumns(header: string[]): Partial<Record<CanonicalColumn, number>> {
  const normalised = header.map((raw) => raw.toLowerCase().trim());
  const lookup: Partial<Record<CanonicalColumn, number>> = {};

  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES) as [
    CanonicalColumn,
    string[],
  ][]) {
    for (const alias of aliases) {
      const index = normalised.indexOf(alias);
      if (index !== -1) {
        lookup[canonical] = index;
        break;
      }
    }
  }

  return lookup;
}

/**
 * Read a money cell.
 *
 * Indian statements print amounts with digit grouping, so a quoted
 * "1,50,000.00" is the normal shape rather than an edge case. The separators
 * are stripped before parsing: `parseFloat` stops at the first comma and would
 * read that figure as 1.
 *
 * The result goes through `round2` so the value carried forward is exact to
 * the paisa, for the same reason the rest of the library does its arithmetic
 * that way — a raw float read here would undo it at the import boundary.
 */
function parseAmount(raw: string | undefined, column: string, rowNumber: number): number {
  const text = (raw ?? '').replace(/[\s,₹]/g, '');
  if (text === '') {
    return 0;
  }
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    throw new CsvParseError(
      `Row ${rowNumber}: ${column} is not an amount (${JSON.stringify(raw)}).`
    );
  }
  return round2(Number(text));
}

function requireField(
  fields: string[],
  index: number | undefined,
  column: string,
  rowNumber: number
): string {
  const value = index === undefined ? undefined : fields[index];
  if (value === undefined || value === '') {
    throw new CsvParseError(`Row ${rowNumber}: ${column} is missing.`);
  }
  return value;
}

/** Parse a statement CSV into statement lines. */
export function parseStatementCsv(csv: string): StatementLine[] {
  const rows = parseCsv(csv);
  if (rows.length === 0) {
    return [];
  }

  const columns = resolveColumns(rows[0]);

  // Without these there is nothing to reconcile on, and every row would
  // otherwise come out holding `undefined` where the type promises a string —
  // which then fails somewhere much further from the cause.
  const missing: string[] = [];
  if (columns.date === undefined) {
    missing.push('date');
  }
  if (columns.description === undefined) {
    missing.push('description/narration');
  }
  if (columns.debit === undefined && columns.credit === undefined) {
    missing.push('withdrawal/deposit');
  }
  if (missing.length > 0) {
    throw new CsvParseError(
      `Statement is missing required column(s): ${missing.join(', ')}. ` +
        `Header was: ${rows[0].join(', ')}`
    );
  }

  const parsed: StatementLine[] = [];

  for (let i = 1; i < rows.length; i++) {
    const fields = rows[i];
    const rowNumber = i + 1;

    const debit = parseAmount(
      columns.debit === undefined ? '' : fields[columns.debit],
      'withdrawal',
      rowNumber
    );
    const credit = parseAmount(
      columns.credit === undefined ? '' : fields[columns.credit],
      'deposit',
      rowNumber
    );

    if (debit !== 0 && credit !== 0) {
      throw new CsvParseError(
        `Row ${rowNumber}: both withdrawal and deposit carry a value; ` +
          `cannot tell which way the money moved.`
      );
    }

    // A reversal is sometimes posted as a negative in the original column, so
    // the net decides the direction rather than the column it arrived in.
    const net = round2(debit - credit);
    if (net === 0) {
      throw new CsvParseError(
        `Row ${rowNumber}: no amount. A carried-forward or total row cannot be ` +
          `reconciled and should not be included in the statement.`
      );
    }

    const direction: Direction = net > 0 ? 'debit' : 'credit';
    const reference =
      columns.reference === undefined ? undefined : fields[columns.reference] || undefined;

    parsed.push({
      id: `csv-${i}`,
      date: requireField(fields, columns.date, 'date', rowNumber),
      description: requireField(fields, columns.description, 'narration', rowNumber),
      amount: Math.abs(net),
      direction,
      reference,
    });
  }

  return parsed;
}
