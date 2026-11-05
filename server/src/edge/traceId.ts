// The trace id of a request, for any host (Mastra routes, a NestJS controller): the caller's, when it sends one (W3C
// traceparent, or X-Trace-Id), so our log lines join the caller's trace; otherwise a new one.
import { randomUUID } from 'node:crypto';

const TRACEPARENT = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/;
const TRACE_ID = /^[A-Za-z0-9._-]{8,128}$/;

export function traceIdOf(header: (name: string) => string | undefined): string {
  const parent = TRACEPARENT.exec(header('traceparent')?.trim() ?? '')?.[1];
  const given = header('x-trace-id')?.trim();
  return parent ?? (given && TRACE_ID.test(given) ? given : randomUUID());
}
