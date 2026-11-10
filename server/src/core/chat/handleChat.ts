// One chat turn, as a stream of ChatEvents. No HTTP here: the edge (Mastra route, NestJS controller, a test) turns the
// events into SSE. The turn stops when ctx.signal aborts.
import type { Agent } from '@mastra/core/agent';
import { RequestContext } from '@mastra/core/request-context';
import type { ChatEvent, ChatRequest, FeedbackRequest, FinalAnswer, GenieClient } from '../../contracts';
import type { BiRequestContext } from '../../ports/context';
import type { BiLogger } from '../../ports/logger';
import type { HistorySettings } from '../../config/load';
import { log, requestLogger, withLogger } from '../log';
import { ValidationError, UpstreamError } from '../errors';
import { checkGrounding } from '../guards/grounding';
import type { SpaceRegistry } from '../genie/registry';
import { suggestFollowUps } from '../suggest/suggest';
import { createTracer, type TraceChunk } from '../trace/trace';
import { createUsageMeter, type UsageMeter, withMeter } from '../usage';
import { createOutputGuard, type OutputGuard } from '../guards/output';
import type { ScopeGuard } from '../guards/scope';
import { isContentFilterError } from '../guards/modelRefusal';
import { clarificationFromText } from './clarifyFromText';
import { failureEvent, failureKind } from './failure';
import { GENIE_LIMIT_MESSAGE } from '../genie/retry';
import { priorMessages, recentHistory } from './history';
import { isDataResult, newCollector, type TurnValues } from './collector';

export type ChatDeps = {
  supervisor: Pick<Agent, 'stream'>;
  suggestAgent: Pick<Agent, 'generate'>;
  registry: SpaceRegistry;
  modelLabel: string;
  suggestWaitMs: number; // after `final`, how long to wait for our own follow-ups
  genieMode: 'conversation' | 'agent'; // the Conversation API returns its own follow-ups; Agent mode returns none
  logger: BiLogger;      // the base logger; each turn logs through a child carrying its trace id
  grounding?: boolean; // log how many figures of the answer match nothing the data returned (core/guards/grounding.ts)
  turnTimeoutMs: number; // a turn running longer is stopped
  history: HistorySettings; // how much of the chat history sent by the UI is used
  outputGuard?: OutputGuard; // cleans what the model writes (core/guards/output.ts); none when absent
  scopeGuard?: ScopeGuard; // replaces a text-only Genie reply with the scope message (core/guards/scope.ts); none when absent
};

type StreamChunk = TraceChunk & { payload?: { error?: unknown }; error?: unknown };
const errorText = (chunk: StreamChunk) => {
  const e = (chunk.payload ?? chunk).error;
  const message = typeof e === 'object' && e !== null ? (e as { message?: unknown }).message : undefined;
  return String(message ?? e ?? 'agent error');
};

// Threads are per user, so one user can never continue another's chat.
// Agent names in the usage log, as in core/agents/createAgents.ts.
const SUPERVISOR = 'bi_supervisor';
const SUGGESTER = 'suggest_agent';

export const threadKey = (ctx: Pick<BiRequestContext, 'userId'>, threadId: string) => `${ctx.userId}::${threadId}`;

export async function* handleChat(deps: ChatDeps, ctx: BiRequestContext, request: ChatRequest): AsyncGenerator<ChatEvent> {
  const queue = eventQueue();
  // Everything the turn calls, however deep, logs with this request's trace id (see core/log.ts).
  // Its model and Genie use is counted the same way (see core/usage.ts).
  const usage = createUsageMeter();
  // Every line of the turn also carries the chat id the UI sent (not the per-user key), so one chat's turns are found together.
  void withLogger(requestLogger(deps.logger, ctx).child({ chatId: request.threadId }), () => withMeter(usage, () => runTurn(deps, ctx, request, queue.push, usage))).finally(queue.close);
  yield* queue.drain();
}


