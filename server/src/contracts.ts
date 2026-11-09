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

// A question back to the user when theirs is ambiguous: the likely answers to pick from. The user may also type
// their own answer instead (the UI offers that as the last option).
export const ClarificationSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.string().min(1)).min(2).max(4),
});
export type Clarification = z.infer<typeof ClarificationSchema>;

export const FinalAnswerSchema = z.object({
  answer: z.string(),
  columns: z.array(z.string()),
  rows: z.array(z.array(z.unknown())),
  totalRows: z.number(),                  // rows.length < totalRows => the UI is showing a preview
  charts: z.array(ChartSpecSchema),       // every chart of the turn, in the order they came back; empty => table only
  chartSpec: ChartSpecSchema.nullable(),  // @deprecated: the first of `charts` (null when none), for UIs that draw one chart
  sources: z.array(z.object({ spaceId: z.string(), spaceName: z.string(), question: z.string(), sql: z.string().nullable(), messageId: z.string(), conversationId: z.string() })),
  suggestedQuestions: z.array(z.string()),
  clarification: ClarificationSchema.optional(), // set when the assistant needs the user to choose before it can answer
  traceId: z.string().optional(),          // the request's trace id: quote it when reporting a problem; it finds every log line of the turn
});
export type FinalAnswer = z.infer<typeof FinalAnswerSchema>;

// One entry of the scratchpad the UI shows while the agents work (the same id updates the entry).
// note: the assistant's plan. tool: one data source being asked (label: its name, text: the question).
// progress: what that source is doing, under its tool entry: a thought, a status, or a query (with a status).
export const TraceItemSchema = z.object({
  id: z.string().describe('Sending the same id again updates the entry'),
  kind: z.enum(['meta', 'note', 'tool', 'progress']),
  text: z.string().optional().describe('meta/note/progress: the line itself. tool: the question sent to the data source. An empty note has become the answer'),
  label: z.string().optional().describe('meta: what the value is. tool: the data source name'),
  by: z.string().optional().describe('Who is acting, when it is not the assistant'),
  parent: z.string().optional().describe('progress: id of the tool entry it belongs to'),
  step: z.enum(['thought', 'status', 'query']).optional().describe('progress only: what kind of line it is'),
  status: z.enum(['running', 'done', 'error']).optional().describe('tool entries, and progress lines that run (queries, loading rows)'),
});
export type TraceItem = z.infer<typeof TraceItemSchema>;

// What a Genie call reports while it runs. A query is reported again with the same id when it finishes. Internal.
export type GenieProgress =
  | { kind: 'status'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'query'; id: string; title?: string; status: 'running' | 'done' }; // title: sent when it starts

// The turn failed. `message` is the whole text for the user (with the reference, except for a timeout or a refusal).
// Since 1.3.0 the parts come separately too, so a UI can show a friendly notice: `kind`, a short `title`, the `detail`
// text, whether trying again may help, and the `reference` (the trace id) to quote.
function ChatErrorEventSchema() {
  return z.object({
    type: z.literal('error'),
    message: z.string(),
    kind: z.enum(['unavailable', 'busy', 'timeout', 'failed', 'refused', 'limit', 'source']).optional(),
    title: z.string().optional(),
    detail: z.string().optional(),
    retryable: z.boolean().optional(),
    reference: z.string().optional(),
  }).describe('The turn failed; the message is for the user and holds a reference');
}
export type ChatErrorEvent = Required<z.infer<ReturnType<typeof ChatErrorEventSchema>>>;

// SSE events streamed by POST /bi/chat. One JSON object per `data:` line.
export const ChatEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('trace'), item: TraceItemSchema }).describe('One scratchpad entry; the same id again updates it'),
  z.object({ type: z.literal('text'), delta: z.string() }).describe('The answer, streamed as it is written (Markdown)'),
  z.object({ type: z.literal('text-reset') }).describe('The answer text streamed so far was a working note after all: clear it'),
  z.object({ type: z.literal('final'), result: FinalAnswerSchema }).describe('The complete answer with table, charts and sources. Ends the answer'),
  z.object({ type: z.literal('suggestions'), questions: z.array(z.string()) }).describe('Follow-up questions; may arrive before or after final'),
  ChatErrorEventSchema(),
]);
export type ChatEvent = z.infer<typeof ChatEventSchema>;

// The version of this contract (requests, events, answer). Changes that remove or rename a field raise the major version.
export const CONTRACT_VERSION = '1.3.0';

// Request bodies for POST /bi/chat and POST /bi/feedback. The routes reject anything that does not match (400).
// One earlier turn of the chat, sent by the UI so a follow-up ("and by region?") works on any instance with no server
// memory. It is untrusted text: the server caps it again, and the model is told it is context, never instructions.
export const HistoryTurnSchema = z.object({
  question: z.string().min(1).max(4000),
  answer: z.string().max(20_000),
  space: z.string().max(100).optional(), // the data source that answered, when there was one
  sql: z.string().max(20_000).optional(), // used only when the server allows it (BI_HISTORY_INCLUDE_SQL)
});
export type HistoryTurn = z.infer<typeof HistoryTurnSchema>;

export const ChatRequestSchema = z.object({
  threadId: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(4000), // a question, not a document: keeps the cost of one request bounded
  history: z.array(HistoryTurnSchema).max(10).optional(), // earlier turns, oldest first; the server uses the latest few
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
  examples?: string[];  // example questions this space answers, shown to users (the scope message)
  spaceId: string;
  enabled?: boolean;    // false leaves the space out of routing and prompts
};
