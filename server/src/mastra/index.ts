import 'dotenv/config';
import { Mastra } from '@mastra/core';
import { RequestContext } from '@mastra/core/request-context';
import { registerApiRoute } from '@mastra/core/server';
import { LibSQLStore } from '@mastra/libsql';
import type { z } from 'zod';
import { ChatRequestSchema, FeedbackRequestSchema, type ChatEvent, type FinalAnswer } from '../contracts';
import { loadProcessConfig } from '../config/load';
import type { TokenProvider } from '../contracts';
import { PatTokenProvider } from '../auth/tokenProvider';
import { buildLoginUrl, exchangeCode, fetchUserName, refreshTokens } from '../auth/oauth';
import { AuthError, COOKIE, SessionTokenProvider, cookie, createSession, destroySession, getSession, readSessionId } from '../auth/sessions';
import { DatabricksGenieAgentClient } from '../genie/agentClient';
import { DatabricksGenieClient } from '../genie/client';
import { createSpaceRegistry } from '../genie/registry';
import { retryPolicy } from '../genie/retry';
import { createAgents, modelLabel } from './agents';
import { newCollector } from './collector';
import { recentTurns, recordTurn } from './history';
import { createTracer } from './trace';
import { suggestFollowUps } from './suggest';

const { config, warnings } = loadProcessConfig();
warnings.forEach((w) => console.warn(`[config] ${w}`));
if (config.mode === 'gc') throw new Error('BI_MODE=gc needs the Okta sign-in, which is not wired in yet.'); // TODO(GC:okta-verifier)
const registry = createSpaceRegistry(config.spaces);

// OAuth (per-user Databricks login) when DATABRICKS_CLIENT_ID is set; otherwise the shared PAT (dev only).
const oauth = config.databricks.oauth;
if (!oauth) console.warn('DATABRICKS_CLIENT_ID not set: using the shared DATABRICKS_TOKEN, no user login.');
const tokens: TokenProvider = oauth ? new SessionTokenProvider((refreshToken) => refreshTokens(oauth, refreshToken)) : new PatTokenProvider(config.databricks.token);
// GENIE_MODE=agent uses the Agent mode API (GA): streams the agent's real reasoning. Default is the Conversation API.
const genieOptions = { host: config.databricks.host, rowCap: config.genie.rowCap, timeoutMs: config.genie.timeoutMs, retry: retryPolicy(config.genie.retryAttempts) };
const genie = config.genie.mode === 'agent' ? new DatabricksGenieAgentClient(tokens, genieOptions) : new DatabricksGenieClient(tokens, genieOptions);
const { supervisor, genieAgents, suggestAgent } = createAgents(genie, { registry, model: config.model, domainRules: config.domainRules, fullRowCap: config.genie.fullRowCap });
const sse = (e: ChatEvent) => `data: ${JSON.stringify(e)}\n\n`;

// Resolves the caller. In PAT mode everyone is the shared dev user; in OAuth mode a valid, refreshable session is required.
async function authenticate(c: any): Promise<{ sessionId?: string; user: string } | Response> {
  if (!oauth) return { user: 'dev' };
  const sessionId = readSessionId(c.req.header('cookie'));
  const session = getSession(sessionId);
  if (!sessionId || !session) return c.json({ error: 'Please log in.', relogin: true }, 401);
  try {
    await tokens.getToken({ sessionId }); // refreshes if needed
  } catch (e) {
    if (e instanceof AuthError) return c.json({ error: e.message, relogin: true }, 401);
    throw e;
  }
  return { sessionId, user: session.user };
}