async function runTurn(deps: ChatDeps, requestCtx: BiRequestContext, { threadId: rawThread, message, history }: ChatRequest, send: (e: ChatEvent) => void, usage: UsageMeter) {
  // The turn stops when the caller goes away or it runs too long.
  const timeout = AbortSignal.timeout(deps.turnTimeoutMs);
  const ctx = { ...requestCtx, signal: AbortSignal.any([requestCtx.signal, timeout]) };
  const threadId = threadKey(ctx, rawThread);
  const started = Date.now();
  let firstAnswerMs: number | undefined;
  // The chat so far comes with the request (the server keeps no transcript), so any instance can answer a follow-up.
  // A turn we refused (off-topic, or the provider's filter) carries nothing a follow-up needs, and sending its question
  // again could get the next call filtered too, so it is left out.
  const refusals = new Set([filteredMessage(deps), REFUSED_MESSAGE]);
  const earlier = recentHistory(history?.filter((t) => !refusals.has(t.answer.trim())), deps.history);
  // Our follow-ups need only the space descriptions and the chat so far, and only a turn that got data has any: none for
  // a greeting, an out-of-scope reply, a question back or a failed turn. Agent mode never returns Genie's own, so there
  // they are started as soon as the first data comes back, in parallel with the answer. The Conversation API usually
  // does, so there ours are written only after `final`, when Genie sent none: a model call saved on most turns.
  let suggesting = false; // our follow-ups are still being written (their tokens are not counted yet)
  const writeSuggestions = () => {
    suggesting = true;
    return suggestFollowUps(deps.suggestAgent, deps.registry, { question: message, history: earlier.map((t) => ({ question: t.question, answer: t.answer, suggested: [] })) }).then((questions) => {
      suggesting = false;
      if (questions.length) send({ type: 'suggestions', questions }); // may arrive before or after `final`; the UI handles both
    });
  };
  let pendingSuggestions: Promise<void> | undefined;

  const collector = newCollector();
  const requestContext = new RequestContext<TurnValues>();
  requestContext.set('collector', collector);
  requestContext.set('threadId', threadId);
  requestContext.set('caller', () => ({ userId: ctx.userId, userToken: ctx.userToken, sessionId: ctx.sessionId }));
  requestContext.set('signal', ctx.signal);

  let answer = '';
  const guard = deps.outputGuard ?? createOutputGuard(false, deps.registry);
  const traceLeaks = new Map<string, number>();
  const tracer = createTracer(
    {
      trace: (item) => {
        if (!item.text) return send({ type: 'trace', item });
        const { text, leaks } = guard.text(item.text);
        traceLeaks.set(item.id, leaks); // an item is re-sent as it grows: count its latest text once
        send({ type: 'trace', item: { ...item, text } });
      },
      answer: (delta) => {
        firstAnswerMs ??= Date.now() - started;
        answer += delta;
        send({ type: 'text', delta });
      },
      retract: () => {
        answer = '';
        send({ type: 'text-reset' });
      },
    },
    deps.registry,
  );
  collector.emit = tracer.progress;
  send({ type: 'trace', item: { id: 'model', kind: 'meta', label: 'Using model', text: deps.modelLabel } });
  try {
    const stream = await deps.supervisor.stream([...priorMessages(earlier), { role: 'user' as const, content: message }], {
      requestContext,
      abortSignal: ctx.signal,
    });
    for await (const chunk of stream.fullStream as AsyncIterable<StreamChunk>) {
      if (chunk.type === 'tripwire') return refuse(chunk, Date.now() - started, usage, send);
      if (chunk.type === 'error') throw new Error(errorText(chunk), { cause: (chunk.payload ?? chunk).error });
      usage.observe(chunk);
      tracer.handle(chunk);
      if (deps.genieMode === 'agent' && !pendingSuggestions && collector.results.some(isDataResult)) pendingSuggestions = writeSuggestions();
    }
    tracer.end();
    // Every Genie call failed: there is no data to answer from, so the user gets the calm notice instead of whatever the
    // model wrote about it. A used-up Databricks limit says so (asking again will not help until an admin raises it);
    // anything else (no network, Genie down, a failed query) offers to try again.
    if (collector.results.length && !collector.clarification && collector.results.every((r) => r.error)) {
      const kind = collector.results.every((r) => r.error === GENIE_LIMIT_MESSAGE) ? 'limit' : 'source';
      usage.add(SUPERVISOR, await Promise.resolve(stream.totalUsage).catch(() => undefined));
      log().warn(kind === 'limit' ? 'chat.limit' : 'chat.no_data', { durationMs: Date.now() - started, genieCalls: collector.results.length, ...usage.snapshot() });
      send({ type: 'text-reset' });
      return send(failureEvent(kind, ctx.traceId, deps.turnTimeoutMs));
    }
    // The model sometimes writes its question back as text instead of using the tool; when no data was fetched and the
    // text is just a question with a few choices, it is shown as choices anyway. Not for a message of one or two words
    // ("hi", "thanks"): a reply to that offering topics is a greeting, not a question about the user's question.
    if (!collector.clarification && !collector.results.length && message.trim().split(/\s+/).length >= 3) {
      const fromText = clarificationFromText(answer);
      if (fromText) {
        collector.clarification = fromText;
        answer = '';
        send({ type: 'text-reset' });
      }
    }
    // What streamed is shown before the server can check it; a corrected answer replaces it (text-reset, then the text).
    const guarded = guard.answer(answer, collector.results, collector.clarification);
    if (guarded.text !== answer) {
      answer = guarded.text;
      send({ type: 'text-reset' });
      if (answer) send({ type: 'text', delta: answer });
    }
    const leaks = guarded.leaks + [...traceLeaks.values()].reduce((n, c) => n + c, 0);
    if (leaks) log().warn('guard.output.leak', { count: leaks });
    // Genie answered with text only (a joke, general knowledge): not a data answer, so the user gets the scope message
    // and nothing of that reply (no table, charts, sources or follow-ups). After the output guard, so its no-data
    // message cannot replace the scope message.
    const outOfScope = deps.scopeGuard?.check(collector.results, collector.clarification) === 'replace';
    if (outOfScope) {
      answer = deps.scopeGuard!.message;
      send({ type: 'text-reset' });
      send({ type: 'text', delta: answer });
    }
    const results = outOfScope ? [] : collector.results; // what the user is shown; the log still counts every call
    const charts = outOfScope ? [] : collector.charts;
    const withData = [...results].reverse().find((r) => r.columns.length);
    const gotData = results.some(isDataResult);
    // Loading the full result re-uses an earlier message, so keep one source per message (the latest).
    const sources = [...new Map(results.map((r) => [r.messageId, r])).values()];
    const final: FinalAnswer = {
      answer,
      columns: withData?.columns ?? [],
      rows: withData?.rows ?? [],
      totalRows: withData?.totalRows ?? 0,
      charts,
      chartSpec: charts[0] ?? null,
      sources: sources.map((r) => ({
        spaceId: r.spaceId,
        spaceName: deps.registry.byId(r.spaceId)?.name ?? r.spaceId,
        question: r.question,
        sql: r.sql,
        messageId: r.messageId,
        conversationId: r.conversationId,
      })),
      // Genie's own follow-ups only for a data answer: a text-only reply's would build on the off-topic answer.
      suggestedQuestions: [...results].reverse().find((r) => isDataResult(r) && r.suggestedQuestions.length)?.suggestedQuestions ?? [],
      ...(collector.clarification ? { clarification: collector.clarification } : {}),
      traceId: ctx.traceId,
    };
    send({ type: 'final', result: final });
    const durationMs = Date.now() - started;
    // The supervisor's own model use (its sub-agents' is counted from the stream); absent when the model does not report it.
    const own = await Promise.resolve(stream.totalUsage).catch(() => undefined);
    usage.add(SUPERVISOR, own);
    // Genie's own follow-ups win. Otherwise wait a short moment for ours, never long. A question back to the user
    // needs none (the UI shows its choices instead), and a turn without data has nothing to follow up on.
    if (gotData && !final.clarification && !final.suggestedQuestions.length) {
      pendingSuggestions ??= writeSuggestions();
      await waitAtMost(pendingSuggestions, deps.suggestWaitMs);
    }
    if (suggesting) usage.unreported(SUGGESTER);
    log().info('chat.turn', {
      durationMs, firstAnswerMs, genieCalls: collector.results.length, failedCalls: collector.results.filter((r) => r.error).length,
      charts: charts.length, rows: final.totalRows, ...(outOfScope ? { outOfScope } : {}), inputTokens: own?.inputTokens, outputTokens: own?.outputTokens, ...usage.snapshot(),
      ...(deps.grounding ? { grounding: groundingOf(answer, collector.results, message, earlier) } : {}),
    });
  } catch (err) {
    if (requestCtx.signal.aborted) return log().info('chat.cancelled', { durationMs: Date.now() - started, ...usage.snapshot() }); // nobody is listening
    usage.unreported(SUPERVISOR); // a failed stream reports no total
    if (isContentFilterError(err)) return declineFiltered(deps, ctx.traceId, Date.now() - started, usage, send);
    // What the user is told depends on the kind of failure (core/chat/failure.ts); the details are in the log.
    const kind = failureKind(err, timeout.aborted);
    log().error(timeout.aborted ? 'chat.timeout' : 'chat.failed', { durationMs: Date.now() - started, kind, error: err, ...usage.snapshot() });
    send(failureEvent(kind, ctx.traceId, deps.turnTimeoutMs));
  }
}

