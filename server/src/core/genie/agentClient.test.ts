import { describe, expect, it } from 'vitest';
import type { GenieProgress } from '../../contracts';
import { DatabricksGenieAgentClient } from './agentClient';
import { RETRY_NOTE } from './client';

const NO_WAIT = { attempts: 3, baseDelayMs: 0, maxDelayMs: 0 };
const options = (fetch: typeof globalThis.fetch) => ({ host: 'host.example', rowCap: 200, timeoutMs: 180_000, retry: NO_WAIT, fetch });
const ev = (type: string, data: object) => `event:${type}\ndata:${JSON.stringify({ type, ...data })}\n\n`;
const item = (it: object) => ev('response.output_item.done', { item: it });

// Shape captured from a real Agent mode response (data-line format has no space after "data:").
const STREAM = [
  ev('response.created', { response: { id: 'msg1', conversation_id: 'conv1', status: 'in_progress', output: [] } }),
  item({ type: 'reasoning', content: [{ type: 'reasoning_text', text: "I'll get the FOT premium by region." }] }),
  item({ type: 'function_call', name: 'execute_sql', arguments: JSON.stringify({ title: 'FOT by region', sql: 'SELECT 1' }) }),
  item({ type: 'function_call_output', output: '| a |', metadata: { statement_id: 'stmt-1' } }),
  item({
    type: 'message',
    content: [
      { type: 'output_text', text: 'Here is the breakdown.' },
      { type: 'output_text', text: '| table |', metadata: { sql: 'SELECT 1', columns: [{ name: 'Region' }, { name: 'Premium' }], preview_rows: [['APAC', '1'], ['EMEA', '2']], total_row_count: 2 } },
      { type: 'output_text', text: 'EMEA leads\\[[1](https://x.example/c)\\]' },
    ],
  }),
  ev('response.completed', { response: { id: 'msg1', status: 'completed' } }),
].join('');

const streamOf = (s: string, chunk = 17) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      const b = new TextEncoder().encode(s);
      for (let i = 0; i < b.length; i += chunk) c.enqueue(b.slice(i, i + chunk)); // tiny chunks exercise event splitting
      c.close();
    },
  });

const client = (res: Response | (() => Response)) =>
  new DatabricksGenieAgentClient({ getToken: async () => 't' }, options((async () => (typeof res === 'function' ? res() : res)) as typeof fetch));

