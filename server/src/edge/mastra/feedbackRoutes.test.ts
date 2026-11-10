// The Send feedback email's two routes (GET client-config, POST feedback/opened) and its settings.
import { describe, expect, it } from 'vitest';
import { AgentCardSchema, ClientConfigSchema, CONTRACT_VERSION } from '../../contracts';
import { createSpaceRegistry } from '../../core/genie/registry';
import { FEEDBACK_EXTENSION } from '../../core/agentCard';
import { ConfigError, type FeedbackSettings, loadConfig } from '../../config/load';
import type { ConfigIO } from '../../config/spaces';
import { createAdmission } from '../../core/admission';
import { userTag } from '../../core/log';
import type { BiService } from '../../core/service';
import type { Authenticator } from '../../ports/auth';
import type { BiLogger } from '../../ports/logger';
import { createBiRoutes } from './routes';

type Route = { path: string; method: string; handler: (c: unknown) => Promise<Response> };
type Line = { event: string; fields: Record<string, unknown> };

const USER = 'someone@example.invalid';
const signedIn: Authenticator = { authenticate: async () => ({ ok: true, identity: { userId: USER, userToken: 'identity-token' } }) };
const rejected: Authenticator = { authenticate: async () => ({ ok: false, status: 401, message: 'Please sign in.', relogin: true }) };
const REGISTRY = createSpaceRegistry([
  { key: 'orders', name: 'Fake orders', description: 'Order figures by year and region: value and count. Not for stock.', spaceId: 'secret-space-id-1', examples: ['Which region ordered most?'] },
  { key: 'stock', name: 'Fake stock', description: 'Stock levels by site and week.', spaceId: 'secret-space-id-2' },
]);
const FEEDBACK: FeedbackSettings = { to: ['feedback@example.invalid'], content: 'full', maxUrlChars: 1900 };

