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

type Seen = { requestContext: { get(k: string): unknown }; abortSignal: AbortSignal; memory: unknown };

function deps(chunks: Array<{ type: string; payload?: object }>, seen: Seen[] = []): ChatDeps {
  return {
    supervisor: {
      stream: (async (_m: string, opts: Seen) => {
        seen.push(opts);
        return { fullStream: (async function* () { yield* chunks; })() };
      }) as unknown as ChatDeps['supervisor']['stream'],
    },
    suggestAgent: { generate: (async () => ({ object: { questions: [] } })) as unknown as ChatDeps['suggestAgent']['generate'] },
    registry,
    modelLabel: 'm',
    suggestWaitMs: 0,
    logger: silentLogger,
    turnTimeoutMs: 60_000,
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
    expect(seen[0].memory).toEqual({ thread: 'u1::a', resource: 'u1' });
  });

  it('puts a question back to the user, with its options, in the final answer', async () => {
    const asking = deps([]);
    asking.supervisor = { stream: (async (_m: string, opts: Seen) => {
      (opts.requestContext.get('collector') as Collector).clarification = { question: 'Which year?', options: ['Underwriting year', 'Calendar year'] };
      return { fullStream: (async function* () {})() };
    }) as unknown as ChatDeps['supervisor']['stream'] };
    const events = await collect(handleChat(asking, ctx(), { threadId: 'a', message: 'Limit by year?' }));
    const final = events.find((e) => e.type === 'final');
    expect(final).toMatchObject({ result: { clarification: { question: 'Which year?', options: ['Underwriting year', 'Calendar year'] } } });
  });

  it('stops a turn that runs past the timeout and tells the user in plain words', async () => {
    const hang = deps([]);
    hang.turnTimeoutMs = 30;
    hang.supervisor = { stream: (async (_m: string, opts: Seen) => ({ fullStream: (async function* () { await new Promise((_, reject) => opts.abortSignal.addEventListener('abort', () => reject(new Error('aborted')))); })() })) as unknown as ChatDeps['supervisor']['stream'] };
    const events = await collect(handleChat(hang, ctx(), { threadId: 'a', message: 'q' }));
    expect(events.at(-1)).toEqual({ type: 'error', message: expect.stringContaining('took longer than') });
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

describe('handleFeedback', () => {
  it('rejects an unknown space and reports Genie failures as upstream errors', async () => {
    const genie = { feedback: vi.fn().mockRejectedValue(new Error('down')) } as unknown as GenieClient;
    await expect(handleFeedback({ genie, registry, logger: silentLogger }, ctx(), { spaceId: 'nope', conversationId: 'c', messageId: 'm', rating: 'POSITIVE' })).rejects.toBeInstanceOf(ValidationError);
    await expect(handleFeedback({ genie, registry, logger: silentLogger }, ctx(), { spaceId: 'id-1', conversationId: 'c', messageId: 'm', rating: 'POSITIVE' })).rejects.toBeInstanceOf(UpstreamError);
    expect(genie.feedback).toHaveBeenCalledWith(expect.objectContaining({ caller: { userId: 'u1', userToken: 'identity-token', sessionId: undefined } }));
  });
});
