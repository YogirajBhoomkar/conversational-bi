import 'dotenv/config';
import { Mastra } from '@mastra/core';
import { RequestContext } from '@mastra/core/request-context';
import { registerApiRoute } from '@mastra/core/server';
import { LibSQLStore } from '@mastra/libsql';
import type { ChatEvent, ChatRequest, FeedbackRequest, FinalAnswer } from '../contracts';
import { PatTokenProvider } from '../auth/tokenProvider';
import { buildLoginUrl, exchangeCode, fetchUserName, oauthEnabled } from '../auth/oauth';
import { AuthError, COOKIE, FallbackTokenProvider, SessionTokenProvider, cookie, createSession, destroySession, getSession, readSessionId } from '../auth/sessions';
import { DatabricksGenieAgentClient } from '../genie/agentClient';
import { DatabricksGenieClient } from '../genie/client';
import { genieSpaces, getSpaceById } from '../genie/registry';
import { createAgents } from './agents';
import { newCollector } from './collector';
import { recentTurns, recordTurn } from './history';
import { suggestFollowUps } from './suggest';

// OAuth (per-user Databricks login) when DATABRICKS_CLIENT_ID is set; otherwise the shared PAT (dev only).
const oauth = oauthEnabled();
if (!oauth) console.warn('DATABRICKS_CLIENT_ID not set: using the shared DATABRICKS_TOKEN, no user login.');
const tokens = new FallbackTokenProvider(oauth, new PatTokenProvider(), new SessionTokenProvider());
// GENIE_MODE=agent uses the Agent mode API (Beta): streams the agent's real reasoning. Default is the Conversation API.
const genie = process.env.GENIE_MODE === 'agent' ? new DatabricksGenieAgentClient(tokens) : new DatabricksGenieClient(tokens);
const { supervisor, genieAgents, suggestAgent } = createAgents(genie);

const SUGGEST_WAIT_MS = Number(process.env.SUGGEST_WAIT_MS ?? 8000); // how long, after the answer, to wait for our own follow-ups
const sse = (e: ChatEvent) => `data: ${JSON.stringify(e)}\n\n`;
const stepOf = (toolName: string): 'genie' | null => (toolName.includes('genie') ? 'genie' : null);

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

const chatRoute = registerApiRoute('/bi/chat', {
  method: 'POST',
  handler: async (c) => {
    const who = await authenticate(c);
    if (who instanceof Response) return who;
    const { threadId: rawThread, message } = (await c.req.json()) as ChatRequest;
    if (!rawThread || !message?.trim()) return c.json({ error: 'threadId and message are required' }, 400);
    const threadId = `${who.user}::${rawThread}`; // threads are per user

    // Follow-ups need only the Genie descriptions and the chat so far, so they are written in parallel with the answer, not after it.
    const pendingSuggestions = suggestFollowUps(suggestAgent, { question: message, history: recentTurns(threadId) });

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
        collector.emit = send;
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
          let answer = '';
          for await (const chunk of stream.fullStream as AsyncIterable<any>) {
            const p = chunk.payload ?? chunk;
            if (chunk.type === 'text-delta') {
              const delta: string = p.text ?? p.textDelta ?? '';
              answer += delta;
              send({ type: 'text', delta });
            } else if (chunk.type === 'tool-call' || chunk.type === 'tool-result') {
              const step = stepOf(String(p.toolName ?? ''));
              if (step) send({ type: 'step', step, status: chunk.type === 'tool-call' ? 'start' : 'done' });
            } else if (chunk.type === 'error') {
              throw new Error(String(p.error?.message ?? p.error ?? 'agent error'));
            }
          }
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
              spaceName: getSpaceById(r.spaceId)?.name ?? r.spaceId,
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
            await Promise.race([pendingSuggestions, new Promise((resolve) => (timer = setTimeout(resolve, SUGGEST_WAIT_MS)))]);
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
    const body = (await c.req.json()) as FeedbackRequest;
    if (!getSpaceById(body.spaceId)) return c.json({ error: 'unknown space' }, 400);
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
    handler: async (c) => (oauth ? c.redirect(buildLoginUrl()) : c.redirect('/')),
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
      try {
        const t = await exchangeCode(code, state);
        const id = createSession(t, await fetchUserName(t.accessToken));
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
  const dist = process.env.UI_DIST;
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
    port: Number(process.env.PORT ?? 4111),
    cors: { origin: ['http://localhost:5173'], allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type'] },
    middleware: [{ path: '/*', handler: serveUi }],
    apiRoutes: [chatRoute, feedbackRoute, ...authRoutes],
  },
});

export const spaces = genieSpaces;
