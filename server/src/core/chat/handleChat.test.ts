import { describe, expect, it, vi } from 'vitest';
import type { ChatEvent, GenieClient } from '../../contracts';
import type { BiRequestContext } from '../../ports/context';
import { UpstreamError, ValidationError } from '../errors';
import { createSpaceRegistry } from '../genie/registry';
import { silentLogger } from '../log';
import type { Collector } from './collector';
import { type ChatDeps, handleChat, handleFeedback } from './handleChat';

const registry = createSpaceRegistry([{ key: 'one', name: 'One', description: 'The first fake space.', spaceId: 'id-1' }]);
const ctx = (signal = new AbortController().signal): BiRequestContext => ({ userId: 'u1', userToken: 'identity-token', traceId: 't', signal });

type Seen = { requestContext: { get(k: string): unknown }; abortSignal: AbortSignal };

function deps(chunks: Array<{ type: string; payload?: object }>, seen: Seen[] = []): ChatDeps {
  return {
    supervisor: {
      stream: (async (_m: unknown, opts: Seen) => {
        seen.push(opts);
        return { fullStream: (async function* () { yield* chunks; })() };
      }) as unknown as ChatDeps['supervisor']['stream'],
    },
    suggestAgent: { generate: (async () => ({ object: { questions: [] } })) as unknown as ChatDeps['suggestAgent']['generate'] },
    registry,
    modelLabel: 'm',
    suggestWaitMs: 0,
    genieMode: 'conversation',
    logger: silentLogger,
    turnTimeoutMs: 60_000,
    history: { turns: 3, maxChars: 1500, includeSql: false },
  };
}

const collect = async (gen: AsyncIterable<ChatEvent>) => {
  const out: ChatEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
};

describe('handleChat', () => {
  it('gives tools the caller (as a function, so it is never serialised) and the abort signal', async () => {
    const seen: Seen[] = [];
    const abort = new AbortController();
    await collect(handleChat(deps([], seen), ctx(abort.signal), { threadId: 'a', message: 'q' }));
    const rc = seen[0].requestContext;
    expect(typeof rc.get('caller')).toBe('function');
    expect((rc.get('caller') as () => unknown)()).toEqual({ userId: 'u1', userToken: 'identity-token', sessionId: undefined });
    // The turn's signal follows the caller's (and also fires on the turn timeout).
    const signal = rc.get('signal') as AbortSignal;
    expect(seen[0].abortSignal).toBe(signal);
    expect(signal.aborted).toBe(false);
    abort.abort();
    expect(signal.aborted).toBe(true);
    expect(rc.get('threadId')).toBe('u1::a');
  });

  it('puts a question back to the user, with its options, in the final answer', async () => {
    const asking = deps([]);
    asking.supervisor = { stream: (async (_m: unknown, opts: Seen) => {
      (opts.requestContext.get('collector') as Collector).clarification = { question: 'Which year?', options: ['Underwriting year', 'Calendar year'] };
      return { fullStream: (async function* () {})() };
    }) as unknown as ChatDeps['supervisor']['stream'] };
    const events = await collect(handleChat(asking, ctx(), { threadId: 'a', message: 'Limit by year?' }));
    const final = events.find((e) => e.type === 'final');
    expect(final).toMatchObject({ result: { clarification: { question: 'Which year?', options: ['Underwriting year', 'Calendar year'] } } });
  });

  it('shows a question the model wrote as text as choices, when no data was fetched', async () => {
    const events = await collect(handleChat(deps([
      { type: 'text-delta', payload: { text: 'Which year do you mean?\n- Underwriting year\n- Calendar year' } },
      { type: 'step-finish', payload: { stepResult: { reason: 'stop' } } },
    ]), ctx(), { threadId: 'a', message: 'Limit by year?' }));
    expect(events.map((e) => e.type)).toContain('text-reset');
    expect(events.find((e) => e.type === 'final')).toMatchObject({ result: { answer: '', clarification: { question: 'Which year do you mean?', options: ['Underwriting year', 'Calendar year'] } } });
  });

  it('leaves a reply to a greeting as text, even when it lists topics', async () => {
    const events = await collect(handleChat(deps([
      { type: 'text-delta', payload: { text: 'Tell me what you would like to look at:\n- Placements\n- Capacity' } },
      { type: 'step-finish', payload: { stepResult: { reason: 'stop' } } },
    ]), ctx(), { threadId: 'a', message: 'hii' }));
    const final = events.find((e) => e.type === 'final');
    expect(final).toMatchObject({ result: { answer: expect.stringContaining('Placements') } });
    expect(final).not.toMatchObject({ result: { clarification: expect.anything() } });
  });

  it('stops a turn that runs past the timeout and tells the user in plain words', async () => {
    const hang = deps([]);
    hang.turnTimeoutMs = 30;
    hang.supervisor = { stream: (async (_m: unknown, opts: Seen) => ({ fullStream: (async function* () { await new Promise((_, reject) => opts.abortSignal.addEventListener('abort', () => reject(new Error('aborted')))); })() })) as unknown as ChatDeps['supervisor']['stream'] };
    const events = await collect(handleChat(hang, ctx(), { threadId: 'a', message: 'q' }));
    expect(events.at(-1)).toMatchObject({ type: 'error', kind: 'timeout', message: expect.stringContaining('took longer than') });
  });

  it('ends with `final` for a turn that answers', async () => {
    const events = await collect(handleChat(deps([
      { type: 'text-delta', payload: { text: 'Hello' } },
      { type: 'step-finish', payload: { stepResult: { reason: 'stop' } } },
    ]), ctx(), { threadId: 'a', message: 'q' }));
    // model, the text streaming as a possible plan, that note cleared once the step ends without a tool call, the answer, final
    expect(events.map((e) => e.type)).toEqual(['trace', 'trace', 'trace', 'text', 'final']);
  });
});

