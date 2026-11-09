import { log } from '../log';
import { meter } from '../usage';

// Genie and the Databricks APIs sometimes fail for reasons that clear on a second try: a 503, a throttled request,
// or SQL that Genie writes badly once. These helpers retry exactly those cases with exponential backoff and jitter.

export type RetryPolicy = { attempts: number; baseDelayMs: number; maxDelayMs: number };

export const retryPolicy = (attempts: number): RetryPolicy => ({ attempts, baseDelayMs: 1000, maxDelayMs: 8000 });

// Databricks refused because a budget, quota or usage limit is used up (for example "You've reached your budget.
// Contact your admin…"). Only an admin raising the limit clears it, so it is never retried, and the user is told in our
// own words (GENIE_LIMIT_MESSAGE), not Databricks'.
export const LIMIT_REACHED = /reached (?:your|the) budget|budget (?:has been |was )?(?:exceeded|exhausted)|quota (?:has been |was )?(?:exceeded|exhausted)|usage limit/i;
export const GENIE_LIMIT_MESSAGE = 'The data service has reached its usage limit, so no data can be fetched right now.';

// Genie reported that its own run failed. Worth another try, unless the failure is about access or a used-up limit,
// which a retry cannot fix.
export class GenieRunFailed extends Error {
  readonly retryable = !/PERMISSION|UNAUTHORI[SZ]ED|FORBIDDEN|INSUFFICIENT/i.test(this.message) && !LIMIT_REACHED.test(this.message);
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 200);

// Runs `task` until it succeeds, fails in a way `isRetryable` rejects, or runs out of attempts; then the last error is thrown.
export async function withRetry<T>(
  label: string,
  task: () => Promise<T>,
  isRetryable: (error: unknown) => boolean,
  policy: RetryPolicy,
  onRetry?: () => void,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await task();
    } catch (error) {
      if (attempt >= policy.attempts || !isRetryable(error)) throw error;
      const wait = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1)) * (0.5 + Math.random() / 2);
      log().warn('retry', { call: label, attempt, waitMs: Math.round(wait), error: errorText(error) });
      meter().genieRetry(); // counted for the turn's log, whichever caller retries
      onRetry?.();
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

// A GET is safe to repeat. A POST is repeated only when the server says it did not take the request, so a question is never sent twice.
const RETRY_STATUS: Record<string, Set<number>> = { GET: new Set([408, 429, 500, 502, 503, 504]), POST: new Set([429, 503]) };

class RetryableStatus extends Error {
  constructor(readonly response: Response) {
    super(`HTTP ${response.status}`);
  }
}

// fetch, retried on the failures above. When the attempts run out, the last response is returned for the caller to report.
export async function fetchWithRetry(fetchFn: typeof fetch, url: string, init: RequestInit, policy: RetryPolicy): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase();
  const statuses = RETRY_STATUS[method] ?? RETRY_STATUS.POST;
  try {
    return await withRetry(
      `${method} ${new URL(url).pathname}`,
      async () => {
        const res = await fetchFn(url, init);
        if (statuses.has(res.status)) throw new RetryableStatus(res);
        return res;
      },
      // A network failure is a TypeError; a timeout (AbortError) is not retried.
      (error) => error instanceof RetryableStatus || (method === 'GET' && error instanceof TypeError),
      policy,
    );
  } catch (error) {
    if (error instanceof RetryableStatus) return error.response;
    throw error;
  }
}
