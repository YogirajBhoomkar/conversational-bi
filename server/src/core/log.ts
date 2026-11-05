// The logger of the request being handled, without passing it through every function. The service runs each turn
// inside `withLogger` (a logger carrying the trace id); anything called from there, however deep, gets it from `log()`.
// Outside a request (startup, a script) `log()` is the base logger the host set, or a silent one.
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import type { BiLogger } from '../ports/logger';

export const silentLogger: BiLogger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silentLogger };
const current = new AsyncLocalStorage<BiLogger>();

export const log = (): BiLogger => current.getStore() ?? silentLogger;
export const withLogger = <T>(logger: BiLogger, fn: () => T): T => current.run(logger, fn);

// Logs identify a user by a short one-way hash of their id, never by the id (an email or name) itself.
export const userTag = (userId: string) => createHash('sha256').update(userId).digest('hex').slice(0, 12);

// The logger of one request: every line carries its trace id and the user's tag.
export const requestLogger = (base: BiLogger, ctx: { traceId: string; userId: string }) => base.child({ traceId: ctx.traceId, user: userTag(ctx.userId) });
