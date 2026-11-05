// The HTTP API on Mastra's server: POST <prefix>/chat (SSE), POST <prefix>/feedback, and the health checks.
// Admission, authentication, body limits and encoding only; the work happens in the service.
import { registerApiRoute } from '@mastra/core/server';
import { ChatRequestSchema, CONTRACT_VERSION, FeedbackRequestSchema } from '../../contracts';
import { type Admission, isRefusal } from '../../core/admission';
import { requestLogger } from '../../core/log';
import type { BiService } from '../../core/service';
import type { Authenticator } from '../../ports/auth';
import type { BiLogger } from '../../ports/logger';
import { traceIdOf } from '../traceId';
import { errorResponse, incoming, readBody, refusalResponse, requestContext, type RouteContext, sseResponse } from './http';

export type RouteOptions = { prefix: string; maxBodyBytes: number; heartbeatMs: number; build: string };

export function createBiRoutes(service: BiService, authenticator: Authenticator, admission: Admission, logger: BiLogger, opts: RouteOptions) {
  // Authenticates the caller. A refusal is answered here (401/403, with whether to log in again) and logged.
  async function identify(c: RouteContext, traceId: string) {
    const auth = await authenticator.authenticate(incoming(c));
    if (auth.ok) return auth.identity;
    logger.warn('auth.rejected', { traceId, path: c.req.path, status: auth.status });
    return c.json({ error: auth.message, relogin: auth.relogin }, auth.status);
  }

  return [
    registerApiRoute(`${opts.prefix}/chat`, {
      method: 'POST',
      handler: async (c) => {
        const traceId = traceIdOf((n) => c.req.header(n));
        try {
          const identity = await identify(c, traceId);
          if (identity instanceof Response) return identity;
          const request = await readBody(c, ChatRequestSchema, opts.maxBodyBytes);
          if (request instanceof Response) return request;
          const slot = admission.admit(identity.userId);
          if (isRefusal(slot)) {
            requestLogger(logger, { traceId, userId: identity.userId }).warn('chat.refused', { reason: slot.reason });
            return refusalResponse(slot);
          }
          const { ctx, abort } = requestContext(c, identity, traceId);
          return sseResponse(service.handleChat(ctx, request), abort, { traceId, heartbeatMs: opts.heartbeatMs, done: slot.release });
        } catch (e) {
          return errorResponse(e, logger.child({ traceId }), traceId);
        }
      },
    }),
    registerApiRoute(`${opts.prefix}/feedback`, {
      method: 'POST',
      handler: async (c) => {
        const traceId = traceIdOf((n) => c.req.header(n));
        try {
          const identity = await identify(c, traceId);
          if (identity instanceof Response) return identity;
          const request = await readBody(c, FeedbackRequestSchema, opts.maxBodyBytes);
          if (request instanceof Response) return request;
          const slot = admission.admit(identity.userId);
          if (isRefusal(slot)) return refusalResponse(slot);
          try {
            await service.handleFeedback(requestContext(c, identity, traceId).ctx, request);
          } finally {
            slot.release();
          }
          return c.json({ ok: true });
        } catch (e) {
          return errorResponse(e, logger.child({ traceId }), traceId);
        }
      },
    }),
    registerApiRoute(`${opts.prefix}/version`, {
      method: 'GET',
      handler: async (c) => c.json({ service: 'conversational-bi', contract: CONTRACT_VERSION, build: opts.build }),
    }),
    // Liveness: the process answers. Readiness: it takes new questions (false while shutting down). Neither calls
    // Databricks, so a Databricks outage does not make Kubernetes restart healthy pods.
    registerApiRoute('/health/live', { method: 'GET', handler: async (c) => c.json({ status: 'ok' }) }),
    registerApiRoute('/health/ready', {
      method: 'GET',
      handler: async (c) => (admission.ready() ? c.json({ status: 'ready', running: admission.running() }) : c.json({ status: 'stopping' }, 503)),
    }),
  ];
}
