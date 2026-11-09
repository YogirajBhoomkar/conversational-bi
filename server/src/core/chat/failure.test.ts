import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '../../contracts';
import { ChatEventSchema } from '../../contracts';
import { createSpaceRegistry } from '../genie/registry';
import { silentLogger } from '../log';
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
    for (const kind of ['unavailable', 'busy', 'timeout', 'failed', 'refused'] as const) expect(ChatEventSchema.safeParse(failureEvent(kind, 'r', 60_000)).success).toBe(true);
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
