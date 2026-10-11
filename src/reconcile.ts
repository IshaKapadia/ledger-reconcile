import {
  LedgerEntry,
  Match,
  ReconcileOptions,
  ReconcileResult,
  StatementLine,
} from './types';
import { findMatch } from './matcher';

export const DEFAULT_DATE_TOLERANCE_DAYS = 2;

/**
 * Reconcile a bank statement against the ledger.
 *
 * Every statement line is matched against at most one ledger entry, and every
 * ledger entry is consumed at most once. Whatever is left over on either side
 * is reported as unmatched rather than forced into a pairing.
 */
export function reconcile(
  statement: StatementLine[],
  ledger: LedgerEntry[],
  options: ReconcileOptions = {}
): ReconcileResult {
  const dateToleranceDays =
    options.dateToleranceDays ?? DEFAULT_DATE_TOLERANCE_DAYS;

  const matched: Match[] = [];
  const claimedLedgerIds = new Set<string>();
  const matchedStatementIds = new Set<string>();

  for (const line of statement) {
    const match = findMatch(line, ledger, claimedLedgerIds, dateToleranceDays);
    if (match) {
      matched.push(match);
      claimedLedgerIds.add(match.ledgerId);
      matchedStatementIds.add(match.statementId);
    }
  }

  return {
    matched,
    unmatchedStatement: statement.filter((l) => !matchedStatementIds.has(l.id)),
    unmatchedLedger: ledger.filter((e) => !claimedLedgerIds.has(e.id)),
  };
}
