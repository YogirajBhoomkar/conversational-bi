// Characterization tests: they pin what POST /bi/chat and POST /bi/feedback do today, so the restructuring can prove it
// changed nothing. Everything outside our code is faked: no network, no model, no Genie, and server/.env is never read.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent, GenieResult } from '../../contracts';
import type { Collector } from '../../core/chat/collector';

type Chunk = { type: string; payload?: Record<string, unknown> };
type StreamOptions = { requestContext: { get(key: string): unknown }; memory: { thread: string; resource: string }; abortSignal: AbortSignal };

const scenario = vi.hoisted(() => ({
  chunks: (_opts: StreamOptions): AsyncIterable<Chunk> => (async function* () {})(),
  suggest: async (): Promise<{ object: { questions: Array<{ question: string; space: string }> } }> => ({ object: { questions: [] } }),
  calls: [] as StreamOptions[],
}));

vi.mock('dotenv/config', () => ({}));
vi.mock('@mastra/libsql', () => ({ LibSQLStore: class {} }));
vi.mock('@mastra/memory', () => ({ Memory: class {} }));
vi.mock('@mastra/core', () => ({
  Mastra: class {
    constructor(readonly config: { server: unknown }) {}
    getServer() {
      return this.config.server;
    }
  },
}));
vi.mock('../../core/agents/createAgents', () => ({
  createAgents: () => ({
    supervisor: {
      stream: async (_message: string, opts: StreamOptions) => {
        scenario.calls.push(opts);
        return { fullStream: scenario.chunks(opts) };
      },
    },
    genieAgents: {},
    suggestAgent: { generate: () => scenario.suggest() },
  }),
}));

type Route = { path: string; method: string; handler: (c: unknown) => Promise<Response> };

const ENV = {
  DATABRICKS_SERVER_HOSTNAME: 'workspace.example',
  DATABRICKS_TOKEN: 'test-pat',
  ANTHROPIC_API_KEY: 'test-key',
  ANTHROPIC_MODEL: 'test-model',
  BI_SPACE_ID_PLACEMENT: 'space-a',
  BI_SPACE_ID_CAPACITY: 'space-b',
  SUGGEST_WAIT_MS: '200',
};

async function loadRoutes(env: Record<string, string> = {}): Promise<Route[]> {
  vi.resetModules();
  for (const [k, v] of Object.entries({ ...ENV, ...env })) vi.stubEnv(k, v);
  vi.stubEnv('DATABRICKS_CLIENT_ID', ''); // shared-token mode: every caller is the dev user
  const { mastra } = await import('../../mastra');
  return (mastra.getServer() as unknown as { apiRoutes: Route[] }).apiRoutes;
}

const NOT_JSON = Symbol('not json');
function context(body: unknown) {
  return {
    req: {
      header: () => undefined,
      json: async () => {
        if (body === NOT_JSON) throw new SyntaxError('Unexpected token');
        return body;
      },
      raw: { signal: new AbortController().signal },
    },
    json: (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }),
  };
}

async function call(routes: Route[], path: string, body: unknown) {
  const route = routes.find((r) => r.path === path);
  if (!route) throw new Error(`no route ${path}`);
  return route.handler(context(body));
}

async function events(res: Response): Promise<ChatEvent[]> {
  const text = await res.text();
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((block) => JSON.parse(block.replace(/^data: /, '')) as ChatEvent);
}

const result = (over: Partial<GenieResult> = {}): GenieResult => ({
  spaceId: 'space-a', question: 'How many placements?', summary: '42', sql: 'SELECT count(*) FROM p', columns: ['n'], rows: [[42]], totalRows: 1,
  thinking: [], suggestedQuestions: [], statementId: null, conversationId: 'conv-1', messageId: 'msg-1', error: null, ...over,
});

// One supervisor turn: a working note, a handover to the first data agent (which records a Genie result and a progress line), then the answer.
function turn(record: Partial<GenieResult> = {}) {
  return async function* (opts: StreamOptions): AsyncIterable<Chunk> {
    yield { type: 'text-delta', payload: { text: 'I will ask the first data agent.' } };
    yield { type: 'tool-call', payload: { toolCallId: 'call-1', toolName: 'agent-genie_placement', args: { prompt: 'How many placements?' } } };
    const collector = opts.requestContext.get('collector') as Collector;
    collector.emit?.({ kind: 'status', text: 'Running the query…' }, 'placement');
    collector.results.push(result(record));
    yield { type: 'tool-result', payload: { toolCallId: 'call-1', toolName: 'agent-genie_placement', result: {} } };
    yield { type: 'step-finish', payload: { stepResult: { reason: 'tool-calls' } } };
    yield { type: 'text-delta', payload: { text: 'There are 42 ' } };
    yield { type: 'text-delta', payload: { text: 'placements.' } };
    yield { type: 'step-finish', payload: { stepResult: { reason: 'stop' } } };
  };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  scenario.calls = [];
  scenario.chunks = turn();
  scenario.suggest = async () => ({ object: { questions: [] } });
});
afterEach(() => vi.unstubAllEnvs());
vi.setConfig({ testTimeout: 30_000 }); // each test re-imports the whole server module graph

