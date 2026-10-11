import { isIsoDate } from './dates';
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

/** A tokenised row, carrying the line of the file it started on. */
export interface CsvRow {
  fields: string[];
  /** 1-based line in the original text, for error messages. */
  line: number;
}

/**
 * Tokenise CSV text into rows of fields.
 *
 * This scans character by character rather than splitting on newlines first,
 * because a narration may legitimately contain a line break inside a quoted
 * field. Splitting on newlines up front cuts such a row in half: the first
 * part loses its amount columns and the remainder arrives as a phantom row.
 *
 * Each row remembers the line it began on. Blank rows are dropped, and a
 * quoted narration can span several lines, so a row's position in the returned
 * array is not its position in the file — and an error message that quotes the
 * wrong line sends somebody to the wrong row of a thousand-row statement.
 */
export function scanCsv(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;

  const endRow = () => {
    fields.push(field.trim());
    field = '';
    // Drop rows that are entirely empty — a trailing newline, or a blank
    // separator line in the middle of a hand-edited export.
    if (fields.some((value) => value !== '')) {
      rows.push({ fields, line: rowStartLine });
    }
    fields = [];
  };

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
        if (char === '\n' || (char === '\r' && text[i + 1] !== '\n')) {
          line++;
        }
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      fields.push(field.trim());
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') {
        i++;
      }
      endRow();
      line++;
      rowStartLine = line;
    } else {
      field += char;
    }
  }

  endRow();
  return rows;
}

/** Tokenise CSV text into rows of fields, discarding line positions. */
export function parseCsv(text: string): string[][] {
  return scanCsv(text).map((row) => row.fields);
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
 * A figure carrying real precision finer than a paisa is rejected rather than
 * rounded. Rounding here would be the import boundary quietly changing a
 * number the bank printed, and the run would then reconcile against a figure
 * that is not on the statement. Trailing zeros are not precision — a bank that
 * prints "1500.000" has said exactly 1500 — so those are accepted.
 *
 * Note there is no rounding call on the way out, and there is deliberately
 * nothing for one to do: the pattern below admits at most two significant
 * decimal places, and `Number` on such a string is already the nearest double
 * to it. A `round2` here would return its own argument.
 */
const AMOUNT = /^-?\d+(\.\d{1,2}0*)?$/;

function parseAmount(raw: string | undefined, column: string, rowNumber: number): number {
  const text = (raw ?? '').replace(/[\s,₹]/g, '');
  if (text === '') {
    return 0;
  }
  if (!AMOUNT.test(text)) {
    // Anything with three or more decimals that got this far has a non-zero
    // one among them, because trailing zeros are accepted above.
    const reason = /^-?\d+\.\d{3,}$/.test(text)
      ? 'carries more precision than a paisa'
      : 'is not an amount';
    throw new CsvParseError(`Row ${rowNumber}: ${column} ${reason} (${JSON.stringify(raw)}).`);
  }
  return Number(text);
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
  const rows = scanCsv(csv);
  if (rows.length === 0) {
    return [];
  }

  const columns = resolveColumns(rows[0].fields);

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
        `Header was: ${rows[0].fields.join(', ')}`
    );
  }

  const parsed: StatementLine[] = [];

  for (let i = 1; i < rows.length; i++) {
    const { fields, line: rowNumber } = rows[i];

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
    //
    // No rounding on this either: a row with both columns filled is refused
    // above, so one of these two is always exactly 0, and subtracting zero —
    // or subtracting from zero — is exact. There is no drift to mop up.
    const net = debit - credit;
    if (net === 0) {
      throw new CsvParseError(
        `Row ${rowNumber}: no amount. A carried-forward or total row cannot be ` +
          `reconciled and should not be included in the statement.`
      );
    }

    const direction: Direction = net > 0 ? 'debit' : 'credit';
    const reference =
      columns.reference === undefined ? undefined : fields[columns.reference] || undefined;

    // The rest of the library takes "date is an ISO date" as given — the
    // matcher hands it straight to `toUtcTimestamp`, which throws a plain
    // Error on anything else. A statement printing `10/04/2026` is a file this
    // parser cannot read, which is this module's job to say, rather than
    // something for the matcher to fall over on three calls later.
    const date = requireField(fields, columns.date, 'date', rowNumber);
    if (!isIsoDate(date)) {
      throw new CsvParseError(
        `Row ${rowNumber}: date is not an ISO date (YYYY-MM-DD): ${JSON.stringify(date)}.`
      );
    }

    parsed.push({
      // Keyed on the line of the file, so an id points at something a person
      // can find in the statement they uploaded.
      id: `csv-${rowNumber}`,
      date,
      description: requireField(fields, columns.description, 'narration', rowNumber),
      amount: Math.abs(net),
      direction,
      reference,
    });
  }

  return parsed;
}
