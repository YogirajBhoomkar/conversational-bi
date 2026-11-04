import { describe, expect, it, vi } from 'vitest';
import { fetchWithRetry, GenieRunFailed, withRetry } from './retry';

const NO_WAIT = { attempts: 3, baseDelayMs: 0, maxDelayMs: 0 };
const transient = (e: unknown) => e instanceof Error && e.message === 'transient';

describe('withRetry', () => {
  it('retries a failure that clears, and reports each retry', async () => {
    const task = vi.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValue('ok');
    const onRetry = vi.fn();
    expect(await withRetry('t', task, transient, NO_WAIT, onRetry)).toBe('ok');
    expect(task).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not retry a failure it is told not to', async () => {
    const task = vi.fn().mockRejectedValue(new Error('permanent'));
    await expect(withRetry('t', task, transient, NO_WAIT)).rejects.toThrow('permanent');
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('gives up after the last attempt and throws its error', async () => {
    const task = vi.fn().mockRejectedValue(new Error('transient'));
    await expect(withRetry('t', task, transient, NO_WAIT)).rejects.toThrow('transient');
    expect(task).toHaveBeenCalledTimes(3);
  });
});

describe('GenieRunFailed', () => {
  it('is retryable unless it is about access', () => {
    expect(new GenieRunFailed('[PARSE_SYNTAX_ERROR] Syntax error at or near AS').retryable).toBe(true);
    expect(new GenieRunFailed('[INSUFFICIENT_PERMISSIONS] User does not have SELECT').retryable).toBe(false);
  });
});

describe('fetchWithRetry', () => {
  const responses = (...statuses: number[]) => {
    const fn = vi.fn();
    statuses.forEach((s) => fn.mockResolvedValueOnce(new Response('', { status: s })));
    return fn as unknown as typeof fetch & ReturnType<typeof vi.fn>;
  };

  it('repeats a GET after a server error', async () => {
    const fn = responses(503, 502, 200);
    expect((await fetchWithRetry(fn, 'https://h/x', { method: 'GET' }, NO_WAIT)).status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('repeats a POST only when the server did not take it', async () => {
    const throttled = responses(429, 200);
    expect((await fetchWithRetry(throttled, 'https://h/x', { method: 'POST' }, NO_WAIT)).status).toBe(200);
    const failed = responses(500, 200);
    expect((await fetchWithRetry(failed, 'https://h/x', { method: 'POST' }, NO_WAIT)).status).toBe(500);
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it('repeats a GET after a network failure, but not a POST', async () => {
    const get = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValue(new Response('', { status: 200 }));
    expect((await fetchWithRetry(get as unknown as typeof fetch, 'https://h/x', {}, NO_WAIT)).status).toBe(200);
    const post = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(fetchWithRetry(post as unknown as typeof fetch, 'https://h/x', { method: 'POST' }, NO_WAIT)).rejects.toThrow('fetch failed');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('returns the last response when the attempts run out, and leaves other errors alone', async () => {
    const fn = responses(503, 503, 503);
    expect((await fetchWithRetry(fn, 'https://h/x', {}, NO_WAIT)).status).toBe(503);
    const notFound = responses(404);
    expect((await fetchWithRetry(notFound, 'https://h/x', {}, NO_WAIT)).status).toBe(404);
    expect(notFound).toHaveBeenCalledTimes(1);
  });
});
