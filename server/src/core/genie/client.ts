import type { GenieCaller, GenieClient, GenieResult } from '../../contracts';
import { log } from '../log';
import type { TokenProvider } from '../../ports/auth';
import { type GenieLimiter, limitedFetch, noLimit, WAITING_NOTE } from './limiter';
import { fetchWithRetry, GENIE_LIMIT_MESSAGE, GenieRunFailed, LIMIT_REACHED, type RetryPolicy, withRetry } from './retry';

export type GenieClientOptions = {
  host: string;           // workspace host, without https://
  rowCap: number;         // rows kept per result
  timeoutMs: number;      // how long one question may take
  retry: RetryPolicy;
  fetch?: typeof fetch;
  pollDelaysMs?: number[]; // Conversation API only: waits between status polls
  limiter?: GenieLimiter;  // paces the POSTs that start a question (never polling or feedback); none by default
};

type Attachment = {
  attachment_id?: string;
  text?: { content?: string };
  query?: { query?: string; description?: string; thoughts?: Array<string | { thought_type?: string; content?: string }> };
  suggested_questions?: { questions?: string[] };
};
type Started = { conversation_id?: string; message_id?: string; id?: string };
type StatementResponse = {
  manifest?: { schema?: { columns?: Array<{ name: string }> }; total_row_count?: number };
  result?: { data_array?: unknown[][] };
};
type Message = {
  id?: string;
  message_id?: string;
  conversation_id?: string;
  status: string;
  attachments?: Attachment[];
  error?: { error?: string; type?: string };
};

const STATUS_LABELS: Record<string, string> = {
  FETCHING_METADATA: 'Fetching metadata…',
  FILTERING_CONTEXT: 'Filtering relevant context…',
  ASKING_AI: 'Working out the answer…',
  PENDING_WAREHOUSE: 'Waiting for the SQL warehouse…',
  EXECUTING_QUERY: 'Running the query…',
  COMPLETED: 'Done',
};

const thoughtsOf = (att?: Attachment): string[] =>
  (att?.query?.thoughts ?? []).map((t) => (typeof t === 'string' ? t : t.content ?? '')).filter(Boolean);

export type AskArgs = Parameters<GenieClient['ask']>[0];
export type FeedbackArgs = Parameters<GenieClient['feedback']>[0];
// Who the call is for, and when to stop: shared by every request a client makes.
export type CallScope = { caller: GenieCaller; signal?: AbortSignal };
export const scopeOf = (a: { caller?: GenieCaller; sessionId?: string; signal?: AbortSignal }): CallScope => ({
  caller: a.caller ?? { userId: '', sessionId: a.sessionId },
  signal: a.signal,
});

// Waits between polls; stops early, with the abort reason, when the caller has gone.
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const stop = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop);
      resolve();
    }, ms);
    signal?.addEventListener('abort', stop, { once: true });
  });
// The Genie conversation and message of the current question, kept across attempts so a retry continues the same conversation.
export type Run = { conversationId: string; messageId: string };

export const RETRY_NOTE = 'Genie could not answer that, trying again…';
export const isRetryableRun = (error: unknown) => error instanceof GenieRunFailed && error.retryable;

// A question that could not be answered. The error goes back to the agent as text instead of failing the whole request.
// A used-up limit is told in our words; Databricks' own text stays in the log.
export const failedResult = ({ spaceId, question }: AskArgs, run: Run, error: unknown): GenieResult => {
  const text = error instanceof Error ? error.message : String(error);
  const limit = LIMIT_REACHED.test(text);
  if (limit) log().warn('genie.budget_exhausted', { error: text.slice(0, 200) });
  return {
    spaceId, question, summary: '', sql: null, columns: [], rows: [], totalRows: 0, thinking: [], suggestedQuestions: [], statementId: null,
    conversationId: run.conversationId, messageId: run.messageId, error: limit ? GENIE_LIMIT_MESSAGE : text,
  };
};

export class DatabricksGenieClient implements GenieClient {
  private readonly base: string;
  private readonly fetchFn: typeof fetch;
  private readonly pollDelaysMs: number[];
  private readonly retry: RetryPolicy;
  private readonly limiter: GenieLimiter;
  constructor(private readonly tokens: TokenProvider, private readonly options: GenieClientOptions) {
    this.limiter = options.limiter ?? noLimit;
    this.base = `https://${options.host}/api/2.0/genie/spaces`;
    this.fetchFn = options.fetch ?? fetch;
    this.pollDelaysMs = options.pollDelaysMs ?? [1000, 1500, 2000, 3000, 5000];
    this.retry = options.retry;
  }