// An input guard stopped the turn (core/guards/input.ts). The user gets a fixed message; the log gets which guard and
// why, never the question.
export const REFUSED_MESSAGE = "I can't help with that request. Please rephrase your question about the data.";
function refuse(chunk: StreamChunk, durationMs: number, usage: UsageMeter, send: (e: ChatEvent) => void) {
  const { processorId, reason } = (chunk.payload ?? {}) as { processorId?: string; reason?: unknown };
  usage.unreported(SUPERVISOR); // a stopped stream reports no total
  log().warn('guard.input.blocked', { processorId, reason: String(reason ?? '').slice(0, 300), durationMs, ...usage.snapshot() });
  send({ type: 'error', message: REFUSED_MESSAGE });
}

// The model provider's safety filter refused the call (core/guards/modelRefusal.ts): the user gets the scope message as
// an ordinary answer, with nothing of what may have streamed before; the log gets a warning, never the question.
const filteredMessage = (deps: ChatDeps) => deps.scopeGuard?.message ?? REFUSED_MESSAGE;
function declineFiltered(deps: ChatDeps, traceId: string, durationMs: number, usage: UsageMeter, send: (e: ChatEvent) => void) {
  log().warn('guard.model.filtered', { durationMs, ...usage.snapshot() });
  const answer = filteredMessage(deps);
  send({ type: 'text-reset' });
  send({ type: 'text', delta: answer });
  send({ type: 'final', result: { answer, columns: [], rows: [], totalRows: 0, charts: [], chartSpec: null, sources: [], suggestedQuestions: [], traceId } });
}

