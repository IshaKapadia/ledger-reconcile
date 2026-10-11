/**
 * Core domain types for bank-statement reconciliation.
 *
 * A reconciliation run takes two sides:
 *   - statement lines, as supplied by the bank
 *   - ledger entries, as recorded in the books
 * and decides which ones represent the same real-world movement of money.
 */

/** Direction of a movement of money, from the account holder's point of view. */
export type Direction = 'debit' | 'credit';

/** A single line as it appears on a bank statement. */
export interface StatementLine {
  /** Stable identifier within the imported statement. */
  id: string;
  /** Value date, ISO-8601 (YYYY-MM-DD). */
  date: string;
  /** Free-text narration exactly as the bank supplied it. */
  description: string;
  /** Absolute amount. Never negative; use `direction` for the sign. */
  amount: number;
  direction: Direction;
  /** Bank reference / UTR / cheque number, when the bank provides one. */
  reference?: string;
}

/** A single entry as recorded in the books. */
export interface LedgerEntry {
  id: string;
  /** Posting date, ISO-8601 (YYYY-MM-DD). */
  date: string;
  /** Narration entered by the bookkeeper. */
  description: string;
  amount: number;
  direction: Direction;
  reference?: string;
  /** Account code this entry was posted against. */
  account?: string;
}

/** How a given pair was arrived at. Useful for explaining a result to a user. */
export type MatchStrategy = 'reference' | 'exact';

export interface Match {
  statementId: string;
  ledgerId: string;
  strategy: MatchStrategy;
  /** 0..1. Higher means more confident. */
  confidence: number;
}

export interface ReconcileOptions {
  /**
   * How many days apart two records may be and still be considered the same
   * movement. Banks and books routinely disagree by a day or two.
   */
  dateToleranceDays?: number;
}

export interface ReconcileResult {
  matched: Match[];
  /** Statement lines with no counterpart in the ledger. */
  unmatchedStatement: StatementLine[];
  /** Ledger entries with no counterpart on the statement. */
  unmatchedLedger: LedgerEntry[];
}