function routes(authenticator = signedIn, feedback: typeof FEEDBACK | null = FEEDBACK) {
  const lines: Line[] = [];
  const make = (bound: Record<string, unknown>): BiLogger => {
    const at = (event: string, fields: Record<string, unknown> = {}) => void lines.push({ event, fields: { ...bound, ...fields } });
    return { debug: at, info: at, warn: at, error: at, child: (more) => make({ ...bound, ...more }) };
  };
  const admission = createAdmission({ enabled: true, maxPerUser: 2, maxTotal: 10 });
  const list = createBiRoutes({ registry: REGISTRY } as unknown as BiService, authenticator, admission, make({}), { prefix: '/bi', maxBodyBytes: 65_536, heartbeatMs: 0, build: 'test-build', feedback: feedback ?? undefined }) as unknown as Route[];
  const call = (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) => {
    const route = list.find((r) => r.path === path && r.method === method)!;
    const raw = new Request(`http://localhost${path}`, { method, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
    return route.handler({
      req: { header: (n: string) => headers[n.toLowerCase()], path, raw },
      json: (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }),
    });
  };
  return { call, lines };
}

describe('GET /bi/client-config', () => {
  it('tells the UI where feedback goes, with the caller as the logged user hash and never the user id', async () => {
    const res = await routes().call('/bi/client-config', 'GET');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(ClientConfigSchema.parse(body)).toEqual({ feedback: FEEDBACK, userRef: userTag(USER), build: 'test-build', contract: CONTRACT_VERSION });
    expect(JSON.stringify(body)).not.toContain(USER);
    expect(JSON.stringify(body)).not.toContain('identity-token');
  });

  it('gives `to: null` when no address is set, which hides the button', async () => {
    const body = await (await routes(signedIn, null).call('/bi/client-config', 'GET')).json();
    expect(body.feedback.to).toBeNull();
  });

  it('needs a signed-in caller, as every other route', async () => {
    expect((await routes(rejected).call('/bi/client-config', 'GET')).status).toBe(401);
  });
});

describe('POST /bi/feedback/opened', () => {
  const beacon = { traceId: 'trace-of-the-turn', turn: 3, reason: 'wrong_numbers' };

  it('logs feedback.opened on the trace of the turn, with only the listed fields, and answers 204', async () => {
    const { call, lines } = routes();
    const res = await call('/bi/feedback/opened', 'POST', beacon);
    expect(res.status).toBe(204);
    const line = lines.find((l) => l.event === 'feedback.opened')!;
    expect(line.fields).toEqual({ traceId: 'trace-of-the-turn', user: userTag(USER), turn: 3, reason: 'wrong_numbers' });
  });

  it('accepts no reason (none chosen)', async () => {
    expect((await routes().call('/bi/feedback/opened', 'POST', { ...beacon, reason: null })).status).toBe(204);
  });

  it('refuses extra fields (a comment, question or anything else must never come here) and a bad reason', async () => {
    const { call, lines } = routes();
    for (const bad of [{ ...beacon, comment: 'the numbers are off' }, { ...beacon, question: 'q' }, { ...beacon, reason: 'spam' }, { ...beacon, format: 'text' }, { ...beacon, turn: 0 }]) {
      expect((await call('/bi/feedback/opened', 'POST', bad)).status).toBe(400);
    }
    expect(lines.some((l) => l.event === 'feedback.opened')).toBe(false);
  });

  it('refuses a large body before reading it', async () => {
    const { call } = routes();
    expect((await call('/bi/feedback/opened', 'POST', { ...beacon, traceId: 'x'.repeat(2000) }, { 'content-length': '2100' })).status).toBe(413);
    expect((await call('/bi/feedback/opened', 'POST', JSON.stringify({ ...beacon, traceId: 'x'.repeat(2000) }))).status).toBe(413);
  });

  it('needs a signed-in caller', async () => {
    expect((await routes(rejected).call('/bi/feedback/opened', 'POST', beacon)).status).toBe(401);
  });
});

describe('GET /bi/.well-known/agent-card.json', () => {
  const card = async (feedback: typeof FEEDBACK | null = FEEDBACK) => {
    const res = await routes(signedIn, feedback).call('/bi/.well-known/agent-card.json', 'GET');
    expect(res.status).toBe(200);
    return AgentCardSchema.parse(await res.json());
  };
  const feedbackOf = (c: Awaited<ReturnType<typeof card>>) => c.capabilities.extensions.find((e) => e.uri === FEEDBACK_EXTENSION)!;

  it('lists the data areas as skills, with their first sentence and example questions', async () => {
    const c = await card();
    expect(c.skills).toEqual([
      { id: 'orders', name: 'Fake orders', description: 'Order figures by year and region: value and count.', tags: ['data'], examples: ['Which region ordered most?'] },
      { id: 'stock', name: 'Fake stock', description: 'Stock levels by site and week.', tags: ['data'], examples: [] },
    ]);
    expect(c).toMatchObject({ url: '/bi/chat', version: 'test-build', contract: CONTRACT_VERSION, capabilities: { streaming: true } });
  });

  it('reflects the feedback email configuration', async () => {
    expect(feedbackOf(await card()).params).toEqual({ enabled: true, to: ['feedback@example.invalid'], channel: 'mailto', content: 'full', maxUrlChars: 1900 });
    expect(feedbackOf(await card({ ...FEEDBACK, content: 'ids', maxUrlChars: 2500 })).params).toEqual({ enabled: true, to: ['feedback@example.invalid'], channel: 'mailto', content: 'ids', maxUrlChars: 2500 });
    const off = feedbackOf(await card(null));
    expect(off.params).toMatchObject({ enabled: false, to: [] });
    expect(off.description).toMatch(/switched off/);
  });

  it('never holds the system prompt, agent or tool names, or space ids', async () => {
    const text = JSON.stringify(await card());
    for (const s of ['secret-space-id', 'genie_', 'ask-', 'bi_supervisor', 'ask_user_to_choose', 'You are a business-intelligence assistant']) expect(text).not.toContain(s);
  });

  it('needs a signed-in caller', async () => {
    expect((await routes(rejected).call('/bi/.well-known/agent-card.json', 'GET')).status).toBe(401);
  });
});

describe('feedback settings', () => {
  const io: ConfigIO = { resolve: (p) => p, readFile: () => { throw new Error('no files'); } };
  const BASE = { BI_MODE: 'gc', DATABRICKS_SERVER_HOSTNAME: 'ws.example', ANTHROPIC_API_KEY: 'k', BI_SPACES_JSON: JSON.stringify([{ key: 'one', name: 'One', description: 'Covers the first data in enough words to route by.', spaceId: 'id-1' }]) };
  const load = (env: Record<string, string>) => loadConfig({ ...BASE, ...env }, io).config.feedback;
  const problems = (env: Record<string, string>) => {
    try {
      loadConfig({ ...BASE, ...env }, io);
      return [];
    } catch (e) {
      return e instanceof ConfigError ? e.problems : [String(e)];
    }
  };

  it('defaults: no address (button hidden), full content, a 1900-character link', () => {
    expect(load({})).toEqual({ to: null, content: 'full', maxUrlChars: 1900 });
  });

  it('takes up to 5 comma-separated addresses', () => {
    expect(load({ BI_FEEDBACK_EMAIL: ' a@example.invalid, b@example.invalid ' }).to).toEqual(['a@example.invalid', 'b@example.invalid']);
  });

  it('refuses a bad address, more than 5, a link budget out of bounds, and an unknown content', () => {
    expect(problems({ BI_FEEDBACK_EMAIL: 'not-an-address' }).join()).toMatch(/BI_FEEDBACK_EMAIL.*not a valid email address/);
    expect(problems({ BI_FEEDBACK_EMAIL: Array.from({ length: 6 }, (_, i) => `u${i}@example.invalid`).join(',') }).join()).toMatch(/at most 5/);
    expect(problems({ BI_FEEDBACK_MAX_URL_CHARS: '500' }).join()).toMatch(/BI_FEEDBACK_MAX_URL_CHARS/);
    expect(problems({ BI_FEEDBACK_MAX_URL_CHARS: '9000' }).join()).toMatch(/BI_FEEDBACK_MAX_URL_CHARS/);
    expect(problems({ BI_FEEDBACK_CONTENT: 'everything' }).join()).toMatch(/BI_FEEDBACK_CONTENT/);
  });
});
