// Mirrors server/src/contracts.ts (keep in sync).
export type Source = { spaceId: string; spaceName: string; question: string; sql: string | null; messageId: string; conversationId: string };
export type ChartSpec = {
  type: 'bar' | 'line' | 'scatter' | 'area' | 'pie' | 'donut' | 'funnel' | 'waterfall' | 'heatmap' | 'treemap' | 'sunburst' | 'sankey';
  title: string;
  x: string;
  y: string;
  color?: string;
  path?: string[];
  xType: 'category' | 'time' | 'number';
  data: Record<string, unknown>[];
};
export type FinalAnswer = {
  answer: string;
  columns: string[];
  rows: unknown[][];
  totalRows: number;
  charts: ChartSpec[];
  chartSpec: ChartSpec | null; // deprecated: the first of `charts`
  sources: Source[];
  suggestedQuestions: string[];
};
export type TraceItem = {
  id: string;
  kind: 'meta' | 'note' | 'tool' | 'progress';
  text?: string;
  label?: string;
  by?: string;
  parent?: string;
  step?: 'thought' | 'status' | 'query';
  status?: 'running' | 'done' | 'error';
};
export type ChatEvent =
  | { type: 'trace'; item: TraceItem }
  | { type: 'text'; delta: string }
  | { type: 'text-reset' }
  | { type: 'final'; result: FinalAnswer }
  | { type: 'suggestions'; questions: string[] }
  | { type: 'error'; message: string };

export type Message =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; text: string; trace: TraceItem[]; startedAt: number; endedAt?: number; suggestions?: string[]; result?: FinalAnswer; error?: string; pending: boolean };
