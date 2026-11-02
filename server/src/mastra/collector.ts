import type { RequestContext } from '@mastra/core/request-context';
import type { ChartSpec, ChatEvent, GenieResult } from '../contracts';

// Per-request side channel: tools running inside sub-agents record structured data here so the HTTP route
// can return rows/SQL/chart to the UI (the LLM only sees text). Stored by reference in RequestContext.
// `emit` pushes SSE events straight to the client (used to stream Genie's progress from inside the tool).
export type Collector = { results: GenieResult[]; chart: ChartSpec | null; emit?: (e: ChatEvent) => void };

export const newCollector = (): Collector => ({ results: [], chart: null });

export const getCollector = (rc: RequestContext<any> | undefined): Collector => {
  const c = rc?.get('collector') as Collector | undefined;
  if (!c) throw new Error('collector missing from request context');
  return c;
};

export const getThreadId = (rc: RequestContext<any> | undefined): string => (rc?.get('threadId') as string) ?? 'default';
