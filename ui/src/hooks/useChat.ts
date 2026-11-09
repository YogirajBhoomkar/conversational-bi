import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthRequiredError, streamChat } from '../api/chatApi';
import type { ChatEvent, Message, TraceItem } from '../types';
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
            patch(aid, (m) => ({ ...m, error: e.message, pending: false, endedAt: m.endedAt ?? Date.now() }));
            break;
        }
      };

      try {
        await streamChat({ threadId, message: question, history, signal: ctrl.signal, onEvent: apply });
        // Stream closed without a `final` or `error` event.
        patch(aid, (m) => (m.pending ? { ...m, pending: false, endedAt: Date.now(), error: m.result ? undefined : 'The response ended without an answer.' } : m));
      } catch (err) {
        if (ctrl.signal.aborted) return;
        if (err instanceof AuthRequiredError) {
          window.location.href = '/auth/login';
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        patch(aid, (m) => ({ ...m, error: message, pending: false, endedAt: Date.now() }));
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

  return { messages, busy, send, newChat };
}
