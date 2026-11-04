// The Mastra (Hono) request, seen through small framework-neutral helpers.
import { randomUUID } from 'node:crypto';
import type { registerApiRoute } from '@mastra/core/server';
import type { z } from 'zod';
import type { ChatEvent } from '../../contracts';
import { AuthError, UpstreamError, ValidationError } from '../../core/errors';
import type { Identity } from '../../ports/auth';
import type { BiRequestContext, IncomingRequestLike } from '../../ports/context';

export type RouteContext = Parameters<NonNullable<Parameters<typeof registerApiRoute>[1]['handler']>>[0];

export const incoming = (c: RouteContext): IncomingRequestLike => ({
  method: c.req.method,
  path: c.req.path,
  header: (name) => c.req.header(name),
  signal: c.req.raw.signal,
});

// The request context for one call. The signal aborts when the caller goes away or `abort` is called.
export function requestContext(c: RouteContext, identity: Identity) {
  const abort = new AbortController();
  const ctx: BiRequestContext = { ...identity, traceId: randomUUID(), signal: AbortSignal.any([c.req.raw.signal, abort.signal]) };
  return { ctx, abort };
}

// Reads and checks a JSON request body. A missing, malformed or invalid body gets a 400 that says what is wrong.
export async function readBody<T>(c: RouteContext, schema: z.ZodType<T>): Promise<T | Response> {
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  if (parsed.success) return parsed.data;
  return c.json({ error: 'Invalid request', issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`) }, 400);
}

// One place that turns core errors into HTTP responses. Anything else is a bug and is rethrown.
export function errorResponse(c: RouteContext, e: unknown): Response {
  if (e instanceof ValidationError) return c.json({ error: e.message }, 400);
  if (e instanceof AuthError) return c.json({ error: e.message, relogin: true }, 401);
  if (e instanceof UpstreamError) return c.json({ error: e.message }, 502);
  throw e;
}

const SSE_HEADERS = { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' };

// Streams the events as Server-Sent Events, one JSON object per `data:` line. When the client disconnects, `abort`
// stops the turn (the supervisor stream, Genie polling and timers).
export function sseResponse(events: AsyncIterable<ChatEvent>, abort: AbortController): Response {
  const enc = new TextEncoder();
  const it = events[Symbol.asyncIterator]();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await it.next();
      if (next.done) controller.close();
      else controller.enqueue(enc.encode(`data: ${JSON.stringify(next.value)}\n\n`));
    },
    cancel() {
      abort.abort(); // the turn ends, which ends the event source
      void it.return?.();
    },
  });
  return new Response(body, { headers: SSE_HEADERS });
}
