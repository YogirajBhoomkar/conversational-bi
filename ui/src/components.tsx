import { Component, type ReactNode, useState } from 'react';
import { sendFeedback } from './api';
import { Chart } from './charts';
import type { FinalAnswer } from './types';

// A chart that fails to draw must never take the app down: fall back to the table.
class ChartBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.error('[chart] could not draw:', error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const fmt = (v: unknown) => {
  if (v === null || v === undefined) return '';
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(String(v)) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(v);
};

export function DataTable({ columns, rows }: { columns: string[]; rows: unknown[][] }) {
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const sorted = sort
    ? [...rows].sort((a, b) => {
        const x = a[sort.col], y = b[sort.col];
        const nx = Number(x), ny = Number(y);
        return (Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : String(x).localeCompare(String(y))) * sort.dir;
      })
    : rows;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={c} onClick={() => setSort((s) => (s?.col === i ? { col: i, dir: (s.dir * -1) as 1 | -1 } : { col: i, dir: 1 }))}>
                {c}
                {sort?.col === i ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j} className={Number.isFinite(Number(v)) && v !== '' && v !== null ? 'num' : ''}>{fmt(v)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Feedback({ source }: { source: FinalAnswer['sources'][number] }) {
  const [state, setState] = useState<'POSITIVE' | 'NEGATIVE' | 'error' | null>(null);
  const rate = async (rating: 'POSITIVE' | 'NEGATIVE') => {
    setState(rating);
    try {
      await sendFeedback({ spaceId: source.spaceId, conversationId: source.conversationId, messageId: source.messageId, rating });
    } catch {
      setState('error');
    }
  };
  return (
    <span className="feedback">
      <button className={state === 'POSITIVE' ? 'on' : ''} onClick={() => rate('POSITIVE')}>Helpful</button>
      <button className={state === 'NEGATIVE' ? 'on' : ''} onClick={() => rate('NEGATIVE')}>Not helpful</button>
      {state === 'error' && <em> couldn't send</em>}
    </span>
  );
}

// Genie's progress/reasoning log: open and live while the answer is being produced, collapsed once it's done.
export function Thinking({ lines, live }: { lines: string[]; live: boolean }) {
  if (lines.length === 0) return null;
  return (
    <details className="think" open={live}>
      <summary>{live ? 'Genie is thinking…' : `Genie's thinking (${lines.length} steps)`}</summary>
      <ol className="thinking">
        {lines.map((t, i) => <li key={i}>{t}</li>)}
      </ol>
    </details>
  );
}

export function Details({ result, onAsk, disabled }: { result: FinalAnswer; onAsk: (q: string) => void; disabled?: boolean }) {
  return (
    <>
      {result.chartSpec && (
        <ChartBoundary>
          <figure className="chart">
            <figcaption>{result.chartSpec.title}</figcaption>
            <Chart spec={result.chartSpec} />
          </figure>
        </ChartBoundary>
      )}
      {result.columns.length > 0 && (
        <details>
          <summary>
            {result.totalRows > result.rows.length
              ? `Data (preview: ${result.rows.length.toLocaleString()} of ${result.totalRows.toLocaleString()} rows)`
              : `Data (${result.rows.length.toLocaleString()} rows)`}
          </summary>
          <DataTable columns={result.columns} rows={result.rows} />
        </details>
      )}
      {result.sources.map((s) => (
        <details key={s.messageId}>
          <summary>
            SQL · {s.spaceName} <Feedback source={s} />
          </summary>
          <p className="q">“{s.question}”</p>
          <pre>{s.sql ?? 'No SQL returned'}</pre>
        </details>
      ))}
      {result.suggestedQuestions.length > 0 && (
        <div className="suggested">
          <div className="suggested-label">Suggested follow-ups</div>
          {result.suggestedQuestions.map((q) => (
            <button key={q} disabled={disabled} onClick={() => onAsk(q)}>{q}</button>
          ))}
        </div>
      )}
    </>
  );
}
