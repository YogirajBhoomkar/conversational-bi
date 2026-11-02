import type { FeedbackRequest, GenieClient, GenieResult, TokenProvider } from '../contracts';

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

export class DatabricksGenieClient implements GenieClient {
  private readonly base: string;
  constructor(
    private readonly tokens: TokenProvider,
    host = process.env.DATABRICKS_SERVER_HOSTNAME,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly pollDelaysMs = [1000, 1500, 2000, 3000, 5000],
  ) {
    if (!host) throw new Error('DATABRICKS_SERVER_HOSTNAME is not set');
    this.base = `https://${host.replace(/^https?:\/\//, '')}/api/2.0/genie/spaces`;
  }

  private async call<T>(method: string, path: string, body?: unknown, sessionId?: string): Promise<T> {
    const res = await this.fetchFn(`${this.base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await this.tokens.getToken({ sessionId })}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Genie ${method} ${path} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  async ask({ spaceId, question, conversationId, sessionId, onProgress }: { spaceId: string; question: string; conversationId?: string; sessionId?: string; onProgress?: (line: string) => void }): Promise<GenieResult> {
    const call = <T>(m: string, p: string, b?: unknown) => this.call<T>(m, p, b, sessionId);
    const empty = { spaceId, question, summary: '', sql: null, columns: [], rows: [], totalRows: 0, thinking: [], suggestedQuestions: [], statementId: null };
    let cid = conversationId ?? '';
    let mid = '';
    try {
      const started = conversationId
        ? await call<Message>('POST', `/${spaceId}/conversations/${conversationId}/messages`, { content: question })
        : await call<{ conversation_id: string; message_id: string }>('POST', `/${spaceId}/start-conversation`, { content: question });
      cid = (started as any).conversation_id ?? conversationId;
      mid = (started as any).message_id ?? (started as any).id;

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
        if (['FAILED', 'CANCELLED', 'QUERY_RESULT_EXPIRED'].includes(msg.status)) {
          return { ...empty, conversationId: cid, messageId: mid, error: msg.error?.error ?? `Genie message ${msg.status}` };
        }
        if (Date.now() > deadline) return { ...empty, conversationId: cid, messageId: mid, error: 'Genie timed out' };
        await new Promise((r) => setTimeout(r, this.pollDelaysMs[Math.min(i, this.pollDelaysMs.length - 1)]));
      }

      const attachments = msg.attachments ?? [];
      const textAtt = attachments.find((a) => a.text?.content);
      const queryAtt = attachments.find((a) => a.query);
      const thinking = thoughtsOf(queryAtt);
      const suggestedQuestions = attachments.flatMap((a) => a.suggested_questions?.questions ?? []);
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
        columns, rows, totalRows, thinking, suggestedQuestions, statementId: null,
        conversationId: cid, messageId: mid, error: null,
      };
    } catch (e) {
      return { ...empty, conversationId: cid, messageId: mid, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async feedback({ spaceId, conversationId, messageId, rating, sessionId }: FeedbackRequest & { sessionId?: string }): Promise<void> {
    await this.call("POST", `/${spaceId}/conversations/${conversationId}/messages/${messageId}/feedback`, { rating }, sessionId);
  }
}
