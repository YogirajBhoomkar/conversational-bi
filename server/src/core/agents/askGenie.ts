import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import type { GenieClient, GenieSpace } from '../../contracts';
import { getConversationId, getLastResult, setConversationId, setLastResult } from '../genie/conversations';
import { getCaller, getCollector, getSignal, getThreadId } from '../chat/collector';
import { parseGenieChartJson } from '../chart/chartSpec';

export const createAskGenieTool = (space: GenieSpace, client: GenieClient) =>
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
      chartReady: z.boolean().describe('true when a chart for this result will be shown in the UI'),
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
        onProgress: (text) => collector.emit?.(text),
      });
      if (result.conversationId) setConversationId(threadId, space.spaceId, result.conversationId);
      // If Genie answered with chart JSON, swap in the real table and build the chart from it (in code).
      // The chart always belongs to the latest result, so a later non-chart answer clears an earlier chart.
      const fromJson = parseGenieChartJson(result.columns, result.rows);
      collector.chart = fromJson?.chart ?? null;
      if (fromJson) {
        result.columns = fromJson.columns;
        result.rows = fromJson.rows;
        result.totalRows = fromJson.rows.length;
      } else if (result.columns.length === 1 && result.rows.length === 1) {
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
        chartReady: collector.chart !== null,
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
