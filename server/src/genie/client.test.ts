import { describe, expect, it } from 'vitest';
import { DatabricksGenieClient, RETRY_NOTE } from './client';

const tokens = { getToken: async () => 't' };
const NO_WAIT = { attempts: 3, baseDelayMs: 0, maxDelayMs: 0 };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

function mockFetch(routes: Array<[RegExp, () => Response]>) {
  const calls: string[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method} ${url}`);
    for (const [re, make] of routes) if (re.test(`${init?.method} ${url}`)) return make();
    return json({ error: 'no route' }, 404);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const client = (fn: typeof fetch) => new DatabricksGenieClient(tokens, { host: 'host', rowCap: 200, timeoutMs: 180_000, retry: NO_WAIT, fetch: fn, pollDelaysMs: [0] });

describe('DatabricksGenieClient', () => {
  it('polls until COMPLETED, fetches rows, caps them', async () => {
    let polls = 0;
    const rows = Array.from({ length: 300 }, (_, i) => [`c${i}`, String(i)]);
    const { fn } = mockFetch([
      [/POST .*start-conversation/, () => json({ conversation_id: 'c1', message_id: 'm1' })],
      [/GET .*messages\/m1$/, () => json(++polls < 2
        ? { status: 'EXECUTING_QUERY' }
        : { status: 'COMPLETED', attachments: [{ attachment_id: 'a1', query: { query: 'SELECT 1' } }, { text: { content: 'hello' } }] })],
      [/query-result/, () => json({ statement_response: { manifest: { schema: { columns: [{ name: 'a' }, { name: 'b' }] }, total_row_count: 300 }, result: { data_array: rows } } })],
    ]);
    const r = await client(fn).ask({ spaceId: 's', question: 'q' });
    expect(r.error).toBeNull();
    expect(r.summary).toBe('hello');
    expect(r.sql).toBe('SELECT 1');
    expect(r.columns).toEqual(['a', 'b']);
    expect(r.rows).toHaveLength(200);
    expect(r.totalRows).toBe(300);
    expect(polls).toBe(2);
  });

  it('reuses conversationId for follow-ups', async () => {
    const { fn, calls } = mockFetch([
      [/POST .*conversations\/c9\/messages$/, () => json({ conversation_id: 'c9', message_id: 'm2' })],
      [/GET .*messages\/m2$/, () => json({ status: 'COMPLETED', attachments: [{ text: { content: 'ok' } }] })],
    ]);
    const r = await client(fn).ask({ spaceId: 's', question: 'q', conversationId: 'c9' });
    expect(r.conversationId).toBe('c9');
    expect(calls[0]).toContain('/conversations/c9/messages');
  });

  it('asks again in the same conversation when Genie fails its own run, and says so', async () => {
    let run = 0;
    const lines: string[] = [];
    const { fn, calls } = mockFetch([
      [/POST .*start-conversation/, () => json({ conversation_id: 'c1', message_id: `m${++run}` })],
      [/POST .*conversations\/c1\/messages$/, () => json({ conversation_id: 'c1', message_id: `m${++run}` })],
      [/GET .*messages\/m1$/, () => json({ status: 'FAILED', error: { error: '[PARSE_SYNTAX_ERROR] Syntax error' } })],
      [/GET .*messages\/m2$/, () => json({ status: 'COMPLETED', attachments: [{ text: { content: 'answer' } }] })],
    ]);
    const r = await client(fn).ask({ spaceId: 's', question: 'q', onProgress: (l) => lines.push(l) });
    expect(r).toMatchObject({ error: null, summary: 'answer', conversationId: 'c1', messageId: 'm2' });
    expect(calls.filter((c) => c.startsWith('POST'))).toEqual(['POST https://host/api/2.0/genie/spaces/s/start-conversation', 'POST https://host/api/2.0/genie/spaces/s/conversations/c1/messages']);
    expect(lines).toContain(RETRY_NOTE);
  });

  it('gives up after the last attempt and returns the error', async () => {
    const { fn, calls } = mockFetch([
      [/POST/, () => json({ conversation_id: 'c', message_id: 'm' })],
      [/GET/, () => json({ status: 'FAILED', error: { error: 'boom' } })],
    ]);
    expect((await client(fn).ask({ spaceId: 's', question: 'q' })).error).toBe('boom');
    expect(calls.filter((c) => c.startsWith('POST'))).toHaveLength(3);
  });

  it('does not retry an access error or a rejected request', async () => {
    const denied = mockFetch([
      [/POST/, () => json({ conversation_id: 'c', message_id: 'm' })],
      [/GET/, () => json({ status: 'FAILED', error: { error: '[INSUFFICIENT_PERMISSIONS] no SELECT on table' } })],
    ]);
    expect((await client(denied.fn).ask({ spaceId: 's', question: 'q' })).error).toContain('INSUFFICIENT_PERMISSIONS');
    expect(denied.calls.filter((c) => c.startsWith('POST'))).toHaveLength(1);

    const http = mockFetch([[/POST/, () => json({ message: 'unauthorized' }, 401)]]);
    expect((await client(http.fn).ask({ spaceId: 's', question: 'q' })).error).toContain('401');
    expect(http.calls).toHaveLength(1);
  });

  it('waits out a throttled request instead of failing', async () => {
    let posts = 0;
    const { fn } = mockFetch([
      [/POST .*start-conversation/, () => (++posts === 1 ? json({ message: 'slow down' }, 429) : json({ conversation_id: 'c', message_id: 'm' }))],
      [/GET .*messages\/m$/, () => json({ status: 'COMPLETED', attachments: [{ text: { content: 'ok' } }] })],
    ]);
    expect((await client(fn).ask({ spaceId: 's', question: 'q' })).error).toBeNull();
    expect(posts).toBe(2);
  });
});
