import { describe, expect, it } from 'vitest';
import { buildFeedbackCopy, buildFeedbackMailto, cutText } from './mailto';
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
  it('has every reference, the chosen type, the exchange, CRLF line breaks and the subject with the short ref', () => {
    const { subject, body, url, to } = buildFeedbackMailto(input(), MAX);
    expect(to).toEqual(['feedback@example.invalid']);
    expect(subject).toBe('[Conversational BI] Feedback - ref 0f1e2d3c');
    for (const s of ['Feedback ref: 0f1e2d3c-4b5a-4968-8776-655443322110', 'User ref: a1b2c3d4e5f6', 'Chat id: chat-made-up-1', 'Turn: 2 in this chat', 'Time: 2026-11-10T14:05:00+05:30', 'App: build test-build, contract 1.4.0', 'Genie ids: conv-a/msg-a']) {
      expect(body).toContain(s);
    }
    expect(body).toContain('WHAT WAS WRONG\r\nWrong numbers\r\nComment: The 2024 total looks too high.');
    expect(body).not.toContain('Wrong data source');
    expect(body).toContain('MY QUESTION\r\nWhat was the total order value by year?');
    expect(body).toContain('THE ANSWER I GOT\r\nOrder value was 42.0M in 2024.');
    expect(body).toContain('Order value was 42.0M in 2024.');
    expect(body).toContain('2024 | 42.0M');
    expect(body.split('\n').every((l, i, all) => i === all.length - 1 || l.endsWith('\r'))).toBe(true);
    expect(url.startsWith('mailto:feedback@example.invalid?subject=')).toBe(true);
    expect(decode(url)).toBe(body);
  });

  it('does not rely on a monospace font: no padded columns or checkbox grid', () => {
    const { body } = buildFeedbackMailto(input(), MAX);
    expect(body).not.toMatch(/ {2,}/);
    expect(body).not.toContain('[x]');
  });

  it('is ASCII only for ASCII content, and never prints undefined or an empty comment', () => {
    const { body } = buildFeedbackMailto(input({ comment: undefined, question: undefined, genieIds: [] }), MAX);
    expect(/^[\x00-\x7F]*$/.test(body)).toBe(true);
    expect(body).not.toContain('undefined');
    expect(body).not.toContain('Comment:');
    expect(body).not.toContain('Genie ids');
  });

  it('no type chosen counts as Other', () => {
    expect(buildFeedbackMailto(input({ reason: null }), MAX).body).toContain('WHAT WAS WRONG\r\nOther');
  });

  it.each([
    ['a very long answer', 'word '.repeat(3000)],
    ['a CJK answer', '这是一个很长的答案，'.repeat(400)],
    ['an emoji answer', '📈 up again '.repeat(500)],
  ])('keeps the encoded link within the budget for %s, shortening on a word boundary', (_name, answer) => {
    const { url, body } = buildFeedbackMailto(input({ answer }), MAX);
    expect(url.length).toBeLessThanOrEqual(MAX);
    expect(body).toContain('...[shortened]');
    expect(body).toContain('Feedback ref: 0f1e2d3c-4b5a-4968-8776-655443322110');
    expect(body).toContain('User ref: a1b2c3d4e5f6');
  });

  it('gives the question about 300 characters first when both are long', () => {
    const { body, url } = buildFeedbackMailto(input({ question: 'question '.repeat(100), answer: 'answer '.repeat(1000) }), MAX);
    const q = body.split('MY QUESTION\r\n')[1].split('\r\n')[0];
    expect(q.length).toBeLessThan(330);
    expect(body).toContain('THE ANSWER I GOT');
    expect(url.length).toBeLessThanOrEqual(MAX);
  });

  it('drops the Genie ids, then the comment, but never the trace id or user ref, when even the fixed parts do not fit', () => {
    const many = input({ genieIds: Array.from({ length: 5 }, (_, i) => `conv-${'x'.repeat(200)}-${i}/msg-${i}`), comment: 'c'.repeat(300) });
    const { body, url } = buildFeedbackMailto(many, 1500);
    expect(body).not.toContain('Genie ids');
    expect(body).toContain('Feedback ref: 0f1e2d3c');
    expect(body).toContain('User ref: a1b2c3d4e5f6');
    expect(url.length).toBeLessThanOrEqual(1500);
    expect(buildFeedbackMailto(many, 800).body).not.toContain('Comment:');
  });

  it('honours BI_FEEDBACK_CONTENT: question leaves out the answer; ids leaves out the whole exchange', () => {
    const question = buildFeedbackMailto(input({ content: 'question' }), MAX).body;
    expect(question).toContain('What was the total order value by year?');
    expect(question).not.toContain('THE ANSWER I GOT');
    const ids = buildFeedbackMailto(input({ content: 'ids' }), MAX).body;
    expect(ids).not.toContain('MY QUESTION');
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

describe('the Copy email text fallback', () => {
  it('is the same email with nothing shortened for the link, capped at 8,000 characters per text', () => {
    const { to, subject, body } = buildFeedbackCopy(input({ answer: 'word '.repeat(3000) }));
    expect(to).toEqual(['feedback@example.invalid']);
    expect(subject).toBe('[Conversational BI] Feedback - ref 0f1e2d3c');
    expect(body.length).toBeGreaterThan(8000);
    expect(body.length).toBeLessThan(9000);
    expect(body).toContain('...[shortened]');
    expect(buildFeedbackCopy(input()).body).not.toContain('[shortened]');
    expect(buildFeedbackCopy(input()).body).toContain('Genie ids: conv-a/msg-a');
  });

  it('honours BI_FEEDBACK_CONTENT too', () => {
    expect(buildFeedbackCopy(input({ content: 'ids' })).body).not.toContain('total order value');
  });
});
