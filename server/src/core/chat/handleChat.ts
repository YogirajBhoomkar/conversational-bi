// One chat turn, as a stream of ChatEvents. No HTTP here: the edge (Mastra route, NestJS controller, a test) turns the
// events into SSE. The turn stops when ctx.signal aborts.
import type { Agent } from '@mastra/core/agent';
import { RequestContext } from '@mastra/core/request-context';
import type { ChatEvent, ChatRequest, FeedbackRequest, FinalAnswer, GenieClient } from '../../contracts';
import type { BiRequestContext } from '../../ports/context';
import type { BiLogger } from '../../ports/logger';
import { log, requestLogger, withLogger } from '../log';
import { ValidationError, UpstreamError } from '../errors';
import type { SpaceRegistry } from '../genie/registry';
import { recentTurns, recordTurn } from '../suggest/history';
import { suggestFollowUps } from '../suggest/suggest';
import { createTracer, type TraceChunk } from '../trace/trace';
import { clarificationFromText } from './clarifyFromText';
import { newCollector, type TurnValues } from './collector';

export type ChatDeps = {
  supervisor: Pick<Agent, 'stream'>;
  suggestAgent: Pick<Agent, 'generate'>;
  registry: SpaceRegistry;
  modelLabel: string;
  suggestWaitMs: number; // after `final`, how long to wait for our own follow-ups
  logger: BiLogger;      // the base logger; each turn logs through a child carrying its trace id
  turnTimeoutMs: number; // a turn running longer is stopped
};

type StreamChunk = TraceChunk & { payload?: { error?: unknown }; error?: unknown };
const errorText = (chunk: StreamChunk) => {
  const e = (chunk.payload ?? chunk).error;
  const message = typeof e === 'object' && e !== null ? (e as { message?: unknown }).message : undefined;
  return String(message ?? e ?? 'agent error');
};

// Threads are per user, so one user can never continue another's chat.
export const threadKey = (ctx: Pick<BiRequestContext, 'userId'>, threadId: string) => `${ctx.userId}::${threadId}`;

export async function* handleChat(deps: ChatDeps, ctx: BiRequestContext, request: ChatRequest): AsyncGenerator<ChatEvent> {
  const queue = eventQueue();
  // Everything the turn calls, however deep, logs with this request's trace id (see core/log.ts).
  void withLogger(requestLogger(deps.logger, ctx), () => runTurn(deps, ctx, request, queue.push)).finally(queue.close);
  yield* queue.drain();
}

// What the user is told when a turn fails. The details are in the log, found by the trace id.
const failureMessage = (timedOut: boolean, deps: ChatDeps, traceId: string) =>
  timedOut
    ? `This question took longer than ${Math.round(deps.turnTimeoutMs / 60_000)} minutes and was stopped. Try asking for less at once.`
    : `Something went wrong while answering. If it happens again, quote reference ${traceId}.`;

async function runTurn(deps: ChatDeps, requestCtx: BiRequestContext, { threadId: rawThread, message }: ChatRequest, send: (e: ChatEvent) => void) {
  // The turn stops when the caller goes away or it runs too long.
  const timeout = AbortSignal.timeout(deps.turnTimeoutMs);
  const ctx = { ...requestCtx, signal: AbortSignal.any([requestCtx.signal, timeout]) };
  const threadId = threadKey(ctx, rawThread);
  const started = Date.now();
  let firstAnswerMs: number | undefined;
  // Follow-ups need only the space descriptions and the chat so far, so they are written in parallel with the answer.
  const pendingSuggestions = suggestFollowUps(deps.suggestAgent, deps.registry, { question: message, history: recentTurns(threadId) });

  const collector = newCollector();
  const requestContext = new RequestContext<TurnValues>();
  requestContext.set('collector', collector);
  requestContext.set('threadId', threadId);
  requestContext.set('caller', () => ({ userId: ctx.userId, userToken: ctx.userToken, sessionId: ctx.sessionId }));
  requestContext.set('signal', ctx.signal);

  let answer = '';
  const tracer = createTracer(
    {
      trace: (item) => send({ type: 'trace', item }),
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
  let ours: string[] = [];
  void pendingSuggestions.then((questions) => {
    ours = questions;
    if (questions.length) send({ type: 'suggestions', questions }); // may arrive before or after `final`; the UI handles both
  });
  try {
    const stream = await deps.supervisor.stream(message, {
      requestContext,
      memory: { thread: threadId, resource: ctx.userId },
      abortSignal: ctx.signal,
    });
    for await (const chunk of stream.fullStream as AsyncIterable<StreamChunk>) {
      if (chunk.type === 'error') throw new Error(errorText(chunk));
      tracer.handle(chunk);
    }
    tracer.end();
    // The model sometimes writes its question back as text instead of using the tool; when no data was fetched and the
    // text is just a question with a few choices, it is shown as choices anyway.
    if (!collector.clarification && !collector.results.length) {
      const fromText = clarificationFromText(answer);
      if (fromText) {
        collector.clarification = fromText;
        answer = '';
        send({ type: 'text-reset' });
      }
    }
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
    // The supervisor's own model use (the data agents' is not included); absent when the model does not report it.
    const usage = await Promise.resolve(stream.totalUsage).catch(() => undefined);
    log().info('chat.turn', {
      durationMs: Date.now() - started, firstAnswerMs, genieCalls: collector.results.length, failedCalls: collector.results.filter((r) => r.error).length,
      charts: collector.charts.length, rows: final.totalRows, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens,
    });
    // Genie's own follow-ups win. Otherwise ours are usually ready already; give them a short moment, never long.
    if (!final.suggestedQuestions.length) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([pendingSuggestions, new Promise((resolve) => (timer = setTimeout(resolve, deps.suggestWaitMs)))]);
      clearTimeout(timer);
    }
    recordTurn(threadId, { question: message, answer, suggested: final.suggestedQuestions.length ? final.suggestedQuestions : ours });
  } catch (err) {
    if (requestCtx.signal.aborted) return log().info('chat.cancelled', { durationMs: Date.now() - started }); // nobody is listening
    log().error(timeout.aborted ? 'chat.timeout' : 'chat.failed', { durationMs: Date.now() - started, error: err });
    send({ type: 'error', message: failureMessage(timeout.aborted, deps, ctx.traceId) });
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
