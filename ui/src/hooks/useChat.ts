import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthRequiredError, streamChat } from '../api/chatApi';
import type { ChatEvent, Failure, Message, TraceItem } from '../types';
import { buildHistory } from './history';

type Assistant = Extract<Message, { role: 'assistant' }>;

// The same trace id sent again updates that entry in place.
const upsertTrace = (trace: TraceItem[], item: TraceItem): TraceItem[] => {
  const i = trace.findIndex((t) => t.id === item.id);
  if (i < 0) return [...trace, item];
  const next = [...trace];
  next[i] = { ...trace[i], ...item };
  return next;
};

// The parts of a failure, from the server's error event, or for a failure on the way to the server.
const failureOf = (e: Extract<ChatEvent, { type: 'error' }>): Failure => ({ kind: e.kind, title: e.title, detail: e.detail ?? e.message, retryable: e.retryable, reference: e.reference });
const UNREACHABLE: Failure = { kind: 'unavailable', title: "Couldn't reach the assistant", detail: 'Check your connection, then try again.', retryable: true };
const NO_ANSWER: Failure = { kind: 'failed', title: 'No answer came back', detail: 'The answer stopped before it was complete. Please try again.', retryable: true };

let counter = 0;
const uid = () => `${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadId, setThreadId] = useState(() => crypto.randomUUID());
  const controllers = useRef(new Set<AbortController>());

  // Busy until the answer (`final`) is in. The stream may stay open a few seconds more for follow-up suggestions.
  const busy = messages.some((m) => m.role === 'assistant' && m.pending);

  useEffect(() => {
    const open = controllers.current;
    return () => open.forEach((c) => c.abort());
  }, []);

  const patch = useCallback((id: string, fn: (m: Assistant) => Assistant) => {
    setMessages((ms) => ms.map((m) => (m.id === id && m.role === 'assistant' ? fn(m) : m)));
  }, []);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || busy) return;
      // The chat so far goes with the question: the server keeps no transcript.
      const history = buildHistory(messages);
      const id = uid();
      const aid = `a-${id}`;
      setMessages((ms) => [
        ...ms,
        { id: `u-${id}`, role: 'user', text: question },
        { id: aid, role: 'assistant', text: '', trace: [], startedAt: Date.now(), pending: true },
      ]);

      const ctrl = new AbortController();
      controllers.current.add(ctrl);

      const apply = (e: ChatEvent) => {
        switch (e.type) {
          case 'trace':
            patch(aid, (m) => ({ ...m, trace: upsertTrace(m.trace, e.item) }));
            break;
          case 'text':
            patch(aid, (m) => ({ ...m, text: m.text + e.delta }));
            break;
          case 'text-reset': // what streamed as the answer was a working note; it is in the scratchpad now
            patch(aid, (m) => ({ ...m, text: '' }));
            break;
          case 'final':
            patch(aid, (m) => ({ ...m, result: e.result, text: e.result.answer || m.text, pending: false, endedAt: Date.now() }));
            break;
          case 'suggestions':
            patch(aid, (m) => ({ ...m, suggestions: e.questions }));
            break;
          case 'error':
            patch(aid, (m) => ({ ...m, error: e.message, failure: failureOf(e), pending: false, endedAt: m.endedAt ?? Date.now() }));
            break;
        }
      };

      try {
        await streamChat({ threadId, message: question, history, signal: ctrl.signal, onEvent: apply });
        // Stream closed without a `final` or `error` event.
        patch(aid, (m) => (m.pending ? { ...m, pending: false, endedAt: Date.now(), ...(m.result ? {} : { error: NO_ANSWER.detail, failure: NO_ANSWER }) } : m));
      } catch (err) {
        if (ctrl.signal.aborted) return;
        if (err instanceof AuthRequiredError) {
          window.location.href = '/auth/login';
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        // fetch rejects with a TypeError when the server cannot be reached at all; other errors carry the server's text.
        const failure: Failure = err instanceof TypeError ? UNREACHABLE : { kind: 'failed', detail: message, retryable: true };
        patch(aid, (m) => ({ ...m, error: message, failure, pending: false, endedAt: Date.now() }));
      } finally {
        controllers.current.delete(ctrl);
      }
    },
    [busy, messages, patch, threadId],
  );

  const newChat = useCallback(() => {
    controllers.current.forEach((c) => c.abort());
    controllers.current.clear();
    setMessages([]);
    setThreadId(crypto.randomUUID());
  }, []);

  // Asks a failed question again: the failed turn is replaced by the new attempt.
  const retry = useCallback(
    (assistantId: string) => {
      if (busy) return;
      const i = messages.findIndex((m) => m.id === assistantId);
      const asked = messages[i - 1];
      if (i < 1 || asked.role !== 'user') return;
      setMessages((ms) => ms.filter((m) => m.id !== assistantId && m.id !== asked.id));
      void send(asked.text);
    },
    [busy, messages, send],
  );

  return { messages, busy, send, retry, newChat };
}
