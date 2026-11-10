// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientConfig } from '../../feedback/types';
import type { Message } from '../../types';
import FeedbackPanel, { MAX_COMMENT } from './FeedbackPanel';

type Assistant = Extract<Message, { role: 'assistant' }>;

const config = (over: Partial<ClientConfig['feedback']> = {}): ClientConfig => ({
  feedback: { to: ['feedback@example.invalid'], content: 'full', format: 'text', maxUrlChars: 1900, ...over },
  userRef: 'a1b2c3d4e5f6',
  build: 'test-build',
  contract: '1.4.0',
});
const base: Assistant = { id: 'a1', role: 'assistant', text: '', trace: [], startedAt: 0, endedAt: 1_700_000_000_000, pending: false, question: 'What was the total order value by year?', traceId: 'trace-made-up-123', turn: 1 };
const answered: Assistant = {
  ...base,
  text: 'Order value was **42**.',
  result: { answer: 'Order value was **42**.', columns: [], rows: [], totalRows: 0, charts: [], chartSpec: null, sources: [{ spaceId: 's', spaceName: 'Fake orders', question: 'q', sql: 'SELECT 42', messageId: 'msg-1', conversationId: 'conv-1' }], suggestedQuestions: [] },
};
const failed: Assistant = { ...base, error: 'x', failure: { kind: 'source', title: "Couldn't get the data", detail: 'The data sources did not answer.', retryable: true, reference: 'trace-made-up-123' } };
const outOfScope: Assistant = { ...base, text: "That's outside what I can help with.", result: { ...answered.result!, answer: "That's outside what I can help with.", sources: [] } };

let clicked: string[];
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  clicked = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this.download ? `download:${this.download}` : this.href);
  });
  fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  URL.createObjectURL = vi.fn(() => 'blob:made-up');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const beaconBody = () => JSON.parse(String((fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/feedback/opened'))?.[1] as RequestInit).body));

describe('FeedbackPanel', () => {
  it.each([['an answer', answered], ['an error turn', failed], ['an out-of-scope reply', outOfScope]])('shows Send feedback under %s', (_name, m) => {
    render(<FeedbackPanel message={m} config={config()} chatId="chat-1" />);
    expect(screen.getByRole('button', { name: /Send feedback/ })).toBeTruthy();
  });

  it('is hidden when no address is configured, before the config is in, and while the answer is running', () => {
    const { container: a } = render(<FeedbackPanel message={answered} config={config({ to: null })} chatId="chat-1" />);
    const { container: b } = render(<FeedbackPanel message={answered} config={null} chatId="chat-1" />);
    const { container: c } = render(<FeedbackPanel message={{ ...answered, pending: true }} config={config()} chatId="chat-1" />);
    expect([a, b, c].every((x) => x.innerHTML === '')).toBe(true);
  });

  it('opens and closes the panel; one chip at a time, shown with aria-pressed', () => {
    render(<FeedbackPanel message={answered} config={config()} chatId="chat-1" />);
    fireEvent.click(screen.getByRole('button', { name: /Send feedback/ }));
    const wrong = screen.getByRole('button', { name: 'Wrong numbers' });
    const slow = screen.getByRole('button', { name: 'Too slow' });
    fireEvent.click(wrong);
    expect(wrong.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(slow);
    expect(wrong.getAttribute('aria-pressed')).toBe('false');
    expect(slow.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Too slow' })).toBeNull();
  });

  it('limits the comment to 300 characters', () => {
    render(<FeedbackPanel message={answered} config={config()} chatId="chat-1" />);
    fireEvent.click(screen.getByRole('button', { name: /Send feedback/ }));
    const box = screen.getByLabelText('Add a comment (optional)') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'c'.repeat(400) } });
    expect(box.value.length).toBe(MAX_COMMENT);
  });

  it('Open email opens the mailto link and counts it by type, never sending the comment', async () => {
    render(<FeedbackPanel message={answered} config={config()} chatId="chat-1" />);
    fireEvent.click(screen.getByRole('button', { name: /Send feedback/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Wrong numbers' }));
    fireEvent.change(screen.getByLabelText('Add a comment (optional)'), { target: { value: 'secret remark' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open email' }));
    expect(clicked).toHaveLength(1);
    expect(clicked[0]).toMatch(/^mailto:feedback@example\.invalid\?subject=/);
    const body = decodeURIComponent(clicked[0].split('&body=')[1]);
    expect(body).toContain('[x] Wrong numbers');
    expect(body).toContain('Comment: secret remark');
    expect(body).toContain('Feedback ref : trace-made-up-123');
    expect(body).toContain('Chat id      : chat-1');
    expect(body).toContain('Genie ids    : conv-1/msg-1');
    expect(body).not.toContain('SELECT 42');
    expect(beaconBody()).toEqual({ traceId: 'trace-made-up-123', turn: 1, format: 'text', reason: 'wrong_numbers' });
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('secret remark');
    expect(screen.getByRole('status').textContent).toMatch(/Opening your email app\. If it did not open, write to feedback@example\.invalid and quote ref trace-ma\./);
  });

  it('with the eml format, downloads a draft instead', () => {
    render(<FeedbackPanel message={answered} config={config({ format: 'eml' })} chatId="chat-1" />);
    fireEvent.click(screen.getByRole('button', { name: /Send feedback/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Download draft' }));
    expect(clicked).toEqual(['download:feedback-trace-ma.eml']);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:made-up');
    expect(beaconBody()).toMatchObject({ format: 'eml', reason: 'other' });
    expect(screen.getByRole('status').textContent).toContain('Draft downloaded');
  });

  it('a failing count never breaks the click', () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    render(<FeedbackPanel message={failed} config={config()} chatId="chat-1" />);
    fireEvent.click(screen.getByRole('button', { name: /Send feedback/ }));
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Open email' }))).not.toThrow();
    expect(clicked).toHaveLength(1);
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
