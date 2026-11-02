import type { ChatEvent } from './types';

export class ReloginError extends Error {}

export type Me = { authenticated: boolean; mode: 'oauth' | 'shared-token'; user?: string };

export async function getMe(): Promise<Me> {
  const res = await fetch('/auth/me');
  if (!res.ok) throw new Error(`Server error ${res.status}`);
  return res.json();
}

export async function logout() {
  await fetch('/auth/logout', { method: 'POST' });
}

// POST /bi/chat returns Server-Sent Events; parse `data:` lines from the fetch body stream.
export async function streamChat(threadId: string, message: string, onEvent: (e: ChatEvent) => void, signal?: AbortSignal) {
  const res = await fetch('/bi/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId, message }),
    signal,
  });
  if (res.status === 401) throw new ReloginError((await res.json().catch(() => ({}))).error ?? 'Your session has expired. Please log in again.');
  if (!res.ok || !res.body) throw new Error(`Server error ${res.status}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
      if (data) onEvent(JSON.parse(data) as ChatEvent);
    }
  }
}

export async function sendFeedback(body: { spaceId: string; conversationId: string; messageId: string; rating: 'POSITIVE' | 'NEGATIVE' }) {
  const res = await fetch('/bi/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error('Feedback failed');
}
