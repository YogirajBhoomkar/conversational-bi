// POST <prefix>/chat (SSE) and POST <prefix>/feedback on Mastra's server. Authentication, body parsing and encoding only;
// the work happens in the service.
import { registerApiRoute } from '@mastra/core/server';
import { ChatRequestSchema, FeedbackRequestSchema } from '../../contracts';
import type { BiService } from '../../core/service';
import type { Authenticator } from '../../ports/auth';
import { errorResponse, incoming, readBody, requestContext, type RouteContext, sseResponse } from './http';

async function identify(c: RouteContext, authenticator: Authenticator) {
  const auth = await authenticator.authenticate(incoming(c));
  return auth.ok ? auth.identity : c.json({ error: auth.message, relogin: auth.relogin }, auth.status);
}

export function createBiRoutes(service: BiService, authenticator: Authenticator, prefix: string) {
  return [
    registerApiRoute(`${prefix}/chat`, {
      method: 'POST',
      handler: async (c) => {
        const identity = await identify(c, authenticator);
        if (identity instanceof Response) return identity;
        const request = await readBody(c, ChatRequestSchema);
        if (request instanceof Response) return request;
        const { ctx, abort } = requestContext(c, identity);
        return sseResponse(service.handleChat(ctx, request), abort);
      },
    }),
    registerApiRoute(`${prefix}/feedback`, {
      method: 'POST',
      handler: async (c) => {
        const identity = await identify(c, authenticator);
        if (identity instanceof Response) return identity;
        const request = await readBody(c, FeedbackRequestSchema);
        if (request instanceof Response) return request;
        try {
          await service.handleFeedback(requestContext(c, identity).ctx, request);
          return c.json({ ok: true });
        } catch (e) {
          return errorResponse(c, e);
        }
      },
    }),
  ];
}
