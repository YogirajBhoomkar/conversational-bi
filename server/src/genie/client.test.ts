import { describe, expect, it } from 'vitest';
import { DatabricksGenieClient } from './client';

const tokens = { getToken: async () => 't' };
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
    const r = await new DatabricksGenieClient(tokens, 'host', fn, [0]).ask({ spaceId: 's', question: 'q' });
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
    const r = await new DatabricksGenieClient(tokens, 'host', fn, [0]).ask({ spaceId: 's', question: 'q', conversationId: 'c9' });
    expect(r.conversationId).toBe('c9');
    expect(calls[0]).toContain('/conversations/c9/messages');
  });

  it('returns an error result when Genie fails or HTTP errors', async () => {
    const failed = mockFetch([
      [/POST/, () => json({ conversation_id: 'c', message_id: 'm' })],
      [/GET/, () => json({ status: 'FAILED', error: { error: 'boom' } })],
    ]);
    expect((await new DatabricksGenieClient(tokens, 'host', failed.fn, [0]).ask({ spaceId: 's', question: 'q' })).error).toBe('boom');

    const http = mockFetch([[/POST/, () => json({ message: 'unauthorized' }, 401)]]);
    expect((await new DatabricksGenieClient(tokens, 'host', http.fn, [0]).ask({ spaceId: 's', question: 'q' })).error).toContain('401');
  });
});
