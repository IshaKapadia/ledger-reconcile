# ledger-reconcile

Reconcile bank statement lines against ledger entries.

Anyone who has closed a month's books knows the problem: the bank says one thing,
the books say another, and most of the difference is noise. The same payment is
`UPI/ACME SUPPLIES/412345678901` on the statement and `Acme Supplies` in the
ledger, posted a day later. This library pairs up the two sides and tells you
honestly what it could not account for.

## Install

```bash
npm install
npm test
```

## Use

```ts
import { reconcile } from 'ledger-reconcile';

const result = reconcile(statementLines, ledgerEntries, {
  dateToleranceDays: 2,
});

console.log(result.matched.length, 'pairs');
console.log(result.unmatchedStatement, 'on the statement with no entry');
console.log(result.unmatchedLedger, 'in the books with no statement line');
```

## How matching works

Strategies are tried in order of how much they can be trusted:

1. **Reference** — both sides quote the same bank reference (UTR, IMPS ref,
   cheque number). As close to a primary key as reconciliation ever gets.
2. **Exact** — same direction, same amount, dates within tolerance, and the same
   narration once channel prefixes and punctuation are stripped.

A ledger entry is consumed by at most one statement line. Anything that cannot
be paired is reported rather than guessed at.

## Design notes

- **Dates are ISO strings, compared in UTC.** Reconciliation that silently
  shifts by a timezone is worse than useless.
- **Unmatched is a first-class result, not a failure.** A genuine timing
  difference at a month end is information the user needs to see.
- **Narration normalisation is conservative.** It is better to leave a pair
  unmatched for a human to confirm than to net off two unrelated payments.

## Layout

| Path               | What lives there                                  |
| ------------------ | ------------------------------------------------- |
| `src/types.ts`     | Domain types shared across the library            |
| `src/money.ts`     | Amount arithmetic, comparison and formatting      |
| `src/dates.ts`     | ISO date parsing and day-window comparison        |
| `src/normalize.ts` | Narration cleanup before descriptions are compared |
| `src/matcher.ts`   | Per-pair matching strategies                      |
| `src/reconcile.ts` | The run: walks the statement, assigns pairs       |

## Licence

MIT
