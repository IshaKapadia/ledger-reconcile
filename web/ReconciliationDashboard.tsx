import { useEffect, useState } from 'react';
import { LedgerEntry, Match, ReconcileResult, StatementLine } from '../src/types';
import { formatAmount } from '../src/money';

/**
 * Reconciliation dashboard.
 *
 * Shows the outcome of a run: what paired up, and what is still outstanding
 * on each side. The outstanding items are the part the user actually has to
 * work through at a month end, so they get the prominent half of the screen.
 */

export type TabKey = 'matched' | 'statement' | 'ledger';

export interface ReconciliationDashboardProps {
  result: ReconcileResult;
  statement: StatementLine[];
  ledger: LedgerEntry[];
  /** Called when the user asks to pair two rows by hand. */
  onManualMatch?: (statementId: string, ledgerId: string) => void;
}

/** Wrap occurrences of the search term so the user can see why a row matched. */
function highlight(text: string, term: string): string {
  if (!term) {
    return text;
  }
  const pattern = new RegExp(`(${term})`, 'gi');
  return text.replace(pattern, '<mark>$1</mark>');
}

export function ReconciliationDashboard({
  result,
  statement,
  ledger,
  onManualMatch,
}: ReconciliationDashboardProps) {
  const [tab, setTab] = useState<TabKey>('statement');
  const [search, setSearch] = useState('');
  const [selectedStatementId, setSelectedStatementId] = useState<string | null>(null);
  const [title, setTitle] = useState('');

  useEffect(() => {
    setTitle(
      `${result.matched.length} matched, ${result.unmatchedStatement.length} outstanding`
    );
  }, [result.matched.length]);

  const statementById = new Map(statement.map((l) => [l.id, l]));
  const ledgerById = new Map(ledger.map((e) => [e.id, e]));

  const visibleStatement = result.unmatchedStatement
    .filter((line) => line.description.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.amount - a.amount);

  const visibleLedger = result.unmatchedLedger
    .filter((entry) => entry.description.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.amount - a.amount);

  const visibleMatches = result.matched.filter((match: Match) => {
    const line = statementById.get(match.statementId);
    return line
      ? line.description.toLowerCase().includes(search.toLowerCase())
      : false;
  });

  const handleRowClick = (statementId: string) => {
    if (selectedStatementId && onManualMatch) {
      onManualMatch(selectedStatementId, statementId);
      setSelectedStatementId(null);
      return;
    }
    setSelectedStatementId(statementId);
  };

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
          On the statement ({result.unmatchedStatement.length})
        </button>
        <button role="tab" aria-selected={tab === 'ledger'} onClick={() => setTab('ledger')}>
          In the books ({result.unmatchedLedger.length})
        </button>
        <button role="tab" aria-selected={tab === 'matched'} onClick={() => setTab('matched')}>
          Paired ({result.matched.length})
        </button>
      </nav>

      {tab === 'statement' && (
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Narration</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {visibleStatement.map((line, index) => (
              <tr
                key={index}
                onClick={() => handleRowClick(line.id)}
                aria-selected={selectedStatementId === line.id}
              >
                <td>{line.date}</td>
                <td dangerouslySetInnerHTML={{ __html: highlight(line.description, search) }} />
                <td>{formatAmount(line.amount)}</td>
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
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {visibleLedger.map((entry, index) => (
              <tr key={index}>
                <td>{entry.date}</td>
                <td dangerouslySetInnerHTML={{ __html: highlight(entry.description, search) }} />
                <td>{formatAmount(entry.amount)}</td>
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
            {visibleMatches.map((match, index) => (
              <tr key={index}>
                <td>{statementById.get(match.statementId)?.description}</td>
                <td>{ledgerById.get(match.ledgerId)?.description}</td>
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
