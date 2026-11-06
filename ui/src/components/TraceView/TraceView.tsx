import { useEffect, useState } from 'react';
import CircularProgress from '@mui/material/CircularProgress';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { TraceItem } from '../../types';
import TraceText from './TraceText';
import './TraceView.css';

// The scratchpad: what the assistant is doing while it works, then a collapsed record of it.
// One loader for the whole turn. The plan, then one block per data source with Genie's thoughts and queries under it,
// every step shown in full; running steps pulse, finished ones get a tick.

const elapsed = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};

// Finished: a tick. Failed: a mark. Running: a still ring for a source, a softly pulsing dot for a query.
function Status({ status, pulse = false }: { status?: TraceItem['status']; pulse?: boolean }) {
  if (status === 'done') return <CheckCircleIcon className="trace__icon trace__icon--done" />;
  if (status === 'error') return <ErrorIcon className="trace__icon trace__icon--error" />;
  return <span className={pulse ? 'trace__pulse' : 'trace__ring'} aria-label="running" />;
}

function Step({ item }: { item: TraceItem }) {
  const text = item.text ?? '';
  if (item.step === 'query') {
    return (
      <li className={`trace__step trace__step--query is-${item.status ?? 'running'}`}>
        <Status status={item.status} pulse />
        <span className="trace__text">{text}</span>
      </li>
    );
  }
  return (
    <li className={`trace__step trace__step--${item.step ?? 'thought'}${item.status === 'error' ? ' is-error' : ''}`}>
      <TraceText text={text} />
    </li>
  );
}

function Source({ item, steps }: { item: TraceItem; steps: TraceItem[] }) {
  return (
    <li className={`trace__source is-${item.status ?? 'running'}`}>
      <div className="trace__source-head">
        <Status status={item.status} />
        <span className="trace__source-name">{item.label}</span>
      </div>
      {item.text && <TraceText text={item.text} className="trace__question" />}
      {steps.length > 0 && (
        <ul className="trace__steps">
          {steps.map((s) => <Step key={s.id} item={s} />)}
        </ul>
      )}
    </li>
  );
}

function Timeline({ trace }: { trace: TraceItem[] }) {
  const sources = new Set(trace.filter((t) => t.kind === 'tool').map((t) => t.id));
  const stepsOf = (id: string) => trace.filter((t) => t.kind === 'progress' && t.parent === id && (t.text || t.step !== 'query'));
  return (
    <ul className="trace__timeline">
      {trace.map((t) => {
        if (t.kind === 'note') return t.text ? <li key={t.id} className="trace__plan"><TraceText text={t.text} /></li> : null; // an emptied note became the answer
        if (t.kind === 'tool') return <Source key={t.id} item={t} steps={stepsOf(t.id)} />;
        // A progress line whose source is unknown stands on its own.
        if (t.kind === 'progress' && !(t.parent && sources.has(t.parent)) && t.text) return <ul key={t.id} className="trace__steps"><Step item={t} /></ul>;
        return null;
      })}
    </ul>
  );
}

// The one line under the loader: what is happening right now.
function headline(trace: TraceItem[]) {
  const running = trace.filter((t) => t.kind === 'tool' && t.status !== 'done' && t.status !== 'error');
  if (running.length) return `Querying ${running.map((t) => t.label).join(' and ')}`;
  if (trace.some((t) => t.kind === 'tool')) return 'Writing the answer';
  if (trace.some((t) => t.kind === 'note')) return 'Planning';
  return 'Understanding your question';
}

export default function TraceView({ trace, pending, startedAt, endedAt }: { trace: TraceItem[]; pending: boolean; startedAt: number; endedAt?: number }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending]);

  if (pending) {
    return (
      <div className="trace trace--live">
        <div className="trace__head" aria-live="polite">
          <CircularProgress size={14} thickness={6} className="trace__spin" />
          <span className="trace__headline">{headline(trace)}…</span>
          <span className="trace__time">{elapsed(now - startedAt)}</span>
        </div>
        <Timeline trace={trace} />
      </div>
    );
  }

  if (!trace.some((t) => t.kind !== 'meta' && (t.kind !== 'note' || t.text))) return null;
  const sources = trace.filter((t) => t.kind === 'tool').length;
  const queries = trace.filter((t) => t.step === 'query').length;
  const model = trace.find((t) => t.kind === 'meta');
  const summary = [
    sources ? `${sources} data ${sources === 1 ? 'source' : 'sources'}` : '',
    queries ? `${queries} ${queries === 1 ? 'query' : 'queries'}` : '',
    endedAt ? elapsed(endedAt - startedAt) : '',
  ].filter(Boolean).join(' · ');
  return (
    <div className="trace trace--done">
      <button type="button" className="trace__toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <ExpandMoreIcon className={`trace__chevron${open ? ' is-open' : ''}`} />
        {open ? 'Hide steps' : 'Show steps'}
        {summary && <span className="trace__summary"> · {summary}</span>}
      </button>
      {open && (
        <div className="trace__record">
          <Timeline trace={trace} />
          {model && <p className="trace__model">{model.label}: {model.text}</p>}
        </div>
      )}
    </div>
  );
}