const dataResult = (suggestedQuestions: string[]) => ({ spaceId: 'id-1', question: 'q', summary: '', sql: null, columns: ['n'], rows: [[1]], totalRows: 1, thinking: [], suggestedQuestions, statementId: null, conversationId: 'c', messageId: 'm', error: null });

// A turn whose data agent returned a Genie result with the given follow-ups.
function withGenie(suggestedQuestions: string[], mode: ChatDeps['genieMode'], generate: ReturnType<typeof vi.fn>): ChatDeps {
  const d = deps([]);
  d.genieMode = mode;
  d.suggestWaitMs = 500;
  d.suggestAgent = { generate } as unknown as ChatDeps['suggestAgent'];
  d.supervisor = { stream: (async (_m: unknown, opts: Seen) => {
    (opts.requestContext.get('collector') as Collector).results.push(dataResult(suggestedQuestions));
    return { fullStream: (async function* () { yield { type: 'text-delta', payload: { text: 'One.' } }; yield { type: 'step-finish', payload: { stepResult: { reason: 'stop' } } }; })() };
  }) as unknown as ChatDeps['supervisor']['stream'] };
  return d;
}
const ours = () => vi.fn(async () => ({ object: { questions: [{ question: 'Ours?', space: 'one' }] } }));

describe('follow-up questions', () => {
  it("conversation mode: Genie's own win, and ours are never written", async () => {
    const generate = ours();
    const events = await collect(handleChat(withGenie(['Genie?'], 'conversation', generate), ctx(), { threadId: 'a', message: 'q' }));
    expect(generate).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ type: 'final', result: { suggestedQuestions: ['Genie?'] } });
  });

  it('conversation mode: without Genie follow-ups, ours are written after `final` and still arrive', async () => {
    const generate = ours();
    const events = await collect(handleChat(withGenie([], 'conversation', generate), ctx(), { threadId: 'a', message: 'q' }));
    expect(generate).toHaveBeenCalledOnce();
    expect(events.map((e) => e.type).slice(-2)).toEqual(['final', 'suggestions']);
  });

  // Changed (scope guard): agent mode used to start ours before the supervisor ran; now they start once data has come
  // back, still in parallel with the answer, so a turn without data never writes them.
  it('agent mode: ours start as soon as data comes back, in parallel with the answer', async () => {
    const generate = ours();
    const d = withGenie([], 'agent', generate);
    let startedBeforeAnswerEnded = false;
    d.supervisor = { stream: (async (_m: unknown, opts: Seen) => {
      (opts.requestContext.get('collector') as Collector).results.push(dataResult([]));
      return { fullStream: (async function* () {
        yield { type: 'tool-result', payload: {} };
        yield { type: 'text-delta', payload: { text: 'One.' } };
        startedBeforeAnswerEnded = generate.mock.calls.length === 1;
        yield { type: 'step-finish', payload: { stepResult: { reason: 'stop' } } };
      })() };
    }) as unknown as ChatDeps['supervisor']['stream'] };
    const events = await collect(handleChat(d, ctx(), { threadId: 'a', message: 'q' }));
    expect(startedBeforeAnswerEnded).toBe(true);
    expect(events.some((e) => e.type === 'suggestions')).toBe(true);
  });

  it('conversation mode: none are written for a failed or timed-out turn, which still ends cleanly', async () => {
    const generate = ours();
    const failing = withGenie([], 'conversation', generate);
    failing.supervisor = { stream: (async () => ({ fullStream: (async function* () { yield { type: 'error', payload: { error: { message: 'down' } } }; })() })) as unknown as ChatDeps['supervisor']['stream'] };
    expect((await collect(handleChat(failing, ctx(), { threadId: 'a', message: 'q' }))).at(-1)).toMatchObject({ type: 'error' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('a slow writer of ours never holds the stream past the wait', async () => {
    const generate = vi.fn(() => new Promise(() => undefined));
    const d = withGenie([], 'conversation', generate);
    d.suggestWaitMs = 30;
    const events = await collect(handleChat(d, ctx(), { threadId: 'a', message: 'q' }));
    expect(events.at(-1)?.type).toBe('final');
  });
});

describe('handleFeedback', () => {
  it('rejects an unknown space and reports Genie failures as upstream errors', async () => {
    const genie = { feedback: vi.fn().mockRejectedValue(new Error('down')) } as unknown as GenieClient;
    await expect(handleFeedback({ genie, registry, logger: silentLogger }, ctx(), { spaceId: 'nope', conversationId: 'c', messageId: 'm', rating: 'POSITIVE' })).rejects.toBeInstanceOf(ValidationError);
    await expect(handleFeedback({ genie, registry, logger: silentLogger }, ctx(), { spaceId: 'id-1', conversationId: 'c', messageId: 'm', rating: 'POSITIVE' })).rejects.toBeInstanceOf(UpstreamError);
    expect(genie.feedback).toHaveBeenCalledWith(expect.objectContaining({ caller: { userId: 'u1', userToken: 'identity-token', sessionId: undefined } }));
  });
});

describe('the turn log', () => {
  it('chat.turn carries the trace id, the user hash and the chat id the UI sent (not the per-user key), and no question text', async () => {
    const lines: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const make = (bound: Record<string, unknown>): ChatDeps['logger'] => {
      const at = (event: string, fields: Record<string, unknown> = {}) => void lines.push({ event, fields: { ...bound, ...fields } });
      return { debug: at, info: at, warn: at, error: at, child: (more) => make({ ...bound, ...more }) };
    };
    const d = { ...deps([{ type: 'text-delta', payload: { text: 'Hello' } }]), logger: make({}) };
    await collect(handleChat(d, ctx(), { threadId: 'chat-123', message: 'a secret question' }));
    const turn = lines.find((l) => l.event === 'chat.turn')!.fields;
    expect(turn).toMatchObject({ traceId: 't', chatId: 'chat-123', user: expect.stringMatching(/^[0-9a-f]{12}$/) });
    expect(JSON.stringify(turn)).not.toContain('u1::');
    expect(JSON.stringify(lines)).not.toContain('a secret question');
  });
});
