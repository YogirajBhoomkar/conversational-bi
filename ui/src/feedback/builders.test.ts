import { describe, expect, it } from 'vitest';
import { base64Utf8, buildFeedbackEml, headerValue } from './eml';
import { answerHtml, buildFeedbackHtml, escapeHtml } from './html';
import { buildFeedbackMailto, cutText } from './mailto';
import { markdownToPlainText } from './markdownToPlainText';
import { type FeedbackInput, genieIdsLine, isoWithOffset } from './types';

// A made-up turn: no real data, people, hosts or ids.
const input = (over: Partial<FeedbackInput> = {}): FeedbackInput => ({
  to: ['feedback@example.invalid'],
  reason: 'wrong_numbers',
  comment: 'The 2024 total looks too high.',
  question: 'What was the total order value by year?',
  answer: 'Order value was **42.0M** in 2024.\n\n| Year | Value |\n|---|---|\n| 2023 | 38.1M |\n| 2024 | 42.0M |',
  content: 'full',
  traceId: '0f1e2d3c-4b5a-4968-8776-655443322110',
  userRef: 'a1b2c3d4e5f6',
  chatId: 'chat-made-up-1',
  turn: 2,
  time: '2026-11-10T14:05:00+05:30',
  build: 'test-build',
  contract: '1.4.0',
  genieIds: ['conv-a/msg-a'],
  ...over,
});
const MAX = 1900;
const decode = (url: string) => decodeURIComponent(url.split('&body=')[1]);

describe('markdownToPlainText', () => {
  it('drops emphasis, code marks and fences, link targets and heading marks', () => {
    expect(markdownToPlainText('## Result\n**Bold** and *soft* and `code`. See [the guide](https://example.invalid/x).')).toBe('Result\nBold and soft and code. See the guide.');
    expect(markdownToPlainText('```sql\nSELECT 1\n```')).toBe('SELECT 1');
  });

  it('turns a table into one line per row, cells separated by " | ", without the separator row', () => {
    expect(markdownToPlainText('| Year | Value |\n|---|:---:|\n| 2024 | 42 |')).toBe('Year | Value\n2024 | 42');
  });

  it('collapses repeated blank lines', () => {
    expect(markdownToPlainText('a\n\n\n\nb')).toBe('a\n\nb');
  });
});

describe('the plain-text email (mailto)', () => {
  it('has every reference, the chosen type as [x], CRLF line breaks and the subject with the short ref', () => {
    const { subject, body, url, to } = buildFeedbackMailto(input(), MAX);
    expect(to).toEqual(['feedback@example.invalid']);
    expect(subject).toBe('[Conversational BI] Feedback - ref 0f1e2d3c');
    for (const s of ['Feedback ref : 0f1e2d3c-4b5a-4968-8776-655443322110', 'User ref     : a1b2c3d4e5f6', 'Chat id      : chat-made-up-1', 'Turn         : 2 in this chat', 'Time         : 2026-11-10T14:05:00+05:30', 'App          : build test-build, contract 1.4.0', 'Genie ids    : conv-a/msg-a']) {
      expect(body).toContain(s);
    }
    expect(body).toContain('[x] Wrong numbers');
    expect(body).toContain('[ ] Wrong data source');
    expect(body).toContain('Comment: The 2024 total looks too high.');
    expect(body).toContain('Order value was 42.0M in 2024.');
    expect(body).toContain('2024 | 42.0M');
    expect(body.split('\n').every((l, i, all) => i === all.length - 1 || l.endsWith('\r'))).toBe(true);
    expect(url.startsWith('mailto:feedback@example.invalid?subject=')).toBe(true);
    expect(decode(url)).toBe(body);
  });

  it('is ASCII only for ASCII content, and never prints undefined', () => {
    const { body } = buildFeedbackMailto(input({ comment: undefined, question: undefined, genieIds: [] }), MAX);
    expect(/^[\x00-\x7F]*$/.test(body)).toBe(true);
    expect(body).not.toContain('undefined');
    expect(body).toContain('Comment: -');
    expect(body).not.toContain('Genie ids');
  });

  it('no type chosen counts as Other', () => {
    expect(buildFeedbackMailto(input({ reason: null }), MAX).body).toContain('[x] Other');
  });

  it.each([
    ['a very long answer', 'word '.repeat(3000)],
    ['a CJK answer', '这是一个很长的答案，'.repeat(400)],
    ['an emoji answer', '📈 up again '.repeat(500)],
  ])('keeps the encoded link within the budget for %s, shortening on a word boundary', (_name, answer) => {
    const { url, body } = buildFeedbackMailto(input({ answer }), MAX);
    expect(url.length).toBeLessThanOrEqual(MAX);
    expect(body).toContain('...[shortened]');
    expect(body).toContain('Feedback ref : 0f1e2d3c-4b5a-4968-8776-655443322110');
    expect(body).toContain('User ref     : a1b2c3d4e5f6');
  });

  it('gives the question about 300 characters first when both are long', () => {
    const { body, url } = buildFeedbackMailto(input({ question: 'question '.repeat(100), answer: 'answer '.repeat(1000) }), MAX);
    const q = body.split('Question:\r\n')[1].split('\r\n')[0];
    expect(q.length).toBeLessThan(330);
    expect(body).toContain('Answer:');
    expect(url.length).toBeLessThanOrEqual(MAX);
  });

  it('drops the Genie ids, then the comment, but never the trace id or user ref, when even the fixed parts do not fit', () => {
    const many = input({ genieIds: Array.from({ length: 5 }, (_, i) => `conv-${'x'.repeat(200)}-${i}/msg-${i}`), comment: 'c'.repeat(300) });
    const { body, url } = buildFeedbackMailto(many, 1500);
    expect(body).not.toContain('Genie ids');
    expect(body).toContain('Feedback ref : 0f1e2d3c');
    expect(body).toContain('User ref     : a1b2c3d4e5f6');
    expect(url.length).toBeLessThanOrEqual(1500);
    expect(buildFeedbackMailto(many, 800).body).not.toContain('Comment:');
  });

  it('honours BI_FEEDBACK_CONTENT: question leaves out the answer; ids leaves out the whole exchange', () => {
    const question = buildFeedbackMailto(input({ content: 'question' }), MAX).body;
    expect(question).toContain('What was the total order value by year?');
    expect(question).not.toContain('Answer:');
    const ids = buildFeedbackMailto(input({ content: 'ids' }), MAX).body;
    expect(ids).not.toContain('THE EXCHANGE');
    expect(ids).not.toContain('total order value');
    expect(ids).toContain('REFERENCES');
  });

  it('caps the Genie ids at three, then says how many more', () => {
    expect(genieIdsLine(['a/1', 'b/2', 'c/3', 'd/4', 'e/5'])).toBe('a/1, b/2, c/3 [+2 more]');
    expect(genieIdsLine([])).toBeUndefined();
  });

  it('cuts on a word boundary', () => {
    expect(cutText('alpha beta gamma delta', 13)).toBe('alpha beta ...[shortened]');
    expect(cutText('short', 100)).toBe('short');
  });

  it('writes the local time with its offset', () => {
    expect(isoWithOffset(new Date())).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
  });
});

