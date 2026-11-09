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
}): Promise<void> {
  const res = await fetch('/bi/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ threadId: args.threadId, message: args.message, ...(args.history?.length ? { history: args.history } : {}) }),
    signal: args.signal,
  });
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
