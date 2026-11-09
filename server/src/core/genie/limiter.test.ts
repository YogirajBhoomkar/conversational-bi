import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TokenProvider } from '../../ports/auth';
import { DatabricksGenieClient } from './client';
import { createGenieLimiter, LimiterWaitTooLong, limitedFetch, retryAfterMs, WAITING_NOTE } from './limiter';

beforeEach(() => vi.useFakeTimers({ now: 0 }));
afterEach(() => vi.useRealTimers());

const settle = () => vi.advanceTimersByTimeAsync(0);

describe('Genie limiter', () => {
  it('spaces six questions in a minute with a limit of five: the sixth waits for the first slot to free', async () => {
    const limiter = createGenieLimiter({ maxPerMinute: 5, maxWaitMs: 120_000 });
    const startedAt: number[] = [];
    for (let i = 0; i < 6; i++) {
      void limiter.acquire().then(() => startedAt.push(Date.now()));
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(startedAt).toEqual([0, 1000, 2000, 3000, 4000]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(startedAt).toEqual([0, 1000, 2000, 3000, 4000, 60_000]);
  });

  it('tells the caller once when the wait is long', async () => {
    const limiter = createGenieLimiter({ maxPerMinute: 1, maxWaitMs: 120_000 });
    await limiter.acquire();
    const onWait = vi.fn();
    const second = limiter.acquire({ onWait });
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(second).resolves.toEqual({ waitedMs: 60_000 });
    expect(onWait).toHaveBeenCalledOnce();
  });

  it('stops waiting when the turn is cancelled', async () => {
    const limiter = createGenieLimiter({ maxPerMinute: 1, maxWaitMs: 120_000 });
    await limiter.acquire();
    const abort = new AbortController();
    const waiting = limiter.acquire({ signal: abort.signal });
    const outcome = expect(waiting).rejects.toThrow('stop');
    abort.abort(new Error('stop'));
    await outcome;
  });

  it('refuses at once when the wait would pass the cap', async () => {
    const limiter = createGenieLimiter({ maxPerMinute: 1, maxWaitMs: 10_000 });
    await limiter.acquire();
    await expect(limiter.acquire()).rejects.toBeInstanceOf(LimiterWaitTooLong);
  });

  it('pauses everyone for Retry-After', async () => {
    const limiter = createGenieLimiter({ maxPerMinute: 5, maxWaitMs: 120_000 });
    limiter.pauseFor(5000);
    let started = false;
    void limiter.acquire().then(() => (started = true));
    await vi.advanceTimersByTimeAsync(4999);
    expect(started).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(started).toBe(true);
  });

  it('is off with a limit of 0', async () => {
    const limiter = createGenieLimiter({ maxPerMinute: 0, maxWaitMs: 0 });
    for (let i = 0; i < 100; i++) await limiter.acquire();
  });

  it('reads Retry-After as seconds or as a date', () => {
    expect(retryAfterMs('3')).toBe(3000);
    expect(retryAfterMs(new Date(10_000).toUTCString(), 0)).toBe(10_000);
    expect(retryAfterMs('soon')).toBeUndefined();
    expect(retryAfterMs(null)).toBeUndefined();
  });
});

describe('limitedFetch', () => {
  it('gives back the slot of a refused request and pauses for Retry-After, so the retry waits and counts once', async () => {
    const limiter = createGenieLimiter({ maxPerMinute: 1, maxWaitMs: 120_000 });
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const limited = limitedFetch(fetchFn, limiter);
    expect((await limited('https://example.invalid', {})).status).toBe(429);
    let second: Response | undefined;
    void limited('https://example.invalid', {}).then((r) => (second = r));
    await vi.advanceTimersByTimeAsync(1999);
    expect(second).toBeUndefined(); // paused by Retry-After, though its slot was given back
    await vi.advanceTimersByTimeAsync(1);
    expect(second?.status).toBe(200);
  });
});

describe('Conversation API client with a limiter', () => {
  const tokens: TokenProvider = { getToken: async () => 'token' };
  const NO_WAIT = { attempts: 1, baseDelayMs: 0, maxDelayMs: 0 };
  const replies = (url: string) =>
    url.endsWith('/start-conversation')
      ? { conversation_id: 'c', message_id: 'm' }
      : { id: 'm', conversation_id: 'c', status: 'COMPLETED', attachments: [{ text: { content: 'done' } }] };

  it('limits only the POST that starts the question, never polling', async () => {
    const methods: string[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      methods.push(init?.method ?? 'GET');
      return new Response(JSON.stringify(replies(String(url))), { status: 200 });
    }) as unknown as typeof fetch;
    const limiter = { acquire: vi.fn(async () => ({ waitedMs: 0 })), refund: vi.fn(), pauseFor: vi.fn() };
    const client = new DatabricksGenieClient(tokens, { host: 'example.invalid', rowCap: 10, timeoutMs: 60_000, retry: NO_WAIT, fetch: fetchFn, pollDelaysMs: [0], limiter });
    const asked = client.ask({ spaceId: 's', question: 'q', caller: { userId: 'u' } });
    await settle();
    await vi.runAllTimersAsync();
    await asked;
    expect(methods.filter((m) => m === 'GET').length).toBeGreaterThan(0);
    expect(limiter.acquire).toHaveBeenCalledTimes(methods.filter((m) => m === 'POST').length);
  });

  it('answers with a friendly failure, without retrying, when no slot frees in time', async () => {
    const limiter = createGenieLimiter({ maxPerMinute: 1, maxWaitMs: 1000 });
    await limiter.acquire();
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const onProgress = vi.fn();
    const client = new DatabricksGenieClient(tokens, { host: 'example.invalid', rowCap: 10, timeoutMs: 60_000, retry: { attempts: 3, baseDelayMs: 0, maxDelayMs: 0 }, fetch: fetchFn, limiter });
    const result = await client.ask({ spaceId: 's', question: 'q', caller: { userId: 'u' }, onProgress });
    expect(result.error).toMatch(/busy with other questions/);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(onProgress).not.toHaveBeenCalledWith({ kind: 'status', text: WAITING_NOTE });
  });
});
