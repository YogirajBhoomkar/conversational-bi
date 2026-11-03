import type { RequestContext } from '@mastra/core/request-context';
import type { ChartSpec, GenieResult } from '../contracts';

// Per-request side channel: tools running inside sub-agents record structured data here so the HTTP route
// can return rows/SQL/chart to the UI (the LLM only sees text). Stored by reference in RequestContext.
// `emit` sends one line of Genie's progress to the client while the tool is still running.
export type Collector = { results: GenieResult[]; chart: ChartSpec | null; emit?: (progress: string) => void };

export const newCollector = (): Collector => ({ results: [], chart: null });

export const getCollector = (rc: RequestContext<any> | undefined): Collector => {
  const c = rc?.get('collector') as Collector | undefined;
  if (!c) throw new Error('collector missing from request context');
  return c;
};

export const getThreadId = (rc: RequestContext<any> | undefined): string => (rc?.get('threadId') as string) ?? 'default';
