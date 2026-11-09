// Keeps the questions this instance starts at Genie under the workspace's quota. Databricks documents the Genie
// Conversation API at about five new questions per minute per workspace; only the POST that starts a question counts,
// polling does not. The real quota for a workspace is not known here, so it is a setting (BI_GENIE_MAX_PER_MINUTE), and
// with several instances each gets its share ("the workspace quota divided by the number of pods").
// TODO(GC:genie-quota) the workspace's real quota, and whether GC wants a limiter shared across pods.
//
// The interface lets a shared implementation (one budget for all pods) replace the in-process one later.
export interface GenieLimiter {
  // Waits for a free slot and takes it. Rejects with LimiterWaitTooLong when the wait would pass the cap, or with the
  // abort reason when `signal` aborts. `onWait` is called once, before a wait longer than SHOW_WAIT_MS.
  acquire(options?: { signal?: AbortSignal; onWait?: (waitMs: number) => void }): Promise<{ waitedMs: number }>;
  // Genie refused the request (429 or 503): its slot was not used, so it is given back.
  refund(): void;
  // Genie asked to slow down (Retry-After): nobody starts a question for this long.
  pauseFor(ms: number): void;
}

const WINDOW_MS = 60_000;
export const SHOW_WAIT_MS = 2000;
export const WAITING_NOTE = 'Waiting for a free slot…';

export class LimiterWaitTooLong extends Error {
  constructor() {
    super('Genie is busy with other questions right now. Please try again in a minute.');
    this.name = 'LimiterWaitTooLong';
  }
}

export const noLimit: GenieLimiter = { acquire: async () => ({ waitedMs: 0 }), refund() {}, pauseFor() {} };

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const stop = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop);
      resolve();
    }, ms);
    signal?.addEventListener('abort', stop, { once: true });
  });

// A sliding window over the last minute, in this process. `maxPerMinute` 0 means no limit.
export function createGenieLimiter({ maxPerMinute, maxWaitMs }: { maxPerMinute: number; maxWaitMs: number }): GenieLimiter {
  if (maxPerMinute <= 0) return noLimit;
  const starts: number[] = []; // when each slot in the window was taken, oldest first
  let pausedUntil = 0;

  // When the next slot frees up, or now if one is free.
  const nextFree = (now: number) => {
    while (starts.length && starts[0] <= now - WINDOW_MS) starts.shift();
    const windowFree = starts.length < maxPerMinute ? now : starts[starts.length - maxPerMinute] + WINDOW_MS;
    return Math.max(windowFree, pausedUntil);
  };

  return {
    async acquire({ signal, onWait } = {}) {
      const began = Date.now();
      let told = false;
      for (;;) {
        const now = Date.now();
        const at = nextFree(now);
        if (at <= now) {
          starts.push(now);
          return { waitedMs: now - began };
        }
        if (at - began > maxWaitMs) throw new LimiterWaitTooLong();
        if (!told && at - now > SHOW_WAIT_MS) {
          told = true;
          onWait?.(at - now);
        }
        await sleep(at - now, signal); // another waiter may take the slot first; then this one waits again
      }
    },
    refund() {
      starts.pop();
    },
    pauseFor(ms) {
      pausedUntil = Math.max(pausedUntil, Date.now() + ms);
    },
  };
}

// Retry-After is seconds or an HTTP date. Anything else is ignored.
export function retryAfterMs(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

// A fetch for the POST that starts a question: every attempt (retries included) takes a slot first. A refused attempt
// gives its slot back and, with Retry-After, pauses the limiter, so retries wait their turn and are not counted twice.
export function limitedFetch(fetchFn: typeof fetch, limiter: GenieLimiter, onWait?: (waitMs: number) => void): typeof fetch {
  return async (input, init) => {
    await limiter.acquire({ signal: init?.signal ?? undefined, onWait });
    const res = await fetchFn(input, init);
    if (res.status === 429 || res.status === 503) {
      limiter.refund();
      const pause = retryAfterMs(res.headers.get('Retry-After'));
      if (pause !== undefined) limiter.pauseFor(pause);
    }
    return res;
  };
}