describe('DatabricksGenieAgentClient', () => {
  it('streams reasoning and maps the final message to a GenieResult', async () => {
    const events: GenieProgress[] = [];
    const r = await client(new Response(streamOf(STREAM), { status: 200 })).ask({ spaceId: 's', question: 'q', onProgress: (e) => events.push(e) });
    expect(events).toEqual([
      { kind: 'thought', text: "I'll get the FOT premium by region." },
      { kind: 'query', id: 'msg1:1', title: 'FOT by region', status: 'running' },
      { kind: 'query', id: 'msg1:1', status: 'done' }, // the same query, finished
    ]);
    expect(r).toMatchObject({
      error: null, conversationId: 'conv1', messageId: 'msg1', sql: 'SELECT 1', statementId: 'stmt-1',
      columns: ['Region', 'Premium'], rows: [['APAC', '1'], ['EMEA', '2']], totalRows: 2,
      thinking: ["I'll get the FOT premium by region."],
    });
    expect(r.summary).toBe('Here is the breakdown.\n\nEMEA leads'); // table part dropped, citation stripped
  });

  it('picks up chart JSON from the query output when the final message has no result section', async () => {
    const chart = JSON.stringify({ type: 'column', title: 'T', x: 'Year', y: 'Premium', data: [{ Year: 2023, Premium: 5 }] });
    const stream = [
      ev('response.created', { response: { id: 'm2', conversation_id: 'c2' } }),
      item({ type: 'reasoning', content: [{ text: "I'll create a chart." }] }),
      item({ type: 'function_call', name: 'execute_sql', arguments: JSON.stringify({ title: 'chart', sql: 'SELECT to_json(...) AS chart_json' }) }),
      item({ type: 'function_call_output', output: `**chart**\n\n| chart_json |\n| --- |\n| ${chart} |`, metadata: { statement_id: 's2' } }),
      item({ type: 'message', content: [{ type: 'output_text', text: '## Premium\n\n:embedChart{:chart[01f1d6f5-a7cf]}\n\nPremium grew.' }] }),
      ev('response.completed', { response: { id: 'm2', status: 'completed' } }),
    ].join('');
    const r = await client(new Response(streamOf(stream), { status: 200 })).ask({ spaceId: 's', question: 'chart it' });
    expect(r.chartJsons).toEqual([chart]);
    expect(r.columns).toEqual([]); // no table query ran; the tool builds the table from the chart data
    expect(r.sql).toBe('SELECT to_json(...) AS chart_json');
    expect(r.summary).toBe('## Premium\n\nPremium grew.'); // Databricks' embedChart placeholder removed
  });

  it('loads the chart JSON by statement id when the streamed query output is cut off', async () => {
    const chart = JSON.stringify({ type: 'column', title: 'T', x: 'Year', y: 'Premium', data: [{ Year: 2023, Premium: 5 }, { Year: 2024, Premium: 7 }] });
    const stream = [
      ev('response.created', { response: { id: 'm3', conversation_id: 'c3' } }),
      item({ type: 'function_call', name: 'execute_sql', arguments: JSON.stringify({ title: 'chart', sql: 'SELECT to_json(...) AS chart_json' }) }),
      // as seen in real responses: the JSON is cut off with "..." so it cannot be parsed
      item({ type: 'function_call_output', output: `**chart**\n\n| chart_json |\n| --- |\n| ${chart.slice(0, 40)}... |`, metadata: { statement_id: 's3' } }),
      item({ type: 'message', content: [{ type: 'output_text', text: 'Premium grew.' }] }),
    ].join('');
    const urls: string[] = [];
    const c = new DatabricksGenieAgentClient({ getToken: async () => 't' }, options((async (u: string) => {
      if (String(u).includes('/responses')) return new Response(streamOf(stream), { status: 200 });
      urls.push(new URL(u).pathname);
      return new Response(JSON.stringify({ manifest: { total_row_count: 1, schema: { columns: [{ name: 'chart_json' }] } }, result: { data_array: [[chart]] } }), { status: 200 });
    }) as unknown as typeof fetch));
    const r = await c.ask({ spaceId: 's', question: 'chart it' });
    expect(urls).toEqual(['/api/2.0/sql/statements/s3']);
    expect(r.chartJsons).toEqual([chart]); // the complete JSON, not the cut-off copy
    expect(r.error).toBeNull();
  });

  it('keeps both when Genie runs a chart query and a table query side by side', async () => {
    const chart = JSON.stringify({ type: 'column', title: 'T', x: 'Region', y: 'Limit', data: [{ Region: 'APAC', Limit: 5 }] });
    const stream = [
      ev('response.created', { response: { id: 'm4', conversation_id: 'c4' } }),
      item({ type: 'function_call', call_id: 'a', arguments: JSON.stringify({ title: 'Chart: limit', sql: 'SELECT to_json(...) AS chart_json' }) }),
      item({ type: 'function_call', call_id: 'b', arguments: JSON.stringify({ title: 'Table: limit', sql: 'SELECT region, limit' }) }),
      item({ type: 'function_call_output', call_id: 'b', output: '| Region | Limit |', metadata: { statement_id: 'table-stmt' } }),
      item({ type: 'function_call_output', call_id: 'a', output: `| chart_json |\n| ${chart.slice(0, 30)}... |`, metadata: { statement_id: 'chart-stmt' } }),
      item({ type: 'message', content: [{ type: 'output_text', text: '| t |', metadata: { sql: 'SELECT region, limit', columns: [{ name: 'Region' }, { name: 'Limit' }], preview_rows: [['APAC', 5]], total_row_count: 1 } }] }),
    ].join('');
    const urls: string[] = [];
    const c = new DatabricksGenieAgentClient({ getToken: async () => 't' }, options((async (u: string) => {
      if (String(u).includes('/responses')) return new Response(streamOf(stream), { status: 200 });
      urls.push(new URL(u).pathname);
      return new Response(JSON.stringify({ manifest: { total_row_count: 1, schema: { columns: [{ name: 'chart_json' }] } }, result: { data_array: [[chart]] } }), { status: 200 });
    }) as unknown as typeof fetch));
    const r = await c.ask({ spaceId: 's', question: 'chart and table' });
    expect(urls).toEqual(['/api/2.0/sql/statements/chart-stmt']);
    expect(r).toMatchObject({ chartJsons: [chart], columns: ['Region', 'Limit'], rows: [['APAC', 5]], statementId: 'table-stmt' });
  });

  it('pages through statement chunks and honours the row cap', async () => {
    const urls: string[] = [];
    const pages: Record<string, object> = {
      '/api/2.0/sql/statements/s': { manifest: { total_row_count: 5, schema: { columns: [{ name: 'a' }] } }, result: { data_array: [['1'], ['2']], next_chunk_internal_link: '/api/2.0/sql/statements/s/result/chunks/1' } },
      '/api/2.0/sql/statements/s/result/chunks/1': { data_array: [['3'], ['4']], next_chunk_internal_link: '/api/2.0/sql/statements/s/result/chunks/2' },
      '/api/2.0/sql/statements/s/result/chunks/2': { data_array: [['5']] },
    };
    const c = new DatabricksGenieAgentClient({ getToken: async () => 't' }, options((async (u: string) => {
      urls.push(new URL(u).pathname);
      return new Response(JSON.stringify(pages[new URL(u).pathname]), { status: 200 });
    }) as unknown as typeof fetch));
    expect(await c.fetchFullResult({ statementId: 's', cap: 100 })).toEqual({ columns: ['a'], rows: [['1'], ['2'], ['3'], ['4'], ['5']], totalRows: 5 });
    urls.length = 0;
    const capped = await c.fetchFullResult({ statementId: 's', cap: 3 });
    expect(capped.rows).toEqual([['1'], ['2'], ['3']]);
    expect(capped.totalRows).toBe(5);
    expect(urls).toHaveLength(2); // stopped paging once the cap was reached
  });

  it('reports HTTP errors instead of throwing, without retrying a rejected request', async () => {
    let calls = 0;
    const r = await client(() => (calls++, new Response('preview not enabled', { status: 403 }))).ask({ spaceId: 's', question: 'q' });
    expect(r.error).toContain('403');
    expect(calls).toBe(1);
  });

  it('runs the question again in the same conversation when Genie reports a failed run', async () => {
    const failed = [ev('response.created', { response: { id: 'm1', conversation_id: 'conv1' } }), ev('response.failed', { response: { error: { message: 'query failed' } } })].join('');
    const bodies: any[] = [];
    let call = 0;
    const events: GenieProgress[] = [];
    const c = new DatabricksGenieAgentClient({ getToken: async () => 't' }, options((async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(streamOf(++call === 1 ? failed : STREAM), { status: 200 });
    }) as unknown as typeof fetch));
    const r = await c.ask({ spaceId: 's', question: 'q', onProgress: (e) => events.push(e) });
    expect(r).toMatchObject({ error: null, conversationId: 'conv1', rows: [['APAC', '1'], ['EMEA', '2']] });
    expect(bodies.map((b) => b.conversation_id)).toEqual([undefined, 'conv1']);
    expect(events[0]).toEqual({ kind: 'status', text: RETRY_NOTE });
  });

  it('retries a request the server did not take (503), then answers', async () => {
    let call = 0;
    const r = await client(() => (++call === 1 ? new Response('busy', { status: 503 }) : new Response(streamOf(STREAM), { status: 200 }))).ask({ spaceId: 's', question: 'q' });
    expect(r.error).toBeNull();
    expect(call).toBe(2);
  });
});
