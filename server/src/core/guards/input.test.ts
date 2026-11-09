import { Agent } from '@mastra/core/agent';
import { describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '../../contracts';
import type { BiLogger } from '../../ports/logger';
import { stubModel } from '../agents/stubModel';
import { handleChat, REFUSED_MESSAGE, type ChatDeps } from '../chat/handleChat';
import { createSpaceRegistry } from '../genie/registry';
import { ADVERSARIAL, ORDINARY } from './fixtures/injection';
import { type Detector, INJECTION_GUARD_ID, inputGuards } from './input';

type Args = Parameters<Detector['processInput']>[0];
const lastText = (args: Args) => JSON.stringify(args.messages.at(-1)?.content ?? '');

// Behaves like Mastra's detector with strategy 'block': aborts on a flagged question, passes the rest through.
const stubDetector = (): Detector => ({
  async processInput(args) {
    if (ADVERSARIAL.some((q) => lastText(args).includes(q.slice(0, 20)))) args.abort('Prompt injection detected. Types: injection. Reason: tries to override instructions');
    return args.messages;
  },
});
// Behaves like the detector whose guard model call failed: the newer 'strict' wording, or a plain error.
const failingDetector = (how: 'strict' | 'throw'): Detector => ({
  async processInput(args) {
    if (how === 'strict') args.abort('Prompt injection detection failed because the internal model call failed');
    throw new Error('model down');
  },
});

function recorder() {
  const lines: Array<{ level: string; event: string; fields: Record<string, unknown> }> = [];
  const at = (level: string) => (event: string, fields: Record<string, unknown> = {}) => void lines.push({ level, event, fields });
  const logger: BiLogger = { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error'), child: () => logger };
  return { logger, lines };
}

async function ask(question: string, guards: ReturnType<typeof inputGuards>) {
  const { logger, lines } = recorder();
  const { model, prompts } = stubModel([{ text: 'There are 42.' }]);
  const supervisor = new Agent({ id: 'bi_supervisor', name: 'bi_supervisor', instructions: 's', model, inputProcessors: guards });
  const quiet = new Agent({ id: 'suggest_agent', name: 'suggest_agent', instructions: 'x', model: stubModel([{ text: '{"questions":[]}' }]).model });
  const deps: ChatDeps = {
    supervisor, suggestAgent: quiet, registry: createSpaceRegistry([{ key: 'placement', name: 'Placement', description: 'd', spaceId: 'id-1' }]),
    modelLabel: 'stub', suggestWaitMs: 0, genieMode: 'conversation', logger, turnTimeoutMs: 30_000, history: { turns: 3, maxChars: 1500, includeSql: false },
  };
  const events: ChatEvent[] = [];
  for await (const e of handleChat(deps, { userId: 'u', userToken: 't', traceId: 'tr', signal: new AbortController().signal }, { threadId: 'a', message: question })) events.push(e);
  return { events, lines, modelCalls: prompts.length };
}

describe('input guards', () => {
  it('off: only the normalizer, and no detector is made', () => {
    const make = vi.fn(stubDetector);
    expect(inputGuards({ injection: 'off', model: 'x/y', failClosed: false }, make).map((p) => p.id)).toEqual(['unicode-normalizer']);
    expect(make).not.toHaveBeenCalled();
  });

  it('log: records a hit without its text, and the question is still answered', async () => {
    for (const question of ADVERSARIAL) {
      const { events, lines } = await ask(question, inputGuards({ injection: 'log', model: 'x/y', failClosed: false }, stubDetector));
      expect(events.find((e) => e.type === 'final')).toMatchObject({ result: { answer: 'There are 42.' } });
      const flagged = lines.find((l) => l.event === 'guard.input.flagged');
      expect(flagged?.fields).toMatchObject({ processorId: INJECTION_GUARD_ID, reason: expect.stringContaining('injection') });
      expect(JSON.stringify(lines)).not.toContain(question);
    }
  });

  it('block: a flagged question gets the fixed message, and the model is never asked', async () => {
    for (const question of ADVERSARIAL) {
      const { events, lines, modelCalls } = await ask(question, inputGuards({ injection: 'block', model: 'x/y', failClosed: false }, stubDetector));
      expect(events.at(-1)).toEqual({ type: 'error', message: REFUSED_MESSAGE });
      expect(events.some((e) => e.type === 'final' || e.type === 'text')).toBe(false);
      expect(modelCalls).toBe(0);
      expect(lines.find((l) => l.event === 'guard.input.blocked')?.fields).toMatchObject({ reason: expect.stringContaining('injection') });
      expect(JSON.stringify(lines)).not.toContain(question);
    }
  });

  it('block: ordinary questions are answered', async () => {
    for (const question of ORDINARY) {
      const { events } = await ask(question, inputGuards({ injection: 'block', model: 'x/y', failClosed: false }, stubDetector));
      expect(events.at(-1)).toMatchObject({ type: 'final' });
    }
  });

  it('guard model failure, fail open: answers and logs the failure', async () => {
    for (const how of ['strict', 'throw'] as const) {
      const { events, lines } = await ask(ORDINARY[0], inputGuards({ injection: 'block', model: 'x/y', failClosed: false }, () => failingDetector(how)));
      expect(events.at(-1)).toMatchObject({ type: 'final' });
      expect(lines.some((l) => l.event === 'guard.input.error')).toBe(true);
    }
  });

  it('guard model failure, fail closed: refuses', async () => {
    for (const how of ['strict', 'throw'] as const) {
      const { events } = await ask(ORDINARY[0], inputGuards({ injection: 'log', model: 'x/y', failClosed: true }, () => failingDetector(how)));
      expect(events.at(-1)).toEqual({ type: 'error', message: REFUSED_MESSAGE });
    }
  });

  it('the normalizer strips control characters before the model sees the question', async () => {
    const { model, prompts } = stubModel([{ text: 'ok' }]);
    const agent = new Agent({ id: 's', name: 's', instructions: 's', model, inputProcessors: inputGuards({ injection: 'off', failClosed: false }) });
    for await (const _ of (await agent.stream('How\u0007 many   placements?')).fullStream) void _;
    expect(JSON.stringify(prompts[0].at(-1))).toContain('How many placements?');
  });
});
