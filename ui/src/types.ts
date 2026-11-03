// Mirrors server/src/contracts.ts (keep in sync).
export type Source = { spaceId: string; spaceName: string; question: string; sql: string | null; messageId: string; conversationId: string };
export type ChartSpec = {
  type: 'bar' | 'line' | 'scatter';
  title: string;
  x: string;
  y: string;
  color?: string;
  xType: 'category' | 'time' | 'number';
  data: Record<string, unknown>[];
};
export type FinalAnswer = {
  answer: string;
  columns: string[];
  rows: unknown[][];
  totalRows: number;
  chartSpec: ChartSpec | null;
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
  status?: 'running' | 'done' | 'error';
};
export type ChatEvent =
  | { type: 'trace'; item: TraceItem }
  | { type: 'text'; delta: string }
  | { type: 'final'; result: FinalAnswer }
  | { type: 'suggestions'; questions: string[] }
  | { type: 'error'; message: string };

export type Message =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; text: string; trace: TraceItem[]; startedAt: number; endedAt?: number; suggestions?: string[]; result?: FinalAnswer; error?: string; pending: boolean };