async function waitAtMost(work: Promise<unknown>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([work, new Promise((resolve) => (timer = setTimeout(resolve, ms)))]);
  clearTimeout(timer);
}

// Counts only. The ungrounded values go in `content`, which the logger drops unless BI_LOG_CONTENT is on.
// A failing check is logged as such: it must never cost the user the answer.
function groundingOf(...args: Parameters<typeof checkGrounding>) {
  try {
    const { checked, ungrounded, values } = checkGrounding(...args);
    return { checked, ungrounded, content: values };
  } catch (error) {
    log().warn('grounding.failed', { error });
    return { failed: true };
  }
}

export type FeedbackDeps = { genie: GenieClient; registry: SpaceRegistry; logger: BiLogger };

// Passes a rating on to Genie. Throws ValidationError for an unknown space, UpstreamError when Genie refuses.
export async function handleFeedback(deps: FeedbackDeps, ctx: BiRequestContext, request: FeedbackRequest): Promise<void> {
  if (!deps.registry.byId(request.spaceId)) throw new ValidationError('unknown space');
  const logger = requestLogger(deps.logger, ctx);
  try {
    await withLogger(logger, () => deps.genie.feedback({ ...request, caller: { userId: ctx.userId, userToken: ctx.userToken, sessionId: ctx.sessionId }, signal: ctx.signal }));
    logger.info('feedback', { spaceId: request.spaceId, rating: request.rating });
  } catch (e) {
    logger.warn('feedback.failed', { spaceId: request.spaceId, error: e });
    throw new UpstreamError(e instanceof Error ? e.message : String(e));
  }
}

// Events produced by callbacks (tracer, tool progress, follow-ups) are queued and handed out in order.
// After `close`, further pushes are dropped, as the stream has ended.
function eventQueue() {
  const items: ChatEvent[] = [];
  let closed = false;
  let wake: (() => void) | undefined;
  const notify = () => {
    wake?.();
    wake = undefined;
  };
  return {
    push(e: ChatEvent) {
      if (closed) return;
      items.push(e);
      notify();
    },
    close() {
      closed = true;
      notify();
    },
    async *drain(): AsyncGenerator<ChatEvent> {
      for (;;) {
        while (items.length) yield items.shift()!;
        if (closed) return;
        await new Promise<void>((resolve) => (wake = resolve));
      }
    },
  };
}
