import { useState } from 'react';
import CircularProgress from '@mui/material/CircularProgress';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { TraceItem } from '../../types';
import './TraceView.css';

function TraceList({ trace, limit }: { trace: TraceItem[]; limit?: number }) {
  // Progress lines hang under the tool entry they belong to; a progress line without a known parent is shown on its own.
  const top = trace.filter((t) => t.kind !== 'progress' || !t.parent || !trace.some((p) => p.id === t.parent));
  const shown = limit ? top.slice(-limit) : top;
  return (
    <div className="trace__steps">
      {shown.map((t) => {
        if (t.kind === 'meta') {
          return (
            <span key={t.id} className="trace__line trace__line--meta">
              {t.label ? `${t.label}: ` : ''}
              {t.text}
            </span>
          );
        }
        if (t.kind === 'tool') {
          const subs = trace.filter((p) => p.kind === 'progress' && p.parent === t.id);
          return (
            <span key={t.id} className={`trace__line trace__line--tool is-${t.status ?? 'running'}`}>
              <span className="trace__tool">
                {t.status === 'done' ? (
                  <CheckCircleIcon className="trace__icon trace__icon--done" />
                ) : t.status === 'error' ? (
                  <ErrorIcon className="trace__icon trace__icon--error" />
                ) : (
                  <CircularProgress size={11} thickness={6} className="trace__icon trace__icon--run" />
                )}
                <span className="trace__text">
                  <b>{t.label}</b>
                  {t.by ? ` · ${t.by}` : ''}
                  {t.text ? ` — ${t.text}` : ''}
                </span>
              </span>
              {subs.map((s) => (
                <span key={s.id} className="trace__sub">
                  {s.text}
                </span>
              ))}
            </span>
          );
        }
        return (
          <span key={t.id} className={`trace__line${t.kind === 'progress' ? ' trace__sub' : ''}`}>
            {t.text}
          </span>
        );
      })}
    </div>
  );
}

export default function TraceView({ trace, pending, startedAt, endedAt }: { trace: TraceItem[]; pending: boolean; startedAt: number; endedAt?: number }) {
  const [open, setOpen] = useState(false);

  // While the agents work: spinner plus the latest steps, the way the mock-up's loader shows them.
  if (pending) {
    return (
      <div className="trace trace--live">
        <CircularProgress size={22} thickness={5} className="trace__spin" />
        {trace.length ? (
          <TraceList trace={trace} limit={6} />
        ) : (
          <div className="trace__steps">
            <span className="trace__line">Understanding your question…</span>
          </div>
        )}
      </div>
    );
  }

  if (!trace.length) return null;
  const seconds = endedAt ? Math.max(1, Math.round((endedAt - startedAt) / 1000)) : null;
  return (
    <div className="trace trace--done">
      <button type="button" className="trace__toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <ExpandMoreIcon className={`trace__chevron${open ? ' is-open' : ''}`} />
        {open ? 'Hide steps' : 'Show steps'}
        {seconds ? ` · ${seconds}s` : ''}
      </button>
      {open && <TraceList trace={trace} />}
    </div>
  );
}
