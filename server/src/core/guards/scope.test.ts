import { describe, expect, it, vi } from 'vitest';
import type { ChatEvent, FinalAnswer, GenieResult } from '../../contracts';
import type { BiLogger } from '../../ports/logger';
import { scopeMessage } from '../agents/prompts';
import type { Collector } from '../chat/collector';
import { handleChat, type ChatDeps } from '../chat/handleChat';
import { createSpaceRegistry } from '../genie/registry';
import { createOutputGuard } from './output';
import { createScopeGuard, type ScopeGuardMode, textOnlyReply } from './scope';
import { GENIE_REPLIES, OUT_OF_SCOPE } from './scopeFixtures';

const registry = createSpaceRegistry([
  { key: 'orders', name: 'Fake orders', description: 'Fake order figures by year.', spaceId: 'id-orders' },
  { key: 'stock', name: 'Fake stock', description: 'Fake stock levels by site.', spaceId: 'id-stock' },
]);
const MESSAGE = scopeMessage(registry.spaces);

function recorder() {
  const lines: Array<{ level: string; event: string; fields: Record<string, unknown> }> = [];
  const at = (level: string) => (event: string, fields: Record<string, unknown> = {}) => void lines.push({ level, event, fields });
  const logger: BiLogger = { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error'), child: () => logger };
  return { logger, lines };
}

type Options = { mode?: ScopeGuardMode; message?: string; clarify?: boolean; fail?: boolean; genieMode?: ChatDeps['genieMode'] };

// A turn in which the data agents recorded the given Genie results, then the model wrote `text`.
async function turn(results: GenieResult[], text: string, question: string, { mode = 'enforce', message = MESSAGE, clarify, fail, genieMode = 'conversation' }: Options = {}) {
  const { logger, lines } = recorder();
  const generate = vi.fn(async () => ({ object: { questions: [{ question: 'Ours?', space: 'orders' }] } }));
  const deps: ChatDeps = {
    supervisor: {
      stream: (async (_m: unknown, opts: { requestContext: { get(k: string): unknown } }) => {
        const collector = opts.requestContext.get('collector') as Collector;
        collector.results.push(...results);
        if (clarify) collector.clarification = { question: 'Which year?', options: ['This year', 'Last year'] };
        return { fullStream: (async function* () {
          yield { type: 'tool-result', payload: {} };
          yield { type: 'text-delta', payload: { text } };
          if (fail) yield { type: 'error', payload: { error: { message: 'model down' } } };
          yield { type: 'step-finish', payload: { stepResult: { reason: 'stop' } } };
        })() };
      }) as unknown as ChatDeps['supervisor']['stream'],
    },
    suggestAgent: { generate } as unknown as ChatDeps['suggestAgent'],
    registry, modelLabel: 'stub', suggestWaitMs: 500, genieMode, logger, turnTimeoutMs: 30_000, history: { turns: 3, maxChars: 1500, includeSql: false },
    outputGuard: createOutputGuard(true, registry),
    scopeGuard: createScopeGuard(mode, message),
  };
  const events: ChatEvent[] = [];
  for await (const e of handleChat(deps, { userId: 'u', userToken: 't', traceId: 'tr', signal: new AbortController().signal }, { threadId: 'a', message: question })) events.push(e);
  const final = (events.find((e) => e.type === 'final') as { result: FinalAnswer } | undefined)?.result;
  return { events, final, lines, generate };
}

const JOKE = 'Why did the spreadsheet blush? It saw the pivot table.';

describe('which replies count as text only', () => {
  it('Genie calls that all answered with text and no SQL or rows, with no question back', () => {
    expect(textOnlyReply([GENIE_REPLIES.textOnly])).toBe(true);
    expect(textOnlyReply([GENIE_REPLIES.textOnly, GENIE_REPLIES.textOnly])).toBe(true);
  });

  it('not: no Genie call, a query with zero rows, rows, a failed call, or a question back', () => {
    expect(textOnlyReply([])).toBe(false);
    expect(textOnlyReply([GENIE_REPLIES.zeroRows])).toBe(false);
    expect(textOnlyReply([GENIE_REPLIES.withRows])).toBe(false);
    expect(textOnlyReply([GENIE_REPLIES.textOnly, GENIE_REPLIES.withRows])).toBe(false);
    expect(textOnlyReply([GENIE_REPLIES.failed])).toBe(false);
    expect(textOnlyReply([GENIE_REPLIES.textOnly], { question: 'Which?', options: ['A', 'B'] })).toBe(false);
  });
});

describe('the reply check in a turn (BI_GUARD_SCOPE=enforce, the default)', () => {
  it.each(OUT_OF_SCOPE)('"%s" delegated anyway, Genie answered with text: replaced by the scope message', async (question) => {
    const { events, final, lines, generate } = await turn([GENIE_REPLIES.textOnly], JOKE, question);
    const types = events.map((e) => e.type);
    expect(types.slice(types.indexOf('text-reset'))).toEqual(['text-reset', 'text', 'final']);
    expect(events.at(-2)).toEqual({ type: 'text', delta: MESSAGE });
    expect(final).toMatchObject({ answer: MESSAGE, columns: [], rows: [], totalRows: 0, charts: [], chartSpec: null, sources: [], suggestedQuestions: [] });
    expect(generate).not.toHaveBeenCalled();
    const replaced = lines.find((l) => l.event === 'guard.scope.replaced');
    expect(replaced).toMatchObject({ level: 'warn', fields: { genieCalls: 1, mode: 'enforce' } });
    expect(JSON.stringify(lines)).not.toContain(question); // counts only, no content
    expect(JSON.stringify(lines)).not.toContain('pivot table');
    expect(lines.find((l) => l.event === 'chat.turn')?.fields).toMatchObject({ genieCalls: 1, outOfScope: true });
  });

  it('keeps a query that ran and found zero rows: a real "no data found" answer', async () => {
    const { final, lines } = await turn([GENIE_REPLIES.zeroRows], 'No orders matched that filter.', 'orders in 1990 by region');
    expect(final).toMatchObject({ answer: 'No orders matched that filter.', columns: ['region', 'amount'], sources: [expect.objectContaining({ sql: GENIE_REPLIES.zeroRows.sql })] });
    expect(lines.some((l) => l.event.startsWith('guard.scope'))).toBe(false);
  });

  it('keeps a data answer', async () => {
    const { final } = await turn([GENIE_REPLIES.withRows], 'Orders were **42** in 2024.', 'orders by year');
    expect(final).toMatchObject({ answer: 'Orders were **42** in 2024.', rows: [[2024, 42]] });
  });

  it('keeps a question back to the user', async () => {
    const { final } = await turn([GENIE_REPLIES.textOnly], '', 'orders for the year', { clarify: true });
    expect(final).toMatchObject({ answer: '', clarification: { question: 'Which year?' } });
  });

  it('keeps a clarification the model wrote as text', async () => {
    const { final } = await turn([], 'Which year do you mean?\n- This year\n- Last year', 'orders for the year');
    expect(final).toMatchObject({ clarification: { question: 'Which year do you mean?' } });
  });

  it('leaves a failed turn untouched: an error, no final, no scope message', async () => {
    const { events, lines } = await turn([GENIE_REPLIES.textOnly], JOKE, 'tell me a joke', { fail: true });
    expect(events.at(-1)).toMatchObject({ type: 'error' });
    expect(events.some((e) => e.type === 'final')).toBe(false);
    expect(JSON.stringify(events)).not.toContain(MESSAGE);
    expect(lines.some((l) => l.event.startsWith('guard.scope'))).toBe(false);
  });

  it('leaves a failed Genie call to the no-data message', async () => {
    const { final } = await turn([GENIE_REPLIES.failed], 'Orders were 42.', 'orders by year');
    expect(final?.answer).not.toBe(MESSAGE);
  });

  it('writes no follow-ups for a replaced turn in Agent mode either', async () => {
    const { events, generate } = await turn([GENIE_REPLIES.textOnly], JOKE, 'tell me a joke', { genieMode: 'agent' });
    expect(generate).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'suggestions')).toBe(false);
  });

  it('writes no follow-ups for a greeting (no Genie call), which is left as written', async () => {
    const { final, events, generate } = await turn([], 'Hello! Ask me about orders or stock.', 'hello');
    expect(final?.answer).toBe('Hello! Ask me about orders or stock.');
    expect(generate).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'suggestions')).toBe(false);
  });

  it('uses the configured message (BI_SCOPE_MESSAGE)', async () => {
    const { final } = await turn([GENIE_REPLIES.textOnly], JOKE, 'tell me a joke', { message: 'Only order and stock questions, please.' });
    expect(final?.answer).toBe('Only order and stock questions, please.');
  });
});

describe('other modes do not change the answer', () => {
  it('log: the answer stays, guard.scope.flagged is logged with counts only', async () => {
    const { final, events, lines } = await turn([GENIE_REPLIES.textOnly], JOKE, 'tell me a joke', { mode: 'log' });
    expect(final?.answer).toBe(JOKE);
    expect(events.some((e) => e.type === 'text-reset')).toBe(false);
    expect(lines.find((l) => l.event === 'guard.scope.flagged')).toMatchObject({ level: 'warn', fields: { genieCalls: 1, mode: 'log' } });
    expect(lines.some((l) => l.event === 'guard.scope.replaced')).toBe(false);
    expect(final?.suggestedQuestions).toEqual([]); // still no follow-ups: the turn got no data
  });

  it('off: nothing is checked or logged', async () => {
    const { final, lines } = await turn([GENIE_REPLIES.textOnly], JOKE, 'tell me a joke', { mode: 'off' });
    expect(final?.answer).toBe(JOKE);
    expect(lines.some((l) => l.event.startsWith('guard.scope'))).toBe(false);
  });
});
