// Local mode only: Databricks login (cookie session) and serving the built UI from the same port.
// Never registered in gc mode, where GC's own sign-in and UI are used.
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { registerApiRoute } from '@mastra/core/server';
import { buildLoginUrl, exchangeCode, fetchUserName } from '../../adapters/local/auth/oauth';
import { COOKIE, cookie, createSession, destroySession, getSession, readSessionId } from '../../adapters/local/auth/sessions';
import type { BiConfig } from '../../config/load';
import type { RouteContext } from './http';

export function localAuthRoutes(config: BiConfig) {
  const oauth = config.databricks.oauth;
  return [
    registerApiRoute('/auth/me', {
      method: 'GET',
      handler: async (c) => {
        if (!oauth) return c.json({ authenticated: true, mode: 'shared-token', user: 'dev' });
        const session = getSession(readSessionId(c.req.header('cookie')));
        return c.json(session ? { authenticated: true, mode: 'oauth', user: session.user } : { authenticated: false, mode: 'oauth' });
      },
    }),
    registerApiRoute('/auth/login', {
      method: 'GET',
      handler: async (c) => (oauth ? c.redirect(buildLoginUrl(oauth)) : c.redirect('/')),
    }),
    registerApiRoute('/auth/callback', {
      method: 'GET',
      handler: async (c) => {
        const fail = (msg: string) => c.redirect(`/?login_error=${encodeURIComponent(msg)}`);
        const err = c.req.query('error_description') ?? c.req.query('error');
        const code = c.req.query('code');
        const state = c.req.query('state');
        if (err) return fail(err);
        if (!code || !state) return fail('Login response was incomplete. Please log in again.');
        if (!oauth) return fail('Login is not configured.');
        try {
          const t = await exchangeCode(oauth, code, state);
          const id = createSession(t, await fetchUserName(oauth, t.accessToken));
          c.header('Set-Cookie', cookie(id, 8 * 3600, new URL(c.req.url).protocol === 'https:'));
          return c.redirect('/');
        } catch (e) {
          return fail(e instanceof Error ? e.message : 'Login failed');
        }
      },
    }),
    registerApiRoute('/auth/logout', {
      method: 'POST',
      handler: async (c) => {
        destroySession(readSessionId(c.req.header('cookie')));
        c.header('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
        return c.json({ ok: true });
      },
    }),
  ];
}

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml',
  json: 'application/json', png: 'image/png', ico: 'image/x-icon', woff2: 'font/woff2', map: 'application/json',
};

// Serves the built React UI (UI_DIST). Falls through for API paths, and does nothing when UI_DIST is unset.
export function serveUi(config: BiConfig) {
  const api = ['/api', config.routePrefix, '/auth/', '/swagger', '/health'];
  return async (c: RouteContext, next: () => Promise<void>) => {
    const dist = config.uiDist;
    const path = c.req.path;
    if (!dist || c.req.method !== 'GET' || api.some((p) => path.startsWith(p))) return next();
    const rel = normalize(path === '/' ? '/index.html' : path).replace(/^([/\\])+/, '');
    if (rel.startsWith('..')) return next();
    for (const file of [rel, 'index.html']) {
      try {
        const buf = await readFile(join(dist, file));
        return new Response(buf, { headers: { 'Content-Type': MIME[extname(file).slice(1)] ?? 'application/octet-stream' } });
      } catch { /* try the SPA fallback */ }
    }
    return next();
  };
}
