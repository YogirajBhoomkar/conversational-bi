import type { GenieClient, GenieResult } from '../../contracts';
import type { TokenProvider } from '../../ports/auth';
import { type AskArgs, DatabricksGenieClient, failedResult, type FeedbackArgs, type GenieClientOptions, isRetryableRun, RETRY_NOTE, type Run, scopeOf } from './client';
import { fetchWithRetry, GenieRunFailed, type RetryPolicy, withRetry } from './retry';

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
    const j = JSON.parse(candidate) as { data?: unknown; x?: unknown; y?: unknown } | null;
    return Array.isArray(j?.data) && typeof j?.x === 'string' && typeof j?.y === 'string' ? candidate : null;
  } catch {
    return null;
  }
};

// The parts of the Agent mode stream this client reads. Anything else in the stream is ignored.
type ResultMetadata = { sql?: string; columns?: Array<{ name: string }>; preview_rows?: unknown[][]; total_row_count?: number };
type Item = {
  type: string;
  output?: string;
  metadata?: { statement_id?: string };
  arguments?: string;
  content?: Array<{ type?: string; text?: string; metadata?: ResultMetadata }>;
};
type StreamEvent = {
  type?: string;
  response?: { id?: string; conversation_id?: string; error?: { message?: string } };
  item?: Item;
  message?: string;
  error?: { message?: string };
};
type StatementChunk = { data_array?: unknown[][]; external_links?: unknown[]; next_chunk_internal_link?: string };
type StatementPage = StatementChunk & { manifest?: { schema?: { columns?: Array<{ name: string }> }; total_row_count?: number }; result?: StatementChunk };

// Genie Agent mode (GA; the Agent mode APIs went generally available on 27 Aug 2026, only the Flash option is Beta):
// POST /api/2.0/genie/agents/{space}/responses, streamed as Server-Sent Events.
// Unlike the Conversation API it streams the agent's actual reasoning, each SQL call and the synthesized answer.
export class DatabricksGenieAgentClient implements GenieClient {
  private readonly origin: string;
  private readonly chat: DatabricksGenieClient;
  private readonly fetchFn: typeof fetch;
  private readonly retry: RetryPolicy;
  constructor(private readonly tokens: TokenProvider, private readonly options: GenieClientOptions) {
    this.origin = `https://${options.host}`;
    this.fetchFn = options.fetch ?? fetch;
    this.retry = options.retry;
    this.chat = new DatabricksGenieClient(tokens, options); // feedback still uses the Conversation API
  }

  async ask(args: AskArgs): Promise<GenieResult> {
    const run: Run = { conversationId: args.conversationId ?? '', messageId: '' };
    try {
      return await withRetry(`Genie agent ${args.spaceId}`, () => this.askOnce(args, run), isRetryableRun, this.retry, () => args.onProgress?.(RETRY_NOTE));
    } catch (error) {
      return failedResult(args, run, error);
    }
  }

  private async askOnce(args: AskArgs, run: Run): Promise<GenieResult> {
    const { spaceId, question, onProgress } = args;
    const scope = scopeOf(args);
    const result: GenieResult = { spaceId, question, summary: '', sql: null, columns: [], rows: [], totalRows: 0, thinking: [], suggestedQuestions: [], statementId: null, conversationId: run.conversationId, messageId: run.messageId, error: null };
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.options.timeoutMs);
    const signal = scope.signal ? AbortSignal.any([timeout.signal, scope.signal]) : timeout.signal;
    try {
      const res = await fetchWithRetry(
        this.fetchFn,
        `${this.origin}/api/2.0/genie/agents/${spaceId}/responses`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${await this.tokens.getToken(scope.caller)}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'genie-agent',
            stream: true,
            input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: question }] }],
            ...(run.conversationId ? { conversation_id: run.conversationId } : {}),
          }),
          signal,
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
            if (data.item) this.onItem(data.item, result, texts, onProgress);
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
          const full = await this.fetchFullResult({ statementId: result.statementId, cap: 1, ...scope });
          if (full.rows.length) Object.assign(result, { columns: full.columns, rows: full.rows, totalRows: 1 });
        } catch (e) {
          console.warn('[genie] could not load chart JSON:', e instanceof Error ? e.message : e);
        }
      }
      result.summary = texts.join('\n\n');
      return result;
    } catch (error) {
      throw timeout.signal.aborted ? new Error('Genie timed out') : error;
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
        const call = JSON.parse(item.arguments ?? '{}') as { title?: string; sql?: string };
        title = call.title ?? '';
        result.sql ??= call.sql ?? null; // the message's result section may be missing (chart answers); keep the SQL anyway
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
          result.columns = (meta.columns ?? []).map((c) => c.name);
          const rows = meta.preview_rows ?? [];
          result.rows = rows.slice(0, this.options.rowCap);
          result.totalRows = meta.total_row_count ?? rows.length;
        } else if (part.text) {
          const text = part.text.replace(CITATION, '').replace(EMBED_CHART, '').replace(/\n{3,}/g, '\n\n').trim();
          if (text) texts.push(text);
        }
      }
    }
  }

  feedback(args: FeedbackArgs): Promise<void> {
    return this.chat.feedback(args);
  }

  // Pages through the SQL Statement API (inline JSON chunks) until `cap` rows or the end of the result.
  async fetchFullResult(args: NonNullable<Parameters<NonNullable<GenieClient['fetchFullResult']>>[0]>) {
    const { statementId, cap } = args;
    const scope = scopeOf(args);
    let path: string | undefined = `/api/2.0/sql/statements/${statementId}`;
    let columns: string[] = [];
    let totalRows = 0;
    const rows: unknown[][] = [];
    while (path && rows.length < cap) {
      const res = await fetchWithRetry(this.fetchFn, `${this.origin}${path}`, { headers: { Authorization: `Bearer ${await this.tokens.getToken(scope.caller)}` }, signal: scope.signal }, this.retry);
      if (!res.ok) throw new Error(`Statement fetch failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
      const j = (await res.json()) as StatementPage;
      if (j.manifest) {
        columns = (j.manifest.schema?.columns ?? []).map((c) => c.name);
        totalRows = j.manifest.total_row_count ?? 0;
      }
      const chunk: StatementChunk = j.result ?? j; // first page nests the chunk under `result`; later pages are the chunk itself
      if (chunk.external_links) throw new Error('Result is too large to load inline.');
      rows.push(...(chunk.data_array ?? []));
      path = chunk.next_chunk_internal_link;
    }
    return { columns, rows: rows.slice(0, cap), totalRows: totalRows || rows.length };
  }
}

// Yields the parsed JSON of each `data:` line of a text/event-stream body.
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const parse = (block: string): StreamEvent | null => {
    const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return null;
    try {
      return JSON.parse(data) as StreamEvent;
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
