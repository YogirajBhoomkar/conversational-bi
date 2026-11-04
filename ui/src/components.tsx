import { Component, type ReactNode, useEffect, useState } from 'react';
import { sendFeedback } from './api';
import { Chart, supports } from './charts';
import type { FinalAnswer, TraceItem } from './types';

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

// Re-renders once a second while the agents are working, so the elapsed time ticks.
const useNow = (live: boolean) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  return now;
};

// The agents' working notes, in order: the model, what each agent decided, each handover and tool call with its state,
// and Genie's own progress under the call that produced it. Open while they work, collapsed once the answer is done.
export function Scratchpad({ trace, live, startedAt, endedAt }: { trace: TraceItem[]; live: boolean; startedAt: number; endedAt?: number }) {
  const now = useNow(live);
  if (trace.length === 0) return null;
  const seconds = Math.max(0, Math.round(((live ? now : (endedAt ?? now)) - startedAt) / 1000));
  const tools = trace.filter((i) => i.kind === 'tool').length;
  const count = `${tools} tool${tools === 1 ? '' : 's'}`;
  const ids = new Set(trace.map((i) => i.id));
  const childrenOf = (id: string) => trace.filter((i) => i.kind === 'progress' && i.parent === id);
  return (
    <details className="pad" open={live}>
      <summary>{live ? `Working… · ${count} · ${seconds}s` : `Worked for ${seconds}s · ${count}`}</summary>
      <div className="pad-body">
        {trace.map((i) => {
          if (i.kind === 'progress' && i.parent && ids.has(i.parent)) return null; // shown under its tool call
          if (i.kind === 'meta') return <div key={i.id} className="pad-meta"><strong>{i.label}:</strong> {i.text}</div>;
          if (i.kind !== 'tool') {
            return (
              <p key={i.id} className="pad-note">
                {i.by && <span className="pad-by">{i.by}</span>}
                {i.text}
              </p>
            );
          }
          const status = !live && i.status === 'running' ? 'done' : i.status;
          return (
            <div key={i.id} className="pad-tool">
              <div className="pad-row">
                <span className={`pad-icon ${status}`} role="img" aria-label={status} />
                <strong>{i.label}</strong>
                {i.by && <span className="pad-by">{i.by}</span>}
              </div>
              {i.text && <div className="pad-detail">{i.text}</div>}
              {childrenOf(i.id).map((c) => <p key={c.id} className="pad-note pad-child">{c.text}</p>)}
            </div>
          );
        })}
      </div>
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
            {supports(result.chartSpec) ? (
              <Chart spec={result.chartSpec} />
            ) : (
              <p className="status">The enabled chart library cannot draw a {result.chartSpec.type} chart. The data is in the table below.</p>
            )}
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
