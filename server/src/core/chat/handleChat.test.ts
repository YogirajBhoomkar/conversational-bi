import { describe, expect, it, vi } from 'vitest';
import type { ChatEvent, GenieClient } from '../../contracts';
import type { BiRequestContext } from '../../ports/context';
import { UpstreamError, ValidationError } from '../errors';
import { createSpaceRegistry } from '../genie/registry';
import { silentLogger } from '../log';
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
    expect(rc.get('signal')).toBe(abort.signal);
    expect(seen[0].abortSignal).toBe(abort.signal);
    expect(seen[0].memory).toEqual({ thread: 'u1::a', resource: 'u1' });
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
