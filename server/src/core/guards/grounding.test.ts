import { describe, expect, it } from 'vitest';
import type { ChatEvent, GenieResult } from '../../contracts';
import type { BiLogger } from '../../ports/logger';
import type { Collector } from '../chat/collector';
import { handleChat, type ChatDeps } from '../chat/handleChat';
import { createSpaceRegistry } from '../genie/registry';
import { checkGrounding, extractFigures } from './grounding';

const result = (rows: unknown[][], summary = ''): GenieResult => ({
  spaceId: 'id-1', question: 'q', summary, sql: null, columns: ['Region', 'Limit'], rows, totalRows: rows.length, thinking: [], suggestedQuestions: [],
  statementId: null, conversationId: 'c', messageId: 'm', error: null,
});
const REGIONS = result([['EMEA', 492_215_330], ['APAC', 300_000_000], ['LATAM', 207_784_670]]);
const check = (answer: string, results = [REGIONS], question = 'Limit by region?') => checkGrounding(answer, results, question);

describe('extractFigures', () => {
  it('reads separators, decimals, negatives, percents, currency and K/M/B', () => {
    expect(extractFigures('1,737.2M, -4.5%, $120K, €3bn and 42').map((f) => f.value)).toEqual([1_737_200_000, -4.5, 120_000, 3e9, 42]);
  });

  it('ignores list numbering and years', () => {
    expect(extractFigures('1. EMEA in 2024\n2) APAC since 1999').map((f) => f.raw)).toEqual([]);
  });
});

describe('checkGrounding', () => {
  it('accepts an exact value', () => {
    expect(check('EMEA placed 492215330.')).toMatchObject({ checked: 1, ungrounded: 0 });
  });

  it('accepts a value rounded to its written precision, with a suffix', () => {
    expect(check('EMEA leads with **492.2M**, APAC 300M.')).toMatchObject({ checked: 2, ungrounded: 0 });
  });

  it('accepts a share of the column total and a percent change between rows', () => {
    // 492.2M of 1,000M is 49.2%; EMEA is 64.1% above APAC
    expect(check('EMEA holds 49.2% of the total, 64.1% more than APAC.')).toMatchObject({ checked: 2, ungrounded: 0 });
  });

  it('flags an invented number, and lists it', () => {
    expect(check('EMEA placed 512.9M.')).toEqual({ checked: 1, ungrounded: 1, values: ['512.9M'] });
  });

  it('handles negatives', () => {
    const change = result([['2023', 100], ['2024', 80]]);
    expect(check('Placements fell by -20 (-20%).', [change])).toMatchObject({ checked: 2, ungrounded: 0 });
  });

  it('skips numbers the user wrote', () => {
    expect(check('Here are the top 5 regions: EMEA 492.2M.', [REGIONS], 'Top 5 regions by limit?')).toMatchObject({ checked: 1, ungrounded: 0 });
  });

  it('with no Genie data, flags figures only when there are some', () => {
    expect(check('There are 42 placements.', [])).toMatchObject({ checked: 1, ungrounded: 1 });
    expect(check('I can answer questions about placements.', [])).toMatchObject({ checked: 0, ungrounded: 0 });
  });
});

describe('grounding in the chat.turn log', () => {
  async function turn(grounding: boolean) {
    const lines: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const logger: BiLogger = { debug() {}, info: (event, fields = {}) => void lines.push({ event, fields }), warn() {}, error() {}, child: () => logger };
    const deps: ChatDeps = {
      supervisor: { stream: (async (_m: unknown, opts: { requestContext: { get(k: string): unknown } }) => {
        (opts.requestContext.get('collector') as Collector).results.push(REGIONS);
        return { fullStream: (async function* () {
          yield { type: 'text-delta', payload: { text: 'EMEA placed 512.9M.' } };
          yield { type: 'step-finish', payload: { stepResult: { reason: 'stop' } } };
        })() };
      }) as unknown as ChatDeps['supervisor']['stream'] },
      suggestAgent: { generate: (async () => ({ object: { questions: [] } })) as unknown as ChatDeps['suggestAgent']['generate'] },
      registry: createSpaceRegistry([{ key: 'placement', name: 'Placement', description: 'd', spaceId: 'id-1' }]),
      modelLabel: 'm', suggestWaitMs: 0, genieMode: 'conversation', logger, turnTimeoutMs: 30_000, history: { turns: 3, maxChars: 1500, includeSql: false }, grounding,
    };
    const events: ChatEvent[] = [];
    for await (const e of handleChat(deps, { userId: 'u', userToken: 't', traceId: 'tr', signal: new AbortController().signal }, { threadId: 'a', message: 'q' })) events.push(e);
    return { events, turnLog: lines.find((l) => l.event === 'chat.turn')?.fields };
  }

  it('logs counts, leaves the answer untouched, and puts the values under `content`', async () => {
    const { events, turnLog } = await turn(true);
    expect(turnLog?.grounding).toEqual({ checked: 1, ungrounded: 1, content: ['512.9M'] });
    expect(events.find((e) => e.type === 'final')).toMatchObject({ result: { answer: 'EMEA placed 512.9M.' } });
  });

  it('does nothing when off', async () => {
    const { events, turnLog } = await turn(false);
    expect(turnLog).not.toHaveProperty('grounding');
    expect(events.find((e) => e.type === 'final')).toMatchObject({ result: { answer: 'EMEA placed 512.9M.' } });
  });
});
