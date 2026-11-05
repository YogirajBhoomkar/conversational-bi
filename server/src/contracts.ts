// Shared contracts. Genie client, workflow and UI all build against these. Do not change without updating all three.
import { z } from 'zod';

export const GenieResultSchema = z.object({
  spaceId: z.string(),
  question: z.string(),
  summary: z.string(),               // Genie's text answer
  sql: z.string().nullable(),
  columns: z.array(z.string()),
  rows: z.array(z.array(z.unknown())), // capped (GENIE_ROW_CAP, default 200)
  totalRows: z.number(),
  thinking: z.array(z.string()),           // Genie's internal reasoning steps (query attachment "thoughts")
  suggestedQuestions: z.array(z.string()), // Genie's recommended follow-up questions
  statementId: z.string().nullable(),      // SQL statement id of the result, used to load the full result set (Agent mode)
  chartJsons: z.array(z.string()).optional(), // Agent mode: chart JSON of each chart query, in the order they ran
  conversationId: z.string(),
  messageId: z.string(),
  error: z.string().nullable(),
});
export type GenieResult = z.infer<typeof GenieResultSchema>;

// Library-neutral chart description. The UI's chart renderer (ui/src/charts) draws it with whichever library is enabled.
export const ChartSpecSchema = z.object({
  type: z.enum(['bar', 'line', 'scatter', 'area', 'pie', 'donut', 'funnel', 'waterfall', 'heatmap', 'treemap', 'sunburst', 'sankey']),
  title: z.string(),
  x: z.string(),                                    // field names, keys of each `data` row. For `path` charts, the first dimension
  y: z.string(),
  color: z.string().optional(),                     // series field (for a heatmap, the second dimension)
  path: z.array(z.string()).optional(),             // pie, donut, treemap, sunburst, sankey: the dimensions, outermost first
  xType: z.enum(['category', 'time', 'number']),    // time: ISO date strings, sorted ascending
  data: z.array(z.record(z.string(), z.unknown())), // y (and x for scatter) are numbers
});
export type ChartSpec = z.infer<typeof ChartSpecSchema>;

export const FinalAnswerSchema = z.object({
  answer: z.string(),
  columns: z.array(z.string()),
  rows: z.array(z.array(z.unknown())),
  totalRows: z.number(),                  // rows.length < totalRows => the UI is showing a preview
  charts: z.array(ChartSpecSchema),       // every chart of the turn, in the order they came back; empty => table only
  chartSpec: ChartSpecSchema.nullable(),  // @deprecated: the first of `charts` (null when none), for UIs that draw one chart
  sources: z.array(z.object({ spaceId: z.string(), spaceName: z.string(), question: z.string(), sql: z.string().nullable(), messageId: z.string(), conversationId: z.string() })),
  suggestedQuestions: z.array(z.string()),
  traceId: z.string().optional(),          // the request's trace id: quote it when reporting a problem; it finds every log line of the turn
});
export type FinalAnswer = z.infer<typeof FinalAnswerSchema>;

// One entry of the scratchpad the UI shows while the agents work (the same id updates the entry).
// note: the assistant's plan. tool: one data source being asked (label: its name, text: the question).
// progress: what that source is doing, under its tool entry: a short thought, a status, or a query (with a status).
export type TraceItem = {
  id: string;
  kind: 'meta' | 'note' | 'tool' | 'progress';
  text?: string;   // meta/note/progress: the line itself. tool: a short detail, for example the question that was sent
  label?: string;  // meta: what the value is. tool: what is being done
  by?: string;     // who is acting, when it is not the supervisor (a data agent's name)
  parent?: string; // progress: id of the tool entry it belongs to
  step?: 'thought' | 'status' | 'query'; // progress only: what kind of line it is
  status?: 'running' | 'done' | 'error'; // tool, and progress lines that run (queries, loading rows)
};

// What a Genie call reports while it runs. A query is reported again with the same id when it finishes.
export type GenieProgress =
  | { kind: 'status'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'query'; id: string; title?: string; status: 'running' | 'done' }; // title: sent when it starts

// SSE events streamed by POST /bi/chat. One JSON object per `data:` line.
export type ChatEvent =
  | { type: 'trace'; item: TraceItem }  // one entry of the agents' working notes; sending the same id again updates that entry
  | { type: 'text'; delta: string }      // the answer, streamed as it is written
  | { type: 'text-reset' }                 // the answer text streamed so far was a working note after all: clear it
  | { type: 'final'; result: FinalAnswer }
  | { type: 'suggestions'; questions: string[] }  // follow-ups, sent after `final` once the supervisor model has written them
  | { type: 'error'; message: string };

// Request bodies for POST /bi/chat and POST /bi/feedback. The routes reject anything that does not match (400).
export const ChatRequestSchema = z.object({
  threadId: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(4000), // a question, not a document: keeps the cost of one request bounded
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const FeedbackRequestSchema = z.object({
  spaceId: z.string().min(1),
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  rating: z.enum(['POSITIVE', 'NEGATIVE']),
});
export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;

// Who a Genie call is made for: the token provider turns this into the caller's Databricks token. Never logged.
export type GenieCaller = { userId: string; userToken?: string; sessionId?: string };
// What every Genie call accepts besides its own arguments. `sessionId` is the older form of `caller` and still works.
type CallOptions = { caller?: GenieCaller; /** @deprecated use caller */ sessionId?: string; signal?: AbortSignal };

// Genie client public API (server/src/core/genie/client.ts)
export interface GenieClient {
  ask(args: { spaceId: string; question: string; conversationId?: string; onProgress?: (event: GenieProgress) => void } & CallOptions): Promise<GenieResult>;
  feedback(args: FeedbackRequest & CallOptions): Promise<void>;
  // Loads the complete result of an earlier query (the ask() result only carries a capped preview). Agent mode only.
  fetchFullResult?(args: { statementId: string; cap: number } & CallOptions): Promise<{ columns: string[]; rows: unknown[][]; totalRows: number }>;
}
// Auth (server/src/adapters/local/auth/tokenProvider.ts)
/** @deprecated Use TokenProvider from ports/auth.ts, which receives the caller's BiRequestContext. Kept so older callers compile. */
export interface TokenProvider { getToken(ctx?: { sessionId?: string }): Promise<string> }
// One Genie space, from configuration (server/src/config/spaces.ts)
export type GenieSpace = {
  key: string;          // [a-z0-9_]+, used in agent and tool names
  name: string;
  description: string;  // what the space covers; shown to the supervisor and the follow-up writer
  routing?: string;     // when to route here; defaults to the description
  spaceId: string;
  enabled?: boolean;    // false leaves the space out of routing and prompts
};
