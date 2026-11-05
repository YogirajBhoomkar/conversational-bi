import { describe, expect, it } from 'vitest';
import type { GenieClient, GenieResult, GenieSpace } from '../../contracts';
import { newCollector, type TurnValues } from '../chat/collector';
import { createAskGenieTool } from './askGenie';

const space = (key: string): GenieSpace => ({ key, name: key, description: `The ${key} space.`, spaceId: `id-${key}` });

const result = (spaceId: string, columns: string[], rows: unknown[][], extra: Partial<GenieResult> = {}): GenieResult => ({
  spaceId, question: 'q', conversationId: `c-${spaceId}`, messageId: `m-${spaceId}-${Math.random()}`, statementId: null,
  sql: null, columns, rows, totalRows: rows.length, summary: '', thinking: [], suggestedQuestions: [], error: null, ...extra,
});

const chartJson = (title: string) => JSON.stringify({
  type: 'column', title, x: 'Region', y: 'Limit',
  data: [{ Region: 'APAC', Limit: 1 }, { Region: 'EMEA', Limit: 2 }],
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

  it('collects charts across spaces and answers', async () => {
    const premium = (spaceId: string) => result(spaceId, ['chart_json'], [[chartJson('Premium')]]);
    expect((await turn([[placement, CHART], [capacity, premium]])).titles).toEqual(['Limit', 'Premium']);
  });
});
