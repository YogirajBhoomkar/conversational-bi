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
import { clarificationFromText } from './clarifyFromText';
import { priorMessages, recentHistory } from './history';
import { newCollector, type TurnValues } from './collector';

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
  void withLogger(requestLogger(deps.logger, ctx), () => withMeter(usage, () => runTurn(deps, ctx, request, queue.push, usage))).finally(queue.close);
  yield* queue.drain();
}

// What the user is told when a turn fails. The details are in the log, found by the trace id.
const failureMessage = (timedOut: boolean, deps: ChatDeps, traceId: string) =>
  timedOut
    ? `This question took longer than ${Math.round(deps.turnTimeoutMs / 60_000)} minutes and was stopped. Try asking for less at once.`
    : `Something went wrong while answering. If it happens again, quote reference ${traceId}.`;

async function runTurn(deps: ChatDeps, requestCtx: BiRequestContext, { threadId: rawThread, message, history }: ChatRequest, send: (e: ChatEvent) => void, usage: UsageMeter) {
  // The turn stops when the caller goes away or it runs too long.
  const timeout = AbortSignal.timeout(deps.turnTimeoutMs);
  const ctx = { ...requestCtx, signal: AbortSignal.any([requestCtx.signal, timeout]) };
  const threadId = threadKey(ctx, rawThread);
  const started = Date.now();
  let firstAnswerMs: number | undefined;
  // The chat so far comes with the request (the server keeps no transcript), so any instance can answer a follow-up.
  const earlier = recentHistory(history, deps.history);
  // Our follow-ups need only the space descriptions and the chat so far. Agent mode never returns Genie's own, so there
  // they are written in parallel with the answer. The Conversation API usually does, so there ours are written only
  // after `final`, when Genie sent none: a model call saved on most turns, for a short wait on the others.
  let suggesting = false; // our follow-ups are still being written (their tokens are not counted yet)
  const writeSuggestions = () => {
    suggesting = true;
    return suggestFollowUps(deps.suggestAgent, deps.registry, { question: message, history: earlier.map((t) => ({ question: t.question, answer: t.answer, suggested: [] })) }).then((questions) => {
      suggesting = false;
      if (questions.length) send({ type: 'suggestions', questions }); // may arrive before or after `final`; the UI handles both
    });
  };
  let pendingSuggestions = deps.genieMode === 'agent' ? writeSuggestions() : undefined;

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
      if (chunk.type === 'error') throw new Error(errorText(chunk));
      usage.observe(chunk);
      tracer.handle(chunk);
    }
    tracer.end();
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
    const withData = [...collector.results].reverse().find((r) => r.columns.length);
    // Loading the full result re-uses an earlier message, so keep one source per message (the latest).
    const sources = [...new Map(collector.results.map((r) => [r.messageId, r])).values()];
    const final: FinalAnswer = {
      answer,
      columns: withData?.columns ?? [],
      rows: withData?.rows ?? [],
      totalRows: withData?.totalRows ?? 0,
      charts: collector.charts,
      chartSpec: collector.charts[0] ?? null,
      sources: sources.map((r) => ({
        spaceId: r.spaceId,
        spaceName: deps.registry.byId(r.spaceId)?.name ?? r.spaceId,
        question: r.question,
        sql: r.sql,
        messageId: r.messageId,
        conversationId: r.conversationId,
      })),
      suggestedQuestions: [...collector.results].reverse().find((r) => r.suggestedQuestions.length)?.suggestedQuestions ?? [],
      ...(collector.clarification ? { clarification: collector.clarification } : {}),
      traceId: ctx.traceId,
    };
    send({ type: 'final', result: final });
    const durationMs = Date.now() - started;
    // The supervisor's own model use (its sub-agents' is counted from the stream); absent when the model does not report it.
    const own = await Promise.resolve(stream.totalUsage).catch(() => undefined);
    usage.add(SUPERVISOR, own);
    // Genie's own follow-ups win. Otherwise wait a short moment for ours, never long. A question back to the user
    // needs none (the UI shows its choices instead), so none are started for it.
    if (!final.suggestedQuestions.length) {
      pendingSuggestions ??= final.clarification ? undefined : writeSuggestions();
      if (pendingSuggestions) await waitAtMost(pendingSuggestions, deps.suggestWaitMs);
    }
    if (suggesting) usage.unreported(SUGGESTER);
    log().info('chat.turn', {
      durationMs, firstAnswerMs, genieCalls: collector.results.length, failedCalls: collector.results.filter((r) => r.error).length,
      charts: collector.charts.length, rows: final.totalRows, inputTokens: own?.inputTokens, outputTokens: own?.outputTokens, ...usage.snapshot(),
      ...(deps.grounding ? { grounding: groundingOf(answer, collector.results, message, earlier) } : {}),
    });
  } catch (err) {
    if (requestCtx.signal.aborted) return log().info('chat.cancelled', { durationMs: Date.now() - started, ...usage.snapshot() }); // nobody is listening
    usage.unreported(SUPERVISOR); // a failed stream reports no total
    log().error(timeout.aborted ? 'chat.timeout' : 'chat.failed', { durationMs: Date.now() - started, error: err, ...usage.snapshot() });
    send({ type: 'error', message: failureMessage(timeout.aborted, deps, ctx.traceId) });
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
