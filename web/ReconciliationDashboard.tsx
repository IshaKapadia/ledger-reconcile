import { Fragment, ReactNode, useCallback, useMemo, useState } from 'react';
import { Direction, LedgerEntry, ReconcileResult, StatementLine } from '../src/types';
import { formatAmount } from '../src/money';

/**
 * Reconciliation dashboard.
 *
 * Shows the outcome of a run: what paired up, and what is still outstanding
 * on each side. The outstanding items are the part the user actually has to
 * work through at a month end, so they get the prominent half of the screen.
 */

export type TabKey = 'matched' | 'statement' | 'ledger';

/** Which side of the reconciliation a row belongs to. */
type Side = 'statement' | 'ledger';

interface Selection {
  side: Side;
  id: string;
}

export interface ReconciliationDashboardProps {
  result: ReconcileResult;
  statement: StatementLine[];
  ledger: LedgerEntry[];
  /** Called when the user asks to pair two rows by hand. */
  onManualMatch?: (statementId: string, ledgerId: string) => void;
}

/** Escape a user-supplied string so it can be embedded in a RegExp literally. */
function escapeForRegExp(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Wrap occurrences of the search term so the user can see why a row matched.
 *
 * Returns React nodes rather than an HTML string. Narrations come from a bank
 * statement or from whatever a bookkeeper typed, which is untrusted input —
 * handing it to `dangerouslySetInnerHTML` would run any markup it contains in
 * the reviewer's session. As nodes, React escapes the text for us.
 *
 * The term is escaped before it reaches the RegExp, so searching for "(" is a
 * search, not a SyntaxError thrown during render.
 */
function highlight(text: string, term: string): ReactNode {
  if (!term) {
    return text;
  }
  // A capturing group makes split() interleave the matches with the gaps, so
  // every odd index is an occurrence of the term.
  const parts = text.split(new RegExp(`(${escapeForRegExp(term)})`, 'gi'));
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <mark key={index}>{part}</mark>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    )
  );
}

/**
 * Amount as the user needs to read it: a debit and a credit of the same size
 * are not the same thing, and `amount` is unsigned by contract.
 */
function signedAmount(amount: number, direction: Direction): number {
  return direction === 'debit' ? -amount : amount;
}

function AmountCell({ amount, direction }: { amount: number; direction: Direction }) {
  return (
    <td className={`amount amount--${direction}`} data-direction={direction}>
      {formatAmount(signedAmount(amount, direction))}
    </td>
  );
}

export function ReconciliationDashboard({
  result,
  statement,
  ledger,
  onManualMatch,
}: ReconciliationDashboardProps) {
  const [tab, setTab] = useState<TabKey>('statement');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Selection | null>(null);

  // Derived from props, so it is computed rather than mirrored into state —
  // state would go stale whenever a count changed that the effect did not
  // happen to list as a dependency.
  const outstanding = result.unmatchedStatement.length + result.unmatchedLedger.length;
  const title = `${result.matched.length} matched, ${outstanding} outstanding`;

  const statementById = useMemo(
    () => new Map(statement.map((line) => [line.id, line])),
    [statement]
  );
  const ledgerById = useMemo(() => new Map(ledger.map((entry) => [entry.id, entry])), [ledger]);

  const needle = search.trim().toLowerCase();

  // Sorting by the signed amount keeps debits and credits in separate blocks
  // instead of interleaving two rows that render differently but sort equal.
  const visibleStatement = useMemo(
    () =>
      result.unmatchedStatement
        .filter((line) => !needle || line.description.toLowerCase().includes(needle))
        .slice()
        .sort(
          (a, b) =>
            signedAmount(b.amount, b.direction) - signedAmount(a.amount, a.direction)
        ),
    [result.unmatchedStatement, needle]
  );

  const visibleLedger = useMemo(
    () =>
      result.unmatchedLedger
        .filter((entry) => !needle || entry.description.toLowerCase().includes(needle))
        .slice()
        .sort(
          (a, b) =>
            signedAmount(b.amount, b.direction) - signedAmount(a.amount, a.direction)
        ),
    [result.unmatchedLedger, needle]
  );

  // A match is kept when either narration matches, because both are on screen.
  // A match whose line is missing from the supplied arrays is still shown — it
  // is a real pairing, and hiding it made the tab count disagree with the rows.
  const visibleMatches = useMemo(
    () =>
      result.matched.filter((match) => {
        if (!needle) {
          return true;
        }
        const statementText = statementById.get(match.statementId)?.description ?? '';
        const ledgerText = ledgerById.get(match.ledgerId)?.description ?? '';
        return (
          statementText.toLowerCase().includes(needle) ||
          ledgerText.toLowerCase().includes(needle)
        );
      }),
    [result.matched, needle, statementById, ledgerById]
  );

  /**
   * Manual pairing needs one row from each side. Selecting a second row on the
   * same side moves the selection rather than pairing, so the callback can only
   * ever be handed a statement id and a ledger id.
   */
  const handleRowClick = useCallback(
    (side: Side, id: string) => {
      setSelected((current) => {
        if (!current) {
          return { side, id };
        }
        if (current.side === side) {
          return current.id === id ? null : { side, id };
        }
        const statementId = side === 'statement' ? id : current.id;
        const ledgerId = side === 'ledger' ? id : current.id;
        onManualMatch?.(statementId, ledgerId);
        return null;
      });
    },
    [onManualMatch]
  );

  const isSelected = (side: Side, id: string) =>
    selected?.side === side && selected.id === id;

  return (
    <section className="reconciliation-dashboard">
      <header>
        <h2>{title}</h2>
        <input
          type="search"
          value={search}
          placeholder="Filter by narration"
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Filter by narration"
        />
      </header>

      <nav role="tablist">
        <button role="tab" aria-selected={tab === 'statement'} onClick={() => setTab('statement')}>
          On the statement ({visibleStatement.length})
        </button>
        <button role="tab" aria-selected={tab === 'ledger'} onClick={() => setTab('ledger')}>
          In the books ({visibleLedger.length})
        </button>
        <button role="tab" aria-selected={tab === 'matched'} onClick={() => setTab('matched')}>
          Paired ({visibleMatches.length})
        </button>
      </nav>

      {tab === 'statement' && (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Narration</th>
              <th>Direction</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {visibleStatement.map((line) => (
              <tr
                key={line.id}
                onClick={() => handleRowClick('statement', line.id)}
                aria-selected={isSelected('statement', line.id)}
              >
                <td>{line.date}</td>
                <td>{highlight(line.description, search)}</td>
                <td>{line.direction}</td>
                <AmountCell amount={line.amount} direction={line.direction} />
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === 'ledger' && (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Narration</th>
              <th>Direction</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {visibleLedger.map((entry) => (
              <tr
                key={entry.id}
                onClick={() => handleRowClick('ledger', entry.id)}
                aria-selected={isSelected('ledger', entry.id)}
              >
                <td>{entry.date}</td>
                <td>{highlight(entry.description, search)}</td>
                <td>{entry.direction}</td>
                <AmountCell amount={entry.amount} direction={entry.direction} />
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === 'matched' && (
        <table>
          <thead>
            <tr>
              <th>Statement</th>
              <th>Ledger</th>
              <th>How</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {visibleMatches.map((match) => (
              <tr key={`${match.statementId}:${match.ledgerId}`}>
                <td>{statementById.get(match.statementId)?.description ?? '—'}</td>
                <td>{ledgerById.get(match.ledgerId)?.description ?? '—'}</td>
                <td>{match.strategy}</td>
                <td>{Math.round(match.confidence * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default ReconciliationDashboard;
