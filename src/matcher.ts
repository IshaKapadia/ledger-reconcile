import { LedgerEntry, Match, StatementLine } from './types';
import { equalAmounts } from './money';
import { withinDays } from './dates';
import { normaliseDescription } from './normalize';

/**
 * Candidate matching between one statement line and one ledger entry.
 *
 * Two strategies, tried in order of how much we trust them:
 *   1. a shared bank reference, which is as close to an identifier as we get
 *   2. same direction, same amount, close enough date, same narration
 */

/** Both sides quote the same bank reference. */
export function matchesByReference(
  line: StatementLine,
  entry: LedgerEntry
): boolean {
  if (!line.reference || !entry.reference) {
    return false;
  }
  return line.reference.trim() === entry.reference.trim();
}

/** Same money, same direction, near enough in time, same narration. */
export function matchesExactly(
  line: StatementLine,
  entry: LedgerEntry,
  dateToleranceDays: number
): boolean {
  if (line.direction !== entry.direction) {
    return false;
  }
  if (!equalAmounts(line.amount, entry.amount)) {
    return false;
  }
  if (!withinDays(line.date, entry.date, dateToleranceDays)) {
    return false;
  }
  return normaliseDescription(line.description) === normaliseDescription(entry.description);
}

/**
 * Find the ledger entry that corresponds to `line`, if there is one.
 * Entries already spoken for are skipped, so a single ledger entry can never
 * satisfy two statement lines.
 */
export function findMatch(
  line: StatementLine,
  entries: LedgerEntry[],
  claimed: Set<string>,
  dateToleranceDays: number
): Match | undefined {
  for (const entry of entries) {
    if (claimed.has(entry.id)) {
      continue;
    }
    if (matchesByReference(line, entry)) {
      return {
        statementId: line.id,
        ledgerId: entry.id,
        strategy: 'reference',
        confidence: 1,
      };
    }
  }

  for (const entry of entries) {
    if (claimed.has(entry.id)) {
      continue;
    }
    if (matchesExactly(line, entry, dateToleranceDays)) {
      return {
        statementId: line.id,
        ledgerId: entry.id,
        strategy: 'exact',
        confidence: 0.9,
      };
    }
  }

  return undefined;
}