  private async call<T>(scope: CallScope, method: string, path: string, body?: unknown, fetchFn = this.fetchFn): Promise<T> {
    const res = await fetchWithRetry(
      fetchFn,
      `${this.base}${path}`,
      {
        method,
        headers: { Authorization: `Bearer ${await this.tokens.getToken(scope.caller)}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: scope.signal,
      },
      this.retry,
    );
    if (!res.ok) throw new Error(`Genie ${method} ${path} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  async ask(args: AskArgs): Promise<GenieResult> {
    const run: Run = { conversationId: args.conversationId ?? '', messageId: '' };
    try {
      return await withRetry(`Genie ${args.spaceId}`, () => this.askOnce(args, run), isRetryableRun, this.retry, () => args.onProgress?.({ kind: 'status', text: RETRY_NOTE }));
    } catch (error) {
      return failedResult(args, run, error);
    }
  }

  private async askOnce(args: AskArgs, run: Run): Promise<GenieResult> {
    const { spaceId, question, onProgress } = args;
    const scope = scopeOf(args);
    const call = <T>(m: string, p: string, b?: unknown) => this.call<T>(scope, m, p, b);
    // Only the POST that starts the question counts against the Genie quota; polling below does not.
    const starting = limitedFetch(this.fetchFn, this.limiter, () => onProgress?.({ kind: 'status', text: WAITING_NOTE }));
    const started = run.conversationId
      ? await this.call<Started>(scope, 'POST', `/${spaceId}/conversations/${run.conversationId}/messages`, { content: question }, starting)
      : await this.call<Started>(scope, 'POST', `/${spaceId}/start-conversation`, { content: question }, starting);
    run.conversationId = started.conversation_id ?? run.conversationId;
    run.messageId = started.message_id ?? started.id ?? '';
    const { conversationId: cid, messageId: mid } = run;

    const deadline = Date.now() + this.options.timeoutMs;
    let msg: Message;
    let lastStatus = '';
    let seenThoughts = 0;
    for (let i = 0; ; i++) {
      msg = await call<Message>('GET', `/${spaceId}/conversations/${cid}/messages/${mid}`);
      // Stream progress: status changes, then any reasoning steps that appeared since the last poll.
      if (msg.status !== lastStatus && msg.status !== 'COMPLETED') {
        lastStatus = msg.status;
        onProgress?.({ kind: 'status', text: STATUS_LABELS[msg.status] ?? msg.status });
      }
      const thoughts = thoughtsOf((msg.attachments ?? []).find((a) => a.query));
      thoughts.slice(seenThoughts).forEach((text) => onProgress?.({ kind: 'thought', text }));
      seenThoughts = thoughts.length;
      if (msg.status === 'COMPLETED') break;
      if (msg.status === 'FAILED') throw new GenieRunFailed(msg.error?.error ?? 'Genie message FAILED');
      if (msg.status === 'CANCELLED' || msg.status === 'QUERY_RESULT_EXPIRED') throw new Error(`Genie message ${msg.status}`);
      if (Date.now() > deadline) throw new Error('Genie timed out');
      await sleep(this.pollDelaysMs[Math.min(i, this.pollDelaysMs.length - 1)], scope.signal);
    }

    const attachments = msg.attachments ?? [];
    const textAtt = attachments.find((a) => a.text?.content);
    const queryAtt = attachments.find((a) => a.query);
    let columns: string[] = [];
    let rows: unknown[][] = [];
    let totalRows = 0;
    if (queryAtt?.attachment_id) {
      const r = await call<StatementResponse & { statement_response?: StatementResponse }>('GET', `/${spaceId}/conversations/${cid}/messages/${mid}/attachments/${queryAtt.attachment_id}/query-result`);
      const sr = r.statement_response ?? r;
      columns = (sr.manifest?.schema?.columns ?? []).map((c) => c.name);
      const data = sr.result?.data_array ?? [];
      totalRows = sr.manifest?.total_row_count ?? data.length;
      rows = data.slice(0, this.options.rowCap);
    }
    return {
      spaceId, question,
      summary: textAtt?.text?.content ?? queryAtt?.query?.description ?? '',
      sql: queryAtt?.query?.query ?? null,
      columns, rows, totalRows,
      thinking: thoughtsOf(queryAtt),
      suggestedQuestions: attachments.flatMap((a) => a.suggested_questions?.questions ?? []),
      statementId: null,
      conversationId: cid, messageId: mid, error: null,
    };
  }

  async feedback(args: FeedbackArgs): Promise<void> {
    const { spaceId, conversationId, messageId, rating } = args;
    await this.call(scopeOf(args), 'POST', `/${spaceId}/conversations/${conversationId}/messages/${messageId}/feedback`, { rating });
  }
}
