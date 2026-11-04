import type { FeedbackRequest, GenieClient, GenieResult, TokenProvider } from '../contracts';
import { type AskArgs, DatabricksGenieClient, failedResult, isRetryableRun, RETRY_NOTE, type Run } from './client';
import { DEFAULT_RETRY, fetchWithRetry, GenieRunFailed, type RetryPolicy, withRetry } from './retry';

const ROW_CAP = Number(process.env.GENIE_ROW_CAP ?? 200);
const TIMEOUT_MS = Number(process.env.GENIE_TIMEOUT_MS ?? 180_000);

// Citation links Genie appends to its prose, e.g. \[[1](https://...)\]
const CITATION = /\\?\[\[\d+\]\([^)]*\)\\?\]/g;
// Databricks' own UI placeholder for a chart it would draw, e.g. :embedChart{:chart[uuid]}. Meaningless outside its UI.
const EMBED_CHART = /:embedChart\{[^}]*\}\}?/g;

// A chart request makes Genie run a `chart_json` query. That JSON only appears in the query output (a markdown table
// with one JSON cell), not in the final message's result section. When the output is complete, pull it out so the
// normal chart path can use it (otherwise `ask` loads it by statement id, see below).
const chartJsonOf = (output: string): string | null => {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const candidate = output.slice(start, end + 1);
  try {
    const j = JSON.parse(candidate);
    return Array.isArray(j?.data) && typeof j?.x === 'string' && typeof j?.y === 'string' ? candidate : null;
  } catch {
    return null;
  }
};

type Item = {
  type: string;
  name?: string;
  output?: string;
  metadata?: { statement_id?: string };
  arguments?: string;
  content?: Array<{ type?: string; text?: string; metadata?: any }>;
};

// Genie Agent mode (GA; the Agent mode APIs went generally available on 27 Aug 2026, only the Flash option is Beta):
// POST /api/2.0/genie/agents/{space}/responses, streamed as Server-Sent Events.
// Unlike the Conversation API it streams the agent's actual reasoning, each SQL call and the synthesized answer.
export class DatabricksGenieAgentClient implements GenieClient {
  private readonly origin: string;
  private readonly chat: DatabricksGenieClient;
  constructor(
    private readonly tokens: TokenProvider,
    host = process.env.DATABRICKS_SERVER_HOSTNAME,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly retry: RetryPolicy = DEFAULT_RETRY,
  ) {
    if (!host) throw new Error('DATABRICKS_SERVER_HOSTNAME is not set');
    this.origin = `https://${host.replace(/^https?:\/\//, '')}`;
    this.chat = new DatabricksGenieClient(tokens, host, fetchFn, undefined, retry); // feedback still uses the Conversation API
  }

  async ask(args: AskArgs): Promise<GenieResult> {
    const run: Run = { conversationId: args.conversationId ?? '', messageId: '' };
    try {
      return await withRetry(`Genie agent ${args.spaceId}`, () => this.askOnce(args, run), isRetryableRun, this.retry, () => args.onProgress?.(RETRY_NOTE));
    } catch (error) {
      return failedResult(args, run, error);
    }
  }

