// The Mastra (Hono) request, seen through small framework-neutral helpers.
import { randomUUID } from 'node:crypto';
import type { registerApiRoute } from '@mastra/core/server';
import type { z } from 'zod';
import type { ChatEvent } from '../../contracts';
import type { Refusal } from '../../core/admission';
import { AuthError, UpstreamError, ValidationError } from '../../core/errors';
import type { Identity } from '../../ports/auth';
import type { BiRequestContext, IncomingRequestLike } from '../../ports/context';
import type { BiLogger } from '../../ports/logger';

export type RouteContext = Parameters<NonNullable<Parameters<typeof registerApiRoute>[1]['handler']>>[0];

export const incoming = (c: RouteContext): IncomingRequestLike => ({
  method: c.req.method,
  path: c.req.path,
  header: (name) => c.req.header(name),
  signal: c.req.raw.signal,
});

// The trace id of a request: the caller's, when it sends one (W3C traceparent, or X-Trace-Id), so our log lines join the
// caller's trace; otherwise a new one. Returned in the X-Trace-Id response header.
const TRACEPARENT = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/;
const TRACE_ID = /^[A-Za-z0-9._-]{8,128}$/;
export function traceIdOf(header: (name: string) => string | undefined): string {
  const parent = TRACEPARENT.exec(header('traceparent')?.trim() ?? '')?.[1];
  const given = header('x-trace-id')?.trim();
  return parent ?? (given && TRACE_ID.test(given) ? given : randomUUID());
}

// The request context for one call. The signal aborts when the caller goes away or `abort` is called.
export function requestContext(c: RouteContext, identity: Identity, traceId: string) {
  const abort = new AbortController();
  const ctx: BiRequestContext = { ...identity, traceId, signal: AbortSignal.any([c.req.raw.signal, abort.signal]) };
  return { ctx, abort };
}

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

// Reads the body up to `maxBytes` (413 above it, without reading the rest) and checks it against the schema (400 with
// what is wrong).
export async function readBody<T>(c: RouteContext, schema: z.ZodType<T>, maxBytes: number): Promise<T | Response> {
  const tooLarge = () => json({ error: `The request is larger than ${maxBytes} bytes.` }, 413);
  if (Number(c.req.header('content-length') ?? 0) > maxBytes) return tooLarge();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = c.req.raw.body?.getReader();
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return tooLarge();
    }
    chunks.push(value);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    body = undefined;
  }
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  return json({ error: 'Invalid request', issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`) }, 400);
}

// A refused question: 503 (switched off, restarting) or 429 (too many running), with when to try again.
export const refusalResponse = (r: Refusal) => json({ error: r.message, reason: r.reason }, r.status, { 'Retry-After': String(r.retryAfterSeconds) });

// The one place that turns errors into HTTP responses. Known errors keep their message; anything else is a bug, logged
// in full and answered with a reference only, so no internal detail reaches the caller.
export function errorResponse(e: unknown, log: BiLogger, traceId: string): Response {
  if (e instanceof ValidationError) return json({ error: e.message }, 400);
  if (e instanceof AuthError) return json({ error: e.message, relogin: true }, 401);
  if (e instanceof UpstreamError) return json({ error: e.message, traceId }, 502);
  log.error('http.unexpected_error', { error: e });
  return json({ error: 'Something went wrong. If it happens again, quote this reference.', traceId }, 500);
}

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform', // no-transform: proxies must not compress or rewrite the stream
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',                 // nginx (and the AKS ingress) would otherwise hold the stream back
};
const KEEP_ALIVE = ': keep-alive\n\n';         // an SSE comment: the browser ignores it, proxies see traffic

// Streams the events as Server-Sent Events, one JSON object per `data:` line. During a silence longer than
// `heartbeatMs` a keep-alive comment is sent. When the client disconnects, `abort` stops the turn. `done` runs once
// when the stream ends, however it ends (finished, failed, or the client left).
export function sseResponse(events: AsyncIterable<ChatEvent>, abort: AbortController, opts: { traceId: string; heartbeatMs: number; done?: () => void }): Response {
  const enc = new TextEncoder();
  const it = events[Symbol.asyncIterator]();
  let pending: Promise<IteratorResult<ChatEvent>> | undefined;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    opts.done?.();
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      pending ??= it.next();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tick = opts.heartbeatMs > 0 ? new Promise<'tick'>((resolve) => (timer = setTimeout(() => resolve('tick'), opts.heartbeatMs))) : new Promise<never>(() => {});
      try {
        const next = await Promise.race([pending, tick]);
        if (next === 'tick') return controller.enqueue(enc.encode(KEEP_ALIVE));
        pending = undefined;
        if (next.done) {
          controller.close();
          finish();
        } else controller.enqueue(enc.encode(`data: ${JSON.stringify(next.value)}\n\n`));
      } catch (e) {
        controller.error(e);
        finish();
      } finally {
        clearTimeout(timer);
      }
    },
    cancel() {
      abort.abort(); // the turn ends, which ends the event source
      void it.return?.();
      finish();
    },
  });
  return new Response(body, { headers: { ...SSE_HEADERS, 'X-Trace-Id': opts.traceId } });
}
