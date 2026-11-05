import { describe, expect, it } from 'vitest';
import type { GenieClient, GenieResult, GenieSpace } from '../../contracts';
import { newCollector, type TurnValues } from '../chat/collector';
import { createAskGenieTool } from './askGenie';

const space = (key: string): GenieSpace => ({ key, name: key, description: `The ${key} space.`, spaceId: `id-${key}` });

const result = (spaceId: string, columns: string[], rows: unknown[][]): GenieResult => ({
  spaceId, question: 'q', conversationId: `c-${spaceId}`, messageId: `m-${spaceId}-${Math.random()}`, statementId: null,
  sql: null, columns, rows, totalRows: rows.length, summary: '', thinking: [], suggestedQuestions: [], error: null,
});

const chartJson = JSON.stringify({
  type: 'column', x: 'Region', y: 'Limit',
  data: [{ Region: 'APAC', Limit: 1 }, { Region: 'EMEA', Limit: 2 }],
});
const CHART = (spaceId: string) => result(spaceId, ['chart_json'], [[chartJson]]);
const TABLE = (spaceId: string) => result(spaceId, ['Region', 'Unused'], [['APAC', 3]]);

// Runs the tool for each answer in order, inside one turn, and returns the turn's collector.
async function turn(answers: Array<[GenieSpace, (spaceId: string) => GenieResult]>) {
  const collector = newCollector();
  const values: TurnValues = { collector, threadId: `t-${Math.random()}`, caller: () => ({ userId: 'u' }), signal: new AbortController().signal };
  const requestContext = { get: (k: keyof TurnValues) => values[k] };
  const chartReady: boolean[] = [];
  for (const [s, answer] of answers) {
    const client: GenieClient = { ask: async () => answer(s.spaceId), feedback: async () => {} };
    const out = await createAskGenieTool(s, client).execute!({ question: 'q' }, { requestContext } as never);
    chartReady.push((out as { chartReady: boolean }).chartReady);
  }
  return { chart: collector.chart, chartReady };
}

describe('ask-genie tool: which chart the turn keeps', () => {
  const placement = space('placement');
  const capacity = space('capacity');

  it('keeps a chart when another space answers later in the same turn', async () => {
    const { chart, chartReady } = await turn([[placement, CHART], [capacity, TABLE]]);
    expect(chart?.spaceId).toBe('id-placement');
    expect(chartReady).toEqual([true, false]);
  });

  it('drops a chart when the same space answers again without one', async () => {
    expect((await turn([[placement, CHART], [placement, TABLE]])).chart).toBeNull();
  });
});