  private async askOnce({ spaceId, question, sessionId, onProgress }: AskArgs, run: Run): Promise<GenieResult> {
    const result: GenieResult = { spaceId, question, summary: '', sql: null, columns: [], rows: [], totalRows: 0, thinking: [], suggestedQuestions: [], statementId: null, conversationId: run.conversationId, messageId: run.messageId, error: null };
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      const res = await fetchWithRetry(
        this.fetchFn,
        `${this.origin}/api/2.0/genie/agents/${spaceId}/responses`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${await this.tokens.getToken({ sessionId })}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'genie-agent',
            stream: true,
            input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: question }] }],
            ...(run.conversationId ? { conversation_id: run.conversationId } : {}),
          }),
          signal: abort.signal,
        },
        this.retry,
      );
      if (!res.ok || !res.body) throw new Error(`Genie agent responses failed: ${res.status} ${(await res.text()).slice(0, 300)}`);

      const texts: string[] = [];
      for await (const data of sseData(res.body)) {
        switch (data.type) {
          case 'response.created':
            result.conversationId = run.conversationId = data.response?.conversation_id ?? run.conversationId;
            result.messageId = run.messageId = data.response?.id ?? run.messageId;
            break;
          case 'response.output_item.done':
            this.onItem(data.item as Item, result, texts, onProgress);
            break;
          case 'response.failed':
            throw new GenieRunFailed(data.response?.error?.message ?? 'Genie agent failed');
          case 'error':
            throw new GenieRunFailed(data.message ?? data.error?.message ?? 'Genie agent error');
        }
      }
      // The stream cuts long query output off mid-way (~600 chars), so a chart's JSON often arrives incomplete.
      // The query itself is intact: load the one-cell result by statement id.
      if (!result.columns.length && result.statementId && /chart_json/i.test(result.sql ?? '')) {
        try {
          const full = await this.fetchFullResult({ statementId: result.statementId, cap: 1, sessionId });
          if (full.rows.length) Object.assign(result, { columns: full.columns, rows: full.rows, totalRows: 1 });
        } catch (e) {
          console.warn('[genie] could not load chart JSON:', e instanceof Error ? e.message : e);
        }
      }
      result.summary = texts.join('\n\n');
      return result;
    } catch (error) {
      throw abort.signal.aborted ? new Error('Genie timed out') : error;
    } finally {
      clearTimeout(timer);
    }
  }

  private onItem(item: Item, result: GenieResult, texts: string[], onProgress?: (line: string) => void) {
    if (item.type === 'reasoning') {
      const text = (item.content ?? []).map((c) => c.text ?? '').join('').trim();
      if (text) {
        result.thinking.push(text);
        onProgress?.(text);
      }
    } else if (item.type === 'function_call') {
      let title = '';
      try {
        const args = JSON.parse(item.arguments ?? '{}');
        title = args.title ?? '';
        result.sql ??= args.sql ?? null; // the message's result section may be missing (chart answers); keep the SQL anyway
      } catch { /* arguments not JSON; fall back to a generic line */ }
      onProgress?.(title ? `Running query: ${title}` : 'Running a query…');
    } else if (item.type === 'function_call_output') {
      result.statementId = item.metadata?.statement_id ?? result.statementId;
      const chartJson = chartJsonOf(item.output ?? '');
      if (chartJson) {
        // Same shape chat mode returns for chart answers, so one code path turns it into a table and a chart.
        result.columns = ['chart_json'];
        result.rows = [[chartJson]];
        result.totalRows = 1;
      }
      onProgress?.('Query finished, reading the results…');
    } else if (item.type === 'message') {
      for (const part of item.content ?? []) {
        const meta = part.metadata;
        if (meta?.sql) {
          // The part carrying the query result: SQL, columns and rows (the table itself is shown by the UI, not repeated in prose).
          result.sql = meta.sql;
          result.columns = (meta.columns ?? []).map((c: { name: string }) => c.name);
          const rows: unknown[][] = meta.preview_rows ?? [];
          result.rows = rows.slice(0, ROW_CAP);
          result.totalRows = meta.total_row_count ?? rows.length;
        } else if (part.text) {
          const text = part.text.replace(CITATION, '').replace(EMBED_CHART, '').replace(/\n{3,}/g, '\n\n').trim();
          if (text) texts.push(text);
        }
      }
    }
  }

  feedback(req: FeedbackRequest & { sessionId?: string }): Promise<void> {
    return this.chat.feedback(req);
  }

  // Pages through the SQL Statement API (inline JSON chunks) until `cap` rows or the end of the result.
  async fetchFullResult({ statementId, cap, sessionId }: { statementId: string; cap: number; sessionId?: string }) {
    let path: string | undefined = `/api/2.0/sql/statements/${statementId}`;
    let columns: string[] = [];
    let totalRows = 0;
    const rows: unknown[][] = [];
    while (path && rows.length < cap) {
      const res = await fetchWithRetry(this.fetchFn, `${this.origin}${path}`, { headers: { Authorization: `Bearer ${await this.tokens.getToken({ sessionId })}` } }, this.retry);
      if (!res.ok) throw new Error(`Statement fetch failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
      const j: any = await res.json();
      if (j.manifest) {
        columns = (j.manifest.schema?.columns ?? []).map((c: { name: string }) => c.name);
        totalRows = j.manifest.total_row_count ?? 0;
      }
      const chunk = j.result ?? j; // first page nests the chunk under `result`; later pages are the chunk itself
      if (chunk.external_links) throw new Error('Result is too large to load inline.');
      rows.push(...(chunk.data_array ?? []));
      path = chunk.next_chunk_internal_link;
    }
    return { columns, rows: rows.slice(0, cap), totalRows: totalRows || rows.length };
  }
}

// Yields the parsed JSON of each `data:` line of a text/event-stream body.
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<any> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const parse = (block: string) => {
    const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return null;
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buf += dec.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const ev = parse(buf.slice(0, i));
        buf = buf.slice(i + 2);
        if (ev) yield ev;
      }
      if (done) break;
    }
    const last = parse(buf);
    if (last) yield last;
  } finally {
    reader.cancel().catch(() => undefined); // stop the download when the caller stops reading early (a failed run)
  }
}
