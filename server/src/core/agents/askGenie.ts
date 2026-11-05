import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { ChartSpec, GenieClient, GenieSpace } from '../../contracts';
import { getConversationId, getLastResult, setConversationId, setLastResult } from '../genie/conversations';
import { getCaller, getCollector, getSignal, getThreadId } from '../chat/collector';
import { parseGenieChartJson } from '../chart/chartSpec';

// What a chart shows, whatever its type and title: the same fields over the same rows (in any order; a line chart
// sorts its rows by date).
const viewOf = ({ x, y, color, path, data }: ChartSpec) =>
  JSON.stringify({ x, y, color, path, rows: data.map((d) => JSON.stringify(d)).sort() });

export const createAskGenieTool =(space: GenieSpace, client: GenieClient) =>
  createTool({
    id: `ask-${space.key}`,
    description: `Ask the Databricks Genie space "${space.name}" a natural-language data question. ${space.description}`,
    inputSchema: z.object({
      question: z.string().describe('A self-contained natural-language data question'),
    }),
    outputSchema: z.object({
      summary: z.string(),
      sql: z.string().nullable(),
      columns: z.array(z.string()),
      sampleRows: z.array(z.array(z.unknown())),
      totalRows: z.number(),
      shownRows: z.number().describe('rows the UI table shows; if less than totalRows it is only a preview'),
      truncated: z.boolean(),
      chartReady: z.boolean().describe('true when at least one chart for this result will be shown in the UI'),
      chartCount: z.number().describe('how many charts from this result the UI will show'),
      error: z.string().nullable(),
    }),
    execute: async ({ question }, { requestContext }) => {
      const threadId = getThreadId(requestContext);
      const collector = getCollector(requestContext);
      const result = await client.ask({
        spaceId: space.spaceId,
        question,
        conversationId: getConversationId(threadId, space.spaceId),
        caller: getCaller(requestContext),
        signal: getSignal(requestContext),
        onProgress: (event) => collector.emit?.(event, space.key),
      });
      if (result.conversationId) setConversationId(threadId, space.spaceId, result.conversationId);
      // Charts are built in code from Genie's chart JSON. It comes as the result itself (a one-cell table) and, in
      // Agent mode, once per chart query next to any real table. Each distinct view is kept once: the same data drawn
      // as another type (or arriving twice) adds nothing, since the user can switch a chart's type in the UI. The first
      // chart's data stands in for the table only when there is no real one.
      const fromTable = parseGenieChartJson(result.columns, result.rows);
      const parsed = [...(result.chartJsons ?? []).map((j) => parseGenieChartJson(['chart_json'], [[j]])), fromTable].filter((p) => p !== null);
      const seen = new Set(collector.charts.map(viewOf));
      let chartCount = 0;
      for (const { chart } of parsed) {
        if (!chart || seen.has(viewOf(chart))) continue;
        seen.add(viewOf(chart));
        collector.charts.push(chart);
        chartCount++;
      }
      if (parsed[0] && (fromTable || !result.columns.length)) {
        result.columns = parsed[0].columns;
        result.rows = parsed[0].rows;
        result.totalRows = parsed[0].rows.length;
      } else if (!parsed.length && result.columns.length === 1 && result.rows.length === 1) {
        // A one-cell result is usually chart JSON in a shape we don't recognise; log it to diagnose.
        console.warn(`[genie] unparsed single-cell result, column=${result.columns[0]}: ${String(result.rows[0][0]).slice(0, 300)}`);
      }
      collector.results.push(result);
      setLastResult(threadId, space.spaceId, result);
      // Keep the LLM context small; the full capped rows go to the UI via the collector.
      return {
        summary: result.summary,
        sql: result.sql,
        columns: result.columns,
        sampleRows: result.rows.slice(0, 20),
        totalRows: result.totalRows,
        shownRows: result.rows.length,
        truncated: result.totalRows > result.rows.length,
        chartReady: chartCount > 0,
        chartCount,
        error: result.error,
      };
    },
  });

// Loads the complete result of this space's previous query when the user asked for all rows (the UI otherwise shows a preview).
export const createFetchFullResultsTool = (space: GenieSpace, client: GenieClient, fullRowCap: number) =>
  createTool({
    id: `fetch-full-${space.key}`,
    description: `Load ALL rows of the previous "${space.name}" query into the UI table. Only use this after the user has asked for the full/complete results.`,
    inputSchema: z.object({}),
    outputSchema: z.object({ ok: z.boolean(), message: z.string(), totalRows: z.number(), shownRows: z.number() }),
    execute: async (_in, { requestContext }) => {
      const threadId = getThreadId(requestContext);
      const last = getLastResult(threadId, space.spaceId);
      const fail = (message: string) => ({ ok: false, message, totalRows: last?.totalRows ?? 0, shownRows: last?.rows.length ?? 0 });
      if (!last?.statementId || !client.fetchFullResult) return fail('The full result is not available for the previous query.');
      try {
        const full = await client.fetchFullResult({
          statementId: last.statementId,
          cap: fullRowCap,
          caller: getCaller(requestContext),
        signal: getSignal(requestContext),
        });
        const result = { ...last, columns: full.columns.length ? full.columns : last.columns, rows: full.rows, totalRows: full.totalRows };
        getCollector(requestContext).results.push(result);
        setLastResult(threadId, space.spaceId, result);
        const capped = full.totalRows > full.rows.length;
        return {
          ok: true,
          message: capped ? `Loaded the first ${full.rows.length} of ${full.totalRows} rows (the maximum the table can show).` : `Loaded all ${full.rows.length} rows.`,
          totalRows: full.totalRows,
          shownRows: full.rows.length,
        };
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  });