describe('POST /bi/chat (characterization)', () => {
  it('streams model meta, working notes, tool entries, Genie progress, the answer, final and our follow-ups, in that order', async () => {
    scenario.suggest = async () => {
      await delay(30);
      return { object: { questions: [{ question: 'How has that changed by year?', space: 'placement' }] } };
    };
    const routes = await loadRoutes();
    const res = await call(routes, '/bi/chat', { threadId: 't1', message: 'How many placements?' });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(await events(res)).toEqual([
      { type: 'trace', item: { id: 'model', kind: 'meta', label: 'Using model', text: 'test-model' } },
      { type: 'trace', item: { id: 'note1', kind: 'note', text: 'I will ask the first data agent.' } },
      { type: 'trace', item: { id: 'call-1', kind: 'tool', label: 'Lab – Placement Core', status: 'running', text: 'How many placements?' } },
      { type: 'trace', item: { id: 'progress2', kind: 'progress', step: 'status', parent: 'call-1', text: 'Running the query…' } },
      { type: 'trace', item: { id: 'call-1', kind: 'tool', label: 'Lab – Placement Core', status: 'done' } },
      { type: 'text', delta: 'There are 42 ' }, // the answer streams as the model writes it
      { type: 'text', delta: 'placements.' },
      {
        type: 'final',
        result: {
          answer: 'There are 42 placements.',
          columns: ['n'],
          rows: [[42]],
          totalRows: 1,
          charts: [],
          chartSpec: null,
          sources: [{ spaceId: 'space-a', spaceName: 'Lab – Placement Core', question: 'How many placements?', sql: 'SELECT count(*) FROM p', messageId: 'msg-1', conversationId: 'conv-1' }],
          suggestedQuestions: [],
          traceId: expect.any(String),
        },
      },
      { type: 'suggestions', questions: ['How has that changed by year?'] },
    ]);
  });

  it('sends our follow-ups before `final` when they are ready first', async () => {
    scenario.suggest = async () => ({ object: { questions: [{ question: 'Which region grew most?', space: 'placement' }] } });
    const slow = turn();
    scenario.chunks = async function* (opts) {
      await delay(30);
      yield* slow(opts);
    };
    const types = (await events(await call(await loadRoutes(), '/bi/chat', { threadId: 't1', message: 'q' }))).map((e) => e.type);
    expect(types.indexOf('suggestions')).toBeGreaterThan(-1);
    expect(types.indexOf('suggestions')).toBeLessThan(types.indexOf('final'));
  });

  it('closes the stream after SUGGEST_WAIT_MS when our follow-ups are slow, without them', async () => {
    scenario.suggest = () => new Promise(() => undefined); // never answers
    const started = Date.now();
    const evs = await events(await call(await loadRoutes({ SUGGEST_WAIT_MS: '50' }), '/bi/chat', { threadId: 't1', message: 'q' }));
    expect(Date.now() - started).toBeLessThan(2000);
    expect(evs.at(-1)?.type).toBe('final');
    expect(evs.some((e) => e.type === 'suggestions')).toBe(false);
  });

  it("does not wait for our follow-ups when Genie sent its own", async () => {
    scenario.suggest = () => new Promise(() => undefined);
    scenario.chunks = turn({ suggestedQuestions: ['Genie follow-up?'] });
    const started = Date.now();
    const evs = await events(await call(await loadRoutes({ SUGGEST_WAIT_MS: '5000' }), '/bi/chat', { threadId: 't1', message: 'q' }));
    expect(Date.now() - started).toBeLessThan(2000);
    expect(evs.at(-1)).toMatchObject({ type: 'final', result: { suggestedQuestions: ['Genie follow-up?'] } });
  });

  it('ends a failed turn with an `error` event and no `final`', async () => {
    scenario.chunks = async function* () {
      yield { type: 'text-delta', payload: { text: 'Let me check.' } };
      yield { type: 'error', payload: { error: { message: 'model unavailable' } } };
    };
    const evs = await events(await call(await loadRoutes(), '/bi/chat', { threadId: 't1', message: 'q' }));
    expect(evs[0]).toMatchObject({ type: 'trace', item: { id: 'model' } });
    expect(evs.at(-1)).toEqual({ type: 'error', message: 'model unavailable' });
    expect(evs.some((e) => e.type === 'final')).toBe(false);
  });

  it('keeps threads per user: the memory thread is <user>::<threadId>', async () => {
    await events(await call(await loadRoutes(), '/bi/chat', { threadId: 'abc', message: 'q' }));
    expect(scenario.calls[0].memory).toEqual({ thread: 'dev::abc', resource: 'dev' });
    expect(scenario.calls[0].requestContext.get('threadId')).toBe('dev::abc');
  });

  it('rejects a bad body with 400 and names the field', async () => {
    const routes = await loadRoutes();
    const missing = await call(routes, '/bi/chat', { threadId: 't1' });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ error: 'Invalid request', issues: [expect.stringMatching(/^message: /)] });

    const notJson = await call(routes, '/bi/chat', NOT_JSON);
    expect(notJson.status).toBe(400);
    expect((await notJson.json()).issues[0]).toMatch(/^body: /);
  });
});

describe('POST /bi/feedback (characterization)', () => {
  it('rejects a bad body with 400 and names the field', async () => {
    const res = await call(await loadRoutes(), '/bi/feedback', { spaceId: 'space-a', conversationId: 'c', messageId: 'm', rating: 'GREAT' });
    expect(res.status).toBe(400);
    expect((await res.json()).issues[0]).toMatch(/^rating: /);
  });

  it('rejects an unknown space with 400', async () => {
    const res = await call(await loadRoutes(), '/bi/feedback', { spaceId: 'nope', conversationId: 'c', messageId: 'm', rating: 'POSITIVE' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unknown space' });
  });
});
