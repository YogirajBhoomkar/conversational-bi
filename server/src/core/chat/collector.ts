import type { RequestContext } from '@mastra/core/request-context';
import type { ChartSpec, GenieCaller, GenieResult } from '../../contracts';

// Per-request side channel: tools running inside sub-agents record structured data here so the chat turn
// can return rows/SQL/chart to the UI (the LLM only sees text). Stored by reference in Mastra's RequestContext.
// `chart` remembers which space drew it, so an answer from another space in the same turn does not erase it.
// `emit` sends one line of Genie's progress to the client while the tool is still running.
export type Collector = { results: GenieResult[]; chart: { spaceId: string; spec: ChartSpec } | null; emit?: (progress: string) => void };

export const newCollector = (): Collector => ({ results: [], chart: null });

// What a turn puts in the RequestContext for its tools. `caller` is a function so the identity token inside it
// is never serialised if Mastra stores or traces the context.
export type TurnValues = { collector: Collector; threadId: string; caller: () => GenieCaller; signal: AbortSignal };

type AnyRequestContext = Pick<RequestContext, 'get'> | undefined;

const need = <K extends keyof TurnValues>(rc: AnyRequestContext, key: K): TurnValues[K] => {
  const value = rc?.get(key) as TurnValues[K] | undefined;
  if (value === undefined) throw new Error(`${key} missing from request context`);
  return value;
};

export const getCollector = (rc: AnyRequestContext) => need(rc, 'collector');
export const getThreadId = (rc: AnyRequestContext) => need(rc, 'threadId');
export const getCaller = (rc: AnyRequestContext) => need(rc, 'caller')();
export const getSignal = (rc: AnyRequestContext) => need(rc, 'signal');
