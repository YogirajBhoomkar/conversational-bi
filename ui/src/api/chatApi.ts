import type { ChatEvent, HistoryTurn } from '../types';

/** The server answered 401 with `relogin: true`: the session is missing or expired. */
export class AuthRequiredError extends Error {}

async function errorFrom(res: Response): Promise<Error> {
  const body = await res.json().catch(() => null);
  if (res.status === 401) return new AuthRequiredError(body?.error ?? 'Please log in.');
  const issues = Array.isArray(body?.issues) ? body.issues.join('; ') : '';
  return new Error([body?.error ?? `Request failed (${res.status})`, issues].filter(Boolean).join(': '));
}

/**
 * POST /bi/chat and read the Server-Sent Events stream. One JSON ChatEvent per `data:` line,
 * events separated by a blank line. Resolves when the server closes the stream.
 */
export async function streamChat(args: {
  threadId: string;
  message: string;
  history?: HistoryTurn[]; // earlier turns, oldest first
  signal?: AbortSignal;
  onEvent: (event: ChatEvent) => void;
  onTraceId?: (traceId: string) => void; // the turn's reference, from the response header (failed turns have it too)
}): Promise<void> {
  const res = await fetch('/bi/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ threadId: args.threadId, message: args.message, ...(args.history?.length ? { history: args.history } : {}) }),
    signal: args.signal,
  });
  const traceId = res.headers.get('X-Trace-Id');
  if (traceId) args.onTraceId?.(traceId);
  if (!res.ok) throw await errorFrom(res);
  if (!res.body) throw new Error('The server did not return a stream.');

  const dispatch = (frame: string) => {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) return;
    try {
      args.onEvent(JSON.parse(data) as ChatEvent);
    } catch {
      /* ignore a malformed frame */
    }
  };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      dispatch(buffer.slice(0, end));
      buffer = buffer.slice(end + 2);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) dispatch(buffer);
}

export async function sendFeedback(body: { spaceId: string; conversationId: string; messageId: string; rating: 'POSITIVE' | 'NEGATIVE' }): Promise<void> {
  const res = await fetch('/bi/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await errorFrom(res);
}

// Proposed (contract 1.4.0): where feedback emails go, and the caller's user ref. null when it cannot be read, which
// hides the Send feedback button.
export async function getClientConfig(): Promise<import('../feedback/types').ClientConfig | null> {
  try {
    const res = await fetch('/bi/client-config', { credentials: 'same-origin' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// Proposed: counts that a feedback email was opened, by type. Fire and forget: a failure is never shown.
export function sendFeedbackOpened(body: { traceId: string; turn: number; format: 'text' | 'eml'; reason: string | null }): Promise<void> {
  return fetch('/bi/feedback/opened', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  }).then(
    () => undefined,
    () => undefined,
  );
}
