// Security headers on every response this server sends (API and, locally, the UI).
// frame-ancestors says who may show the page in a frame (BI_FRAME_ANCESTORS, default only this origin), which matters
// when the page is embedded in another application. HSTS is left to the TLS ingress in front of the service.
import type { RouteContext } from './http';

export function securityHeaders(frameAncestors: string) {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': `frame-ancestors ${frameAncestors}`,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
  return async (c: RouteContext, next: () => Promise<void>) => {
    await next();
    for (const [name, value] of Object.entries(headers)) c.res.headers.set(name, value);
  };
}

// Mastra's server also serves its own API under /api: the agent list with every agent's full instructions, an "agent
// card" per agent (the system prompt again), the tools, the workflows, and routes that RUN an agent directly. None of
// them goes through our sign-in, limits, guards or logs, so all of /api answers 404. Our own routes stay reachable even
// if a host puts BI_ROUTE_PREFIX under /api.
export function closeMastraApi(routePrefix: string) {
  const ours = routePrefix.replace(/\/+$/, '');
  return async (c: RouteContext, next: () => Promise<void>) => {
    const path = c.req.path;
    if (ours && (path === ours || path.startsWith(`${ours}/`))) return next();
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  };
}
