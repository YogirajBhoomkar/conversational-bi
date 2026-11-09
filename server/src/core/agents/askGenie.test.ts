import { describe, expect, it } from 'vitest';
import type { GenieClient, GenieResult, GenieSpace } from '../../contracts';
import { newCollector, type TurnValues } from '../chat/collector';
import { createAskGenieTool, createFetchFullResultsTool } from './askGenie';

const space = (key: string): GenieSpace => ({ key, name: key, description: `The ${key} space.`, spaceId: `id-${key}` });

const result = (spaceId: string, columns: string[], rows: unknown[][], extra: Partial<GenieResult> = {}): GenieResult => ({
  spaceId, question: 'q', conversationId: `c-${spaceId}`, messageId: `m-${spaceId}-${Math.random()}`, statementId: null,
  sql: null, columns, rows, totalRows: rows.length, summary: '', thinking: [], suggestedQuestions: [], error: null, ...extra,
});

// Charts with different titles hold different data, so they count as different views.
const chartJson = (title: string, type = 'column') => JSON.stringify({
  type, title, x: 'Region', y: 'Limit',
  data: [{ Region: 'APAC', Limit: title.charCodeAt(0) }, { Region: 'EMEA', Limit: 2 }],
});
const CHART = (spaceId: string) => result(spaceId, ['chart_json'], [[chartJson('Limit')]]);
const TABLE = (spaceId: string) => result(spaceId, ['Region', 'Unused'], [['APAC', 3]]);

// Runs the tool for each answer in order, inside one turn.
async function turn(answers: Array<[GenieSpace, (spaceId: string) => GenieResult]>) {
  const collector = newCollector();
  const values: TurnValues = { collector, threadId: `t-${Math.random()}`, caller: () => ({ userId: 'u' }), signal: new AbortController().signal };
  const requestContext = { get: (k: keyof TurnValues) => values[k] };
  const chartCount: number[] = [];
  for (const [s, answer] of answers) {
    const client: GenieClient = { ask: async () => answer(s.spaceId), feedback: async () => {} };
    const out = await createAskGenieTool(s, client).execute!({ question: 'q' }, { requestContext } as never);
    chartCount.push((out as { chartCount: number }).chartCount);
  }
  return { titles: collector.charts.map((c) => c.title), chartCount, results: collector.results };
}

describe('ask-genie tool: charts of a turn', () => {
  const placement = space('placement');
  const capacity = space('capacity');

  it('keeps a chart when another space answers later in the same turn', async () => {
    const { titles, chartCount } = await turn([[placement, CHART], [capacity, TABLE]]);
    expect(titles).toEqual(['Limit']);
    expect(chartCount).toEqual([1, 0]);
  });

  it('keeps every chart of one answer, the real table next to them, and each chart once', async () => {
    const answer = (spaceId: string) => ({ ...TABLE(spaceId), chartJsons: [chartJson('Limit'), chartJson('Premium'), chartJson('Limit')] });
    const { titles, chartCount, results } = await turn([[placement, answer]]);
    expect(titles).toEqual(['Limit', 'Premium']);
    expect(chartCount).toEqual([2]);
    expect(results[0].columns).toEqual(['Region', 'Unused']);
  });

  it('never shows chart JSON as the table: the chart data stands in when there is no real table', async () => {
    // Agent mode can return a chart query as the result section too, so the "table" is the same JSON again.
    const answer = (spaceId: string) => result(spaceId, ['chart_json'], [[chartJson('Trend')]], { chartJsons: [chartJson('Limit'), chartJson('Trend')] });
    const { titles, results } = await turn([[placement, answer]]);
    expect(titles).toEqual(['Limit', 'Trend']);
    expect(results[0].columns).toEqual(['Region', 'Limit']);
  });

  it('shows the same data once, not again as another chart type (the UI switches types)', async () => {
    const answer = (spaceId: string) => ({ ...TABLE(spaceId), chartJsons: [chartJson('Limit'), chartJson('Limit', 'line'), chartJson('Limit', 'area')] });
    const { titles, chartCount } = await turn([[placement, answer]]);
    expect(titles).toEqual(['Limit']);
    expect(chartCount).toEqual([1]);
  });

  it('collects charts across spaces and answers', async () => {
    const premium = (spaceId: string) => result(spaceId, ['chart_json'], [[chartJson('Premium')]]);
    expect((await turn([[placement, CHART], [capacity, premium]])).titles).toEqual(['Limit', 'Premium']);
  });
});

// The per-thread Genie state (core/genie/conversations.ts) is a best-effort optimisation held by one instance. Another
// instance, or this one after a restart, has none: it must start a new Genie conversation and say plainly that the
// full result of an earlier query is not available.
describe('Genie tools on an instance with no state for the thread', () => {
  const placement = space('placement');
  const fresh = (): TurnValues => ({ collector: newCollector(), threadId: `new-${Math.random()}`, caller: () => ({ userId: 'u' }), signal: new AbortController().signal });

  it('starts a new Genie conversation', async () => {
    const values = fresh();
    const asked: Array<string | undefined> = [];
    const client: GenieClient = { ask: async (req) => (asked.push(req.conversationId), TABLE(placement.spaceId)), feedback: async () => {} };
    await createAskGenieTool(placement, client).execute!({ question: 'Placements by region in 2024' }, { requestContext: { get: (k: keyof TurnValues) => values[k] } } as never);
    expect(asked).toEqual([undefined]);
  });

  it('"show all rows" fails with its friendly message, without calling Genie', async () => {
    const values = fresh();
    let fetched = false;
    const client: GenieClient = { ask: async () => TABLE(placement.spaceId), feedback: async () => {}, fetchFullResult: async () => ((fetched = true), { columns: [], rows: [], totalRows: 0 }) };
    const out = await createFetchFullResultsTool(placement, client, 100).execute!({}, { requestContext: { get: (k: keyof TurnValues) => values[k] } } as never);
    expect(out).toEqual({ ok: false, message: 'The full result is not available for the previous query.', totalRows: 0, shownRows: 0 });
    expect(fetched).toBe(false);
  });
});
