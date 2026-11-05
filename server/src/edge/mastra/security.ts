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
