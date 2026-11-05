import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '../../contracts';
import { z } from 'zod';
import { UpstreamError } from '../../core/errors';
import { silentLogger } from '../../core/log';
import { traceIdOf } from '../traceId';
import { errorResponse, readBody, type RouteContext, sseResponse } from './http';

describe('sseResponse', () => {
  it('writes one `data:` line per event, byte for byte', async () => {
    async function* events(): AsyncGenerator<ChatEvent> {
      yield { type: 'text', delta: 'hi' };
      yield { type: 'error', message: 'x' };
    }
    const res = sseResponse(events(), new AbortController(), { traceId: 'trace-1', heartbeatMs: 0 });
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
    const reader = sseResponse(events(), abort, { traceId: 't', heartbeatMs: 0 }).body!.getReader();
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

describe('sseResponse keep-alive and end', () => {
  it('sends a keep-alive comment during a silence, and calls done once when the stream ends', async () => {
    let done = 0;
    async function* slow(): AsyncGenerator<ChatEvent> {
      await new Promise((r) => setTimeout(r, 60));
      yield { type: 'text', delta: 'late' };
    }
    const text = await sseResponse(slow(), new AbortController(), { traceId: 't', heartbeatMs: 20, done: () => done++ }).text();
    expect(text.startsWith(': keep-alive\n\n')).toBe(true);
    expect(text.endsWith('data: {"type":"text","delta":"late"}\n\n')).toBe(true);
    expect(done).toBe(1);
  });

  it('calls done when the client leaves', async () => {
    let done = 0;
    async function* forever(): AsyncGenerator<ChatEvent> {
      yield { type: 'text', delta: 'a' };
      await new Promise(() => {});
    }
    const reader = sseResponse(forever(), new AbortController(), { traceId: 't', heartbeatMs: 0, done: () => done++ }).body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(done).toBe(1);
  });
});

describe('readBody', () => {
  const ctx = (body: string, headers: Record<string, string> = {}) =>
    ({ req: { header: (n: string) => headers[n.toLowerCase()], raw: new Request('http://x/bi/chat', { method: 'POST', body }) } }) as unknown as RouteContext;
  const schema = z.object({ message: z.string() });

  it('parses a valid body and rejects an invalid one with 400', async () => {
    expect(await readBody(ctx('{"message":"hi"}'), schema, 100)).toEqual({ message: 'hi' });
    expect(((await readBody(ctx('{"message":1}'), schema, 100)) as Response).status).toBe(400);
  });

  it('refuses a body over the limit with 413, by header or by size', async () => {
    expect(((await readBody(ctx('{}', { 'content-length': '5000' }), schema, 100)) as Response).status).toBe(413);
    expect(((await readBody(ctx(JSON.stringify({ message: 'x'.repeat(500) })), schema, 100)) as Response).status).toBe(413);
  });
});

describe('errorResponse', () => {
  it('keeps the message of a known error and hides an unexpected one behind a reference', async () => {
    expect((await errorResponse(new UpstreamError('Genie is down'), silentLogger, 't1').json())).toEqual({ error: 'Genie is down', traceId: 't1' });
    const res = errorResponse(new Error('TypeError at line 42 of secret.ts'), silentLogger, 't2');
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret.ts');
  });
});
