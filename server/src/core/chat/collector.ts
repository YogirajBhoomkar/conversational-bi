import type { RequestContext } from '@mastra/core/request-context';
import type { ChartSpec, GenieCaller, GenieResult } from '../../contracts';

// Per-request side channel: tools running inside sub-agents record structured data here so the chat turn
// can return rows/SQL/chart to the UI (the LLM only sees text). Stored by reference in Mastra's RequestContext.
// `charts` holds every chart of the turn: one question can need several, from one space or from several.
// `emit` sends one line of Genie's progress for a space to the client while the tool is still running.
export type Collector = { results: GenieResult[]; charts: ChartSpec[]; emit?: (progress: string, spaceKey: string) => void };

export const newCollector = (): Collector => ({ results: [], charts: [] });

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