describe('the HTML email', () => {
  it('shows the six types as pills, the chosen one filled, the exchange and every reference', () => {
    const html = buildFeedbackHtml(input());
    expect(html).toContain('Conversational BI - Feedback');
    expect((html.match(/border-radius:999px/g) ?? []).length).toBe(6);
    expect(html).toMatch(/background:#7b3fe4;color:#ffffff;[^"]*">Wrong numbers</);
    expect(html).toMatch(/color:#6b7280;[^"]*">Wrong data source</);
    for (const s of ['0f1e2d3c-4b5a-4968-8776-655443322110', 'a1b2c3d4e5f6', 'chat-made-up-1', '2 in this chat', 'conv-a/msg-a', 'Please keep the references']) expect(html).toContain(s);
    expect(html).not.toMatch(/<script|<img|<link|@import|url\(/i);
  });

  it('renders a Markdown table in the answer as a real table', () => {
    expect(answerHtml('| Year | Value |\n|---|---|\n| 2024 | 42 |')).toMatch(/<table[^>]*>.*<th[^>]*>Year<\/th>.*<td[^>]*>42<\/td>/s);
  });

  it('escapes every value from users and the model', () => {
    const html = buildFeedbackHtml(input({ question: '<script>alert(1)</script>', answer: '<img src=x onerror="alert(1)"> & "quotes"', comment: "it's <b>bad</b>", chatId: '<i>x</i>' }));
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>bad');
    expect(html).not.toContain('<i>x');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&amp; &quot;quotes&quot;');
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});

describe('the .eml draft', () => {
  const partOf = (eml: string, type: string) => {
    const body = eml.split(`Content-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n`)[1].split('\r\n--')[0];
    return new TextDecoder().decode(Uint8Array.from(atob(body.replace(/\r\n/g, '')), (c) => c.charCodeAt(0)));
  };

  it('is an unsent draft with a text and an HTML part, base64 wrapped at 76, CRLF', () => {
    const { filename, content } = buildFeedbackEml(input());
    expect(filename).toBe('feedback-0f1e2d3c.eml');
    expect(content).toMatch(/^To: feedback@example\.invalid\r\nSubject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=\r\nX-Unsent: 1\r\nMIME-Version: 1\.0\r\nContent-Type: multipart\/alternative; boundary="[^"]+"\r\n/);
    expect(content.split('\r\n').every((l) => l.length <= 998)).toBe(true);
    const b64 = content.split('base64\r\n\r\n')[1].split('\r\n--')[0].split('\r\n');
    expect(b64.slice(0, -1).every((l) => l.length === 76)).toBe(true);
    expect(partOf(content, 'text/plain')).toContain('Feedback ref : 0f1e2d3c-4b5a-4968-8776-655443322110');
    expect(partOf(content, 'text/html')).toContain('Conversational BI - Feedback');
  });

  it('round-trips non-ASCII text through base64', () => {
    const text = 'Umsatz 42 € — 这是 📈';
    expect(new TextDecoder().decode(Uint8Array.from(atob(base64Utf8(text)), (c) => c.charCodeAt(0)))).toBe(text);
    expect(partOf(buildFeedbackEml(input({ question: text })).content, 'text/plain')).toContain(text);
  });

  it('cannot be made to add a header (no Bcc smuggled in through the comment, address or ids)', () => {
    const evil = 'x\r\nBcc: x@example.invalid';
    const { content } = buildFeedbackEml(input({ comment: evil, to: [`feedback@example.invalid${evil}`], traceId: `0f1e2d3c${evil}` }));
    const headers = content.split('\r\n\r\n')[0];
    expect(headers).not.toMatch(/^Bcc:/m);
    expect(headers.split('\r\n').every((l) => /^(To|Subject|X-Unsent|MIME-Version|Content-Type):/.test(l))).toBe(true);
    expect(headerValue('a\r\nb\nc')).toBe('a b c');
  });

  it('caps the question and answer at 8,000 characters', () => {
    const { content } = buildFeedbackEml(input({ answer: 'z'.repeat(20_000) }));
    expect(partOf(content, 'text/plain')).toContain('[shortened]');
    expect(partOf(content, 'text/plain').length).toBeLessThan(10_000);
  });
});
