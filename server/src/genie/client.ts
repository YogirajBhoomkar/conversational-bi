import type { FeedbackRequest, GenieClient, GenieResult, TokenProvider } from '../contracts';
import { DEFAULT_RETRY, fetchWithRetry, GenieRunFailed, type RetryPolicy, withRetry } from './retry';

const ROW_CAP = Number(process.env.GENIE_ROW_CAP ?? 200);
const TIMEOUT_MS = Number(process.env.GENIE_TIMEOUT_MS ?? 180_000);

type Attachment = {
  attachment_id?: string;
  text?: { content?: string };
  query?: { query?: string; description?: string; thoughts?: Array<string | { thought_type?: string; content?: string }> };
  suggested_questions?: { questions?: string[] };
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
// The Genie conversation and message of the current question, kept across attempts so a retry continues the same conversation.
export type Run = { conversationId: string; messageId: string };

export const RETRY_NOTE = 'Genie could not answer that, trying again…';
export const isRetryableRun = (error: unknown) => error instanceof GenieRunFailed && error.retryable;

// A question that could not be answered. The error goes back to the agent as text instead of failing the whole request.
export const failedResult = ({ spaceId, question }: AskArgs, run: Run, error: unknown): GenieResult => ({
  spaceId, question, summary: '', sql: null, columns: [], rows: [], totalRows: 0, thinking: [], suggestedQuestions: [], statementId: null,
  conversationId: run.conversationId, messageId: run.messageId, error: error instanceof Error ? error.message : String(error),
});

export class DatabricksGenieClient implements GenieClient {
  private readonly base: string;
  constructor(
    private readonly tokens: TokenProvider,
    host = process.env.DATABRICKS_SERVER_HOSTNAME,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly pollDelaysMs = [1000, 1500, 2000, 3000, 5000],
    private readonly retry: RetryPolicy = DEFAULT_RETRY,
  ) {
    if (!host) throw new Error('DATABRICKS_SERVER_HOSTNAME is not set');
    this.base = `https://${host.replace(/^https?:\/\//, '')}/api/2.0/genie/spaces`;
  }

  private async call<T>(method: string, path: string, body?: unknown, sessionId?: string): Promise<T> {
    const res = await fetchWithRetry(
      this.fetchFn,
      `${this.base}${path}`,
      {
        method,
        headers: { Authorization: `Bearer ${await this.tokens.getToken({ sessionId })}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
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
      return await withRetry(`Genie ${args.spaceId}`, () => this.askOnce(args, run), isRetryableRun, this.retry, () => args.onProgress?.(RETRY_NOTE));
    } catch (error) {
      return failedResult(args, run, error);
    }
  }

  private async askOnce({ spaceId, question, sessionId, onProgress }: AskArgs, run: Run): Promise<GenieResult> {
    const call = <T>(m: string, p: string, b?: unknown) => this.call<T>(m, p, b, sessionId);
    const started = run.conversationId
      ? await call<Message>('POST', `/${spaceId}/conversations/${run.conversationId}/messages`, { content: question })
      : await call<{ conversation_id: string; message_id: string }>('POST', `/${spaceId}/start-conversation`, { content: question });
    run.conversationId = (started as any).conversation_id ?? run.conversationId;
    run.messageId = (started as any).message_id ?? (started as any).id;
    const { conversationId: cid, messageId: mid } = run;

    const deadline = Date.now() + TIMEOUT_MS;
    let msg: Message;
    let lastStatus = '';
    let seenThoughts = 0;
    for (let i = 0; ; i++) {
      msg = await call<Message>('GET', `/${spaceId}/conversations/${cid}/messages/${mid}`);
      // Stream progress: status changes, then any reasoning steps that appeared since the last poll.
      if (msg.status !== lastStatus && msg.status !== 'COMPLETED') {
        lastStatus = msg.status;
        onProgress?.(STATUS_LABELS[msg.status] ?? msg.status);
      }
      const thoughts = thoughtsOf((msg.attachments ?? []).find((a) => a.query));
      thoughts.slice(seenThoughts).forEach((t) => onProgress?.(t));
      seenThoughts = thoughts.length;
      if (msg.status === 'COMPLETED') break;
      if (msg.status === 'FAILED') throw new GenieRunFailed(msg.error?.error ?? 'Genie message FAILED');
      if (msg.status === 'CANCELLED' || msg.status === 'QUERY_RESULT_EXPIRED') throw new Error(`Genie message ${msg.status}`);
      if (Date.now() > deadline) throw new Error('Genie timed out');
      await new Promise((r) => setTimeout(r, this.pollDelaysMs[Math.min(i, this.pollDelaysMs.length - 1)]));
    }

    const attachments = msg.attachments ?? [];
    const textAtt = attachments.find((a) => a.text?.content);
    const queryAtt = attachments.find((a) => a.query);
    let columns: string[] = [];
    let rows: unknown[][] = [];
    let totalRows = 0;
    if (queryAtt?.attachment_id) {
      const r = await call<any>('GET', `/${spaceId}/conversations/${cid}/messages/${mid}/attachments/${queryAtt.attachment_id}/query-result`);
      const sr = r.statement_response ?? r;
      columns = (sr.manifest?.schema?.columns ?? []).map((c: any) => c.name);
      const data: unknown[][] = sr.result?.data_array ?? [];
      totalRows = sr.manifest?.total_row_count ?? data.length;
      rows = data.slice(0, ROW_CAP);
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

  async feedback({ spaceId, conversationId, messageId, rating, sessionId }: FeedbackRequest & { sessionId?: string }): Promise<void> {
    await this.call('POST', `/${spaceId}/conversations/${conversationId}/messages/${messageId}/feedback`, { rating }, sessionId);
  }
}