// Reads and checks a JSON request body. A missing, malformed or invalid body gets a 400 that says what is wrong.
async function readBody<T>(c: any, schema: z.ZodType<T>): Promise<T | Response> {
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  if (parsed.success) return parsed.data;
  return c.json({ error: 'Invalid request', issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`) }, 400);
}

const chatRoute = registerApiRoute('/bi/chat', {
  method: 'POST',
  handler: async (c) => {
    const who = await authenticate(c);
    if (who instanceof Response) return who;
    const request = await readBody(c, ChatRequestSchema);
    if (request instanceof Response) return request;
    const { threadId: rawThread, message } = request;
    const threadId = `${who.user}::${rawThread}`; // threads are per user

    // Follow-ups need only the Genie descriptions and the chat so far, so they are written in parallel with the answer, not after it.
    const pendingSuggestions = suggestFollowUps(suggestAgent, registry, { question: message, history: recentTurns(threadId) });

    const collector = newCollector();
    const requestContext = new RequestContext();
    requestContext.set('collector', collector);
    requestContext.set('threadId', threadId);
    requestContext.set('sessionId', who.sessionId);
    const enc = new TextEncoder();

    const body = new ReadableStream({
      async start(controller) {
        let closed = false;
        const send = (e: ChatEvent) => {
          if (!closed) controller.enqueue(enc.encode(sse(e)));
        };
        let answer = '';
        const tracer = createTracer({
          trace: (item) => send({ type: 'trace', item }),
          answer: (delta) => {
            answer += delta;
            send({ type: 'text', delta });
          },
        }, registry);
        collector.emit = tracer.progress;
        send({ type: 'trace', item: { id: 'model', kind: 'meta', label: 'Using model', text: modelLabel(config.model) } });
        let ours: string[] = [];
        void pendingSuggestions.then((questions) => {
          ours = questions;
          if (questions.length) send({ type: 'suggestions', questions }); // may arrive before or after `final`; the UI handles both
        });
        try {
          const stream = await supervisor.stream(message, {
            requestContext,
            memory: { thread: threadId, resource: who.user },
            abortSignal: c.req.raw.signal,
          });
          for await (const chunk of stream.fullStream as AsyncIterable<any>) {
            if (chunk.type === 'error') {
              const p = chunk.payload ?? chunk;
              throw new Error(String(p.error?.message ?? p.error ?? 'agent error'));
            }
            tracer.handle(chunk);
          }
          tracer.end();
          const withData = [...collector.results].reverse().find((r) => r.columns.length);
          // Loading the full result re-uses an earlier message, so keep one source per message (the latest).
          const sources = [...new Map(collector.results.map((r) => [r.messageId, r])).values()];
          const final: FinalAnswer = {
            answer,
            columns: withData?.columns ?? [],
            rows: withData?.rows ?? [],
            totalRows: withData?.totalRows ?? 0,
            chartSpec: collector.chart,
            sources: sources.map((r) => ({
              spaceId: r.spaceId,
              spaceName: registry.byId(r.spaceId)?.name ?? r.spaceId,
              question: r.question,
              sql: r.sql,
              messageId: r.messageId,
              conversationId: r.conversationId,
            })),
            suggestedQuestions: [...collector.results].reverse().find((r) => r.suggestedQuestions.length)?.suggestedQuestions ?? [],
          };
          send({ type: 'final', result: final });
          // Genie's own follow-ups (Conversation API) win. Otherwise ours are usually ready already; give them a short moment, but never hold the stream open for long.
          if (!final.suggestedQuestions.length) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            await Promise.race([pendingSuggestions, new Promise((resolve) => (timer = setTimeout(resolve, config.suggestWaitMs)))]);
            clearTimeout(timer);
          }
          recordTurn(threadId, { question: message, answer, suggested: final.suggestedQuestions.length ? final.suggestedQuestions : ours });
        } catch (err) {
          send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        } finally {
          closed = true;
          controller.close();
        }
      },
    });

    return new Response(body, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  },
});

const feedbackRoute = registerApiRoute('/bi/feedback', {
  method: 'POST',
  handler: async (c) => {
    const who = await authenticate(c);
    if (who instanceof Response) return who;
    const body = await readBody(c, FeedbackRequestSchema);
    if (body instanceof Response) return body;
    if (!registry.byId(body.spaceId)) return c.json({ error: 'unknown space' }, 400);
    try {
      await genie.feedback({ ...body, sessionId: who.sessionId });
      return c.json({ ok: true });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
    }
  },
});

const authRoutes = [
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

// Serve the built React UI (UI_DIST) from the same port as the API. Falls through for API paths and when unset.
const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml',
  json: 'application/json', png: 'image/png', ico: 'image/x-icon', woff2: 'font/woff2', map: 'application/json',
};
const serveUi = async (c: any, next: () => Promise<void>) => {
  const dist = config.uiDist;
  const path: string = c.req.path;
  if (!dist || c.req.method !== 'GET' || path.startsWith('/api') || path.startsWith('/bi') || path.startsWith('/auth/') || path.startsWith('/swagger')) return next();
  const { readFile } = await import('node:fs/promises');
  const { join, normalize, extname } = await import('node:path');
  const rel = normalize(path === '/' ? '/index.html' : path).replace(/^([/\\])+/, '');
  if (rel.startsWith('..')) return next();
  for (const file of [rel, 'index.html']) {
    try {
      const buf = await readFile(join(dist, file));
      return new Response(buf, { headers: { 'Content-Type': MIME[extname(file).slice(1)] ?? 'application/octet-stream' } });
    } catch { /* try SPA fallback */ }
  }
  return next();
};

export const mastra = new Mastra({
  agents: { supervisor, suggestAgent, ...genieAgents },
  storage: new LibSQLStore({ id: 'mastra-storage', url: 'file:./mastra.db' }),
  server: {
    port: config.port,
    cors: { origin: ['http://localhost:5173'], allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type'] },
    middleware: [{ path: '/*', handler: serveUi }],
    apiRoutes: [chatRoute, feedbackRoute, ...authRoutes],
  },
});

