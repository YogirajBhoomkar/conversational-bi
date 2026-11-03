import { useEffect, useRef, useState } from 'react';
import { ReloginError, getMe, logout, streamChat, type Me } from './api';
import { Details, Thinking } from './components';
import type { Message } from './types';

const STARTERS = [
  'Chart FOT premium by region',
  'Which reinsurers left the most capacity unused?',
  'How many placements are there by status in 2026?',
];

const newThread = () => crypto.randomUUID();
const loadThread = () => {
  try {
    return localStorage.getItem('bi-thread') ?? newThread();
  } catch {
    return newThread();
  }
};
const stepLabel = (s: string) => (s === 'genie' ? 'Querying Genie…' : s);

function LoginPage({ error }: { error?: string }) {
  return (
    <div className="login">
      <div className="login-card">
        <h1>Conversational BI</h1>
        <p>Log in with your Databricks account to ask questions about placements and reinsurance capacity.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <a className="cta" href="/auth/login">Log in with Databricks</a>
      </div>
    </div>
  );
}

function Chat({ me, onLoggedOut }: { me: Me; onLoggedOut: (msg?: string) => void }) {
  const [threadId, setThreadId] = useState(loadThread);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem('bi-thread', threadId);
    } catch { /* storage unavailable */ }
  }, [threadId]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const patchLast = (fn: (m: Extract<Message, { role: 'assistant' }>) => Partial<Extract<Message, { role: 'assistant' }>>) =>
    setMessages((ms) => ms.map((m, i) => (i === ms.length - 1 && m.role === 'assistant' ? { ...m, ...fn(m) } : m)));

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setInput('');
    setBusy(true);
    setMessages((ms) => [
      ...ms,
      { id: crypto.randomUUID(), role: 'user', text },
      { id: crypto.randomUUID(), role: 'assistant', text: '', steps: [], thinking: [], pending: true },
    ]);
    try {
      await streamChat(threadId, text, (e) => {
        if (e.type === 'text') patchLast((m) => ({ text: m.text + e.delta }));
        else if (e.type === 'thinking') patchLast((m) => ({ thinking: [...m.thinking, e.text] }));
        else if (e.type === 'step') patchLast((m) => ({ steps: e.status === 'start' ? [...m.steps, e.step] : m.steps.filter((s, i, a) => !(s === e.step && i === a.indexOf(s))) }));
        // Follow-ups are written alongside the answer, so they may arrive before `final` (kept until then) or after it.
        // Genie's own follow-ups, when the final answer carries them, take precedence.
        else if (e.type === 'final') patchLast((m) => ({ result: e.result.suggestedQuestions.length ? e.result : { ...e.result, suggestedQuestions: m.suggestions ?? [] }, text: e.result.answer, steps: [], pending: false }));
        else if (e.type === 'suggestions') patchLast((m) => (!m.result ? { suggestions: e.questions } : m.result.suggestedQuestions.length ? {} : { result: { ...m.result, suggestedQuestions: e.questions } }));
        else if (e.type === 'error') patchLast(() => ({ error: e.message, steps: [], pending: false }));
      });
    } catch (err) {
      if (err instanceof ReloginError) return onLoggedOut(err.message);
      patchLast(() => ({ error: err instanceof Error ? err.message : 'Request failed', pending: false }));
    } finally {
      patchLast(() => ({ pending: false, steps: [] }));
      setBusy(false);
    }
  };

  const reset = () => {
    setMessages([]);
    setThreadId(newThread());
  };
  const logOut = async () => {
    await logout().catch(() => undefined);
    onLoggedOut();
  };

  return (
    <div className="shell">
      <aside>
        <div className="brand">Xoriant</div>
        <nav>
          <button className="nav active" onClick={reset} disabled={busy}>New chat</button>
        </nav>
        <div className="side-foot">
          {me.mode === 'oauth' && me.user && <div className="who" title={me.user}>{me.user}</div>}
          {me.mode === 'oauth' && <button className="nav" onClick={logOut}>Log out</button>}
        </div>
      </aside>
      <section className="page">
        <header><h1>Conversational BI</h1></header>
        <main>
          {messages.length === 0 && (
            <div className="empty">
              <p>Ask a question about placements or reinsurance capacity.</p>
              <div className="starters">
                {STARTERS.map((s) => (
                  <button key={s} onClick={() => send(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="msg user">{m.text}</div>
            ) : (
              <div key={m.id} className="msg bot">
                {m.steps.map((s, i) => <div key={i} className="status">{stepLabel(s)}</div>)}
                <Thinking lines={m.thinking} live={m.pending} />
                {m.pending && !m.text && m.steps.length === 0 && m.thinking.length === 0 && <div className="status">Thinking…</div>}
                {m.text && <div className="answer">{m.text}</div>}
                {m.error && <div className="error" role="alert">Something went wrong: {m.error}</div>}
                {m.result && <Details result={m.result} onAsk={(q) => void send(q)} disabled={busy} />}
              </div>
            ),
          )}
          <div ref={endRef} />
        </main>
        <form onSubmit={(e) => { e.preventDefault(); void send(input); }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about placements, FOT premium, reinsurers…" aria-label="Message" disabled={busy} />
          <button type="submit" className="cta" disabled={busy || !input.trim()}>Send</button>
        </form>
      </section>
    </div>
  );
}

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const loginError = q.get('login_error');
    if (loginError) {
      setError(loginError);
      window.history.replaceState({}, '', '/');
    }
    getMe()
      .then((m) => setMe(m.authenticated ? m : null))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="center" aria-busy="true">Loading…</div>;
  if (!me) return <LoginPage error={error} />;
  return (
    <Chat
      me={me}
      onLoggedOut={(msg) => {
        setError(msg);
        setMe(null);
      }}
    />
  );
}
