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
  chartSpec: ChartSpecSchema.nullable(),  // null => UI shows table only
  sources: z.array(z.object({ spaceId: z.string(), spaceName: z.string(), question: z.string(), sql: z.string().nullable(), messageId: z.string(), conversationId: z.string() })),
  suggestedQuestions: z.array(z.string()),
});
export type FinalAnswer = z.infer<typeof FinalAnswerSchema>;

// One entry of the scratchpad the UI shows while the agents work (the same id updates the entry).
export type TraceItem = {
  id: string;
  kind: 'meta' | 'note' | 'tool' | 'progress';
  text?: string;   // meta/note/progress: the line itself. tool: a short detail, for example the question that was sent
  label?: string;  // meta: what the value is. tool: what is being done
  by?: string;     // who is acting, when it is not the supervisor (a data agent's name)
  parent?: string; // progress: id of the tool entry it belongs to
  status?: 'running' | 'done' | 'error'; // tool only
};

// SSE events streamed by POST /bi/chat. One JSON object per `data:` line.
export type ChatEvent =
  | { type: 'trace'; item: TraceItem }  // one entry of the agents' working notes; sending the same id again updates that entry
  | { type: 'text'; delta: string }
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

// Genie client public API (server/src/genie/client.ts)
export interface GenieClient {
  ask(args: { spaceId: string; question: string; conversationId?: string; sessionId?: string; onProgress?: (line: string) => void }): Promise<GenieResult>;
  feedback(args: FeedbackRequest & { sessionId?: string }): Promise<void>;
  // Loads the complete result of an earlier query (the ask() result only carries a capped preview). Agent mode only.
  fetchFullResult?(args: { statementId: string; cap: number; sessionId?: string }): Promise<{ columns: string[]; rows: unknown[][]; totalRows: number }>;
}
// Auth (server/src/auth/tokenProvider.ts)
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
