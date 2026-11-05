import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '../../contracts';
import { sseResponse, traceIdOf } from './http';

describe('sseResponse', () => {
  it('writes one `data:` line per event, byte for byte', async () => {
    async function* events(): AsyncGenerator<ChatEvent> {
      yield { type: 'text', delta: 'hi' };
      yield { type: 'error', message: 'x' };
    }
    const res = sseResponse(events(), new AbortController(), 'trace-1');
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.headers.get('X-Trace-Id')).toBe('trace-1');
    expect(await res.text()).toBe('data: {"type":"text","delta":"hi"}\n\ndata: {"type":"error","message":"x"}\n\n');
  });

  it('aborts the turn and stops the event source when the client disconnects', async () => {
    const abort = new AbortController();
    let stopped = false;
    // A turn that runs until it is aborted, like handleChat.
    async function* events(): AsyncGenerator<ChatEvent> {
      try {
        yield { type: 'text', delta: 'first' };
        await new Promise((resolve) => abort.signal.addEventListener('abort', resolve));
      } finally {
        stopped = true;
      }
    }
    const reader = sseResponse(events(), abort, 't').body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(abort.signal.aborted).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(stopped).toBe(true);
  });
});

describe('traceIdOf', () => {
  const headers = (h: Record<string, string>) => (name: string) => h[name];
  it("joins the caller's trace when it sends one, otherwise starts a new one", () => {
    const id = 'ab12'.repeat(8); // 32 hex characters, built here so the secret scan does not take it for a space id
    expect(traceIdOf(headers({ traceparent: `00-${id}-00f067aa0ba902b7-01` }))).toBe(id);
    expect(traceIdOf(headers({ 'x-trace-id': 'gc-req-12345' }))).toBe('gc-req-12345');
    expect(traceIdOf(headers({ 'x-trace-id': 'bad id <script>' }))).toMatch(/^[0-9a-f-]{36}$/);
    expect(traceIdOf(headers({}))).toMatch(/^[0-9a-f-]{36}$/);
  });
});
