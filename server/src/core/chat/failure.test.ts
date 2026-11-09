import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '../../contracts';
import { ChatEventSchema } from '../../contracts';
import { createSpaceRegistry } from '../genie/registry';
import { silentLogger } from '../log';
import { failedResult } from '../genie/client';
import { GENIE_LIMIT_MESSAGE, GENIE_UNREACHABLE_MESSAGE, GenieRunFailed } from '../genie/retry';
import type { Collector } from './collector';
import { failureEvent, failureKind } from './failure';
import { handleChat, type ChatDeps } from './handleChat';

// The shapes the AI SDK raises (made-up ids, no host): a connection that never opened, and HTTP errors.
const connectTimeout = () => Object.assign(new Error('Cannot connect to API: Connect Timeout Error (timeout: 10000ms)'), { cause: Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' }) });
const http = (statusCode: number) => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode });

describe('the kind of failure', () => {
  it('the model service unreachable or down', () => {
    expect(failureKind(connectTimeout(), false)).toBe('unavailable');
    expect(failureKind(new Error('wrapped', { cause: connectTimeout() }), false)).toBe('unavailable'); // as handleChat wraps it
    expect(failureKind(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }), false)).toBe('unavailable');
    for (const s of [502, 503, 504, 529]) expect(failureKind(http(s), false)).toBe('unavailable');
  });

  it('rate limited, timed out, or anything else', () => {
    expect(failureKind(http(429), false)).toBe('busy');
    expect(failureKind(connectTimeout(), true)).toBe('timeout'); // the turn's own timeout wins
    expect(failureKind(new Error('model unavailable'), false)).toBe('failed');
    expect(failureKind(http(400), false)).toBe('failed');
    expect(failureKind(undefined, false)).toBe('failed');
  });

  it('gives each kind a title, a calm detail and the reference; `message` stays as before', () => {
    expect(failureEvent('failed', 'ref-1', 300_000)).toEqual({
      type: 'error', kind: 'failed', title: 'Something went wrong', detail: 'Something went wrong while answering.', retryable: true, reference: 'ref-1',
      message: 'Something went wrong while answering. If it happens again, quote reference ref-1.',
    });
    expect(failureEvent('unavailable', 'ref-1', 300_000)).toMatchObject({ title: "Couldn't reach the AI service", retryable: true, message: expect.stringContaining('quote reference ref-1') });
    expect(failureEvent('timeout', 'ref-1', 300_000)).toMatchObject({ message: 'This question took longer than 5 minutes and was stopped. Try asking for less at once.', reference: 'ref-1' });
    for (const kind of ['unavailable', 'busy', 'timeout', 'failed', 'refused', 'limit', 'source'] as const) expect(ChatEventSchema.safeParse(failureEvent(kind, 'r', 60_000)).success).toBe(true);
  });
});

describe('a used-up Databricks limit', () => {
  const BUDGET = "You've reached your budget. Contact your admin to request a budget increase.";

  it('is never retried, and is told in our words', () => {
    expect(new GenieRunFailed(BUDGET).retryable).toBe(false);
    expect(new GenieRunFailed('Quota exceeded for this workspace').retryable).toBe(false);
    expect(new GenieRunFailed('Genie message FAILED').retryable).toBe(true); // other run failures still are
    const result = failedResult({ spaceId: 's', question: 'q', caller: { userId: 'u' } }, { conversationId: 'c', messageId: 'm' }, new GenieRunFailed(BUDGET));
    expect(result.error).toBe(GENIE_LIMIT_MESSAGE);
  });

  it('a network failure is told plainly too, not as "fetch failed"', () => {
    const run = { conversationId: 'c', messageId: 'm' };
    const args = { spaceId: 's', question: 'q', caller: { userId: 'u' } };
    expect(failedResult(args, run, new TypeError('fetch failed')).error).toBe(GENIE_UNREACHABLE_MESSAGE);
    expect(failedResult(args, run, new Error('request failed', { cause: new Error('getaddrinfo ENOTFOUND example.invalid') })).error).toBe(GENIE_UNREACHABLE_MESSAGE);
    expect(failedResult(args, run, new Error('Genie message FAILED')).error).toBe('Genie message FAILED');
  });

  it.each([
    ['a used-up limit', GENIE_LIMIT_MESSAGE, { kind: 'limit', retryable: false, title: 'Data is unavailable right now' }, 'chat.limit'],
    ['no network', GENIE_UNREACHABLE_MESSAGE, { kind: 'source', retryable: true, title: "Couldn't get the data" }, 'chat.no_data'],
  ])('every Genie call failed (%s): the turn ends with the notice, and no answer is shown', async (_name, error, notice, event) => {
    const lines: string[] = [];
    const logger = { debug() {}, info: (e: string) => void lines.push(e), warn: (e: string) => void lines.push(e), error: (e: string) => void lines.push(e), child: () => logger };
    const deps: ChatDeps = {
      supervisor: { stream: (async (_m: unknown, opts: { requestContext: { get(k: string): unknown } }) => {
        (opts.requestContext.get('collector') as Collector).results.push(...['s1', 's2'].map((spaceId) => ({ spaceId, question: 'q', summary: '', sql: null, columns: [], rows: [], totalRows: 0, thinking: [], suggestedQuestions: [], statementId: null, conversationId: 'c', messageId: 'm', error })));
        return { fullStream: (async function* () { yield { type: 'text-delta', payload: { text: 'The data service is over budget.' } }; yield { type: 'step-finish', payload: { stepResult: { reason: 'stop' } } }; })() };
      }) as unknown as ChatDeps['supervisor']['stream'] },
      suggestAgent: { generate: (async () => ({ object: { questions: [] } })) as unknown as ChatDeps['suggestAgent']['generate'] },
      registry: createSpaceRegistry([{ key: 'one', name: 'One', description: 'The first fake space.', spaceId: 's1' }]),
      modelLabel: 'stub', suggestWaitMs: 0, genieMode: 'conversation', logger, turnTimeoutMs: 30_000, history: { turns: 3, maxChars: 1500, includeSql: false },
    };
    const events: ChatEvent[] = [];
    for await (const e of handleChat(deps, { userId: 'u', userToken: 't', traceId: 'tr', signal: new AbortController().signal }, { threadId: 'a', message: 'placements by year' })) events.push(e);
    expect(events.slice(-2)).toEqual([{ type: 'text-reset' }, expect.objectContaining({ type: 'error', ...notice })]);
    expect(events.some((e) => e.type === 'final')).toBe(false);
    expect(JSON.stringify(events)).not.toContain('budget increase');
    expect(lines).toContain(event);
  });
});

describe('a failed turn', () => {
  it('tells the user the AI service is unreachable, with the parts for a friendly notice', async () => {
    const deps: ChatDeps = {
      supervisor: { stream: (async () => ({ fullStream: (async function* () { yield { type: 'error', payload: { error: connectTimeout() } }; })() })) as unknown as ChatDeps['supervisor']['stream'] },
      suggestAgent: { generate: (async () => ({ object: { questions: [] } })) as unknown as ChatDeps['suggestAgent']['generate'] },
      registry: createSpaceRegistry([{ key: 'one', name: 'One', description: 'The first fake space.', spaceId: 'id-1' }]),
      modelLabel: 'stub', suggestWaitMs: 0, genieMode: 'conversation', logger: silentLogger, turnTimeoutMs: 30_000, history: { turns: 3, maxChars: 1500, includeSql: false },
    };
    const events: ChatEvent[] = [];
    for await (const e of handleChat(deps, { userId: 'u', userToken: 't', traceId: 'tr', signal: new AbortController().signal }, { threadId: 'a', message: 'q' })) events.push(e);
    expect(events.at(-1)).toMatchObject({ type: 'error', kind: 'unavailable', retryable: true, reference: 'tr', title: "Couldn't reach the AI service" });
    expect(JSON.stringify(events)).not.toContain('Connect Timeout'); // the technical text stays in the log
  });
});
