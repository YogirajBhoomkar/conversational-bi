// Decides whether a new question may start, and counts the ones running. Shared by every host (the Mastra routes, a
// NestJS controller), so the rules are the same everywhere:
// - switched off (BI_ENABLED=false) or shutting down: refused, try later (503);
// - the user already has BI_MAX_CONCURRENT_PER_USER running, or the instance BI_MAX_CONCURRENT_TOTAL: refused (429).
// A turn that is let in holds a slot until `release` is called (once; more calls do nothing).
export type AdmissionLimits = { enabled: boolean; maxPerUser: number; maxTotal: number };
export type Refusal = { status: 503 | 429; reason: 'disabled' | 'draining' | 'user-busy' | 'busy'; message: string; retryAfterSeconds: number };
export type Slot = { release(): void };

const REFUSALS: Record<Refusal['reason'], Omit<Refusal, 'reason'>> = {
  disabled: { status: 503, message: 'Conversational BI is switched off for the moment. Please try again later.', retryAfterSeconds: 300 },
  draining: { status: 503, message: 'The service is restarting. Please ask again in a few seconds.', retryAfterSeconds: 5 },
  'user-busy': { status: 429, message: 'You already have questions running. Please wait for one to finish.', retryAfterSeconds: 10 },
  busy: { status: 429, message: 'The service is busy. Please ask again in a moment.', retryAfterSeconds: 10 },
};
const refuse = (reason: Refusal['reason']): Refusal => ({ reason, ...REFUSALS[reason] });

export function createAdmission(limits: AdmissionLimits) {
  const perUser = new Map<string, number>();
  let total = 0;
  let draining = false;

  return {
    admit(userId: string): Slot | Refusal {
      if (!limits.enabled) return refuse('disabled');
      if (draining) return refuse('draining');
      if ((perUser.get(userId) ?? 0) >= limits.maxPerUser) return refuse('user-busy');
      if (total >= limits.maxTotal) return refuse('busy');
      perUser.set(userId, (perUser.get(userId) ?? 0) + 1);
      total++;
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          total--;
          const left = (perUser.get(userId) ?? 1) - 1;
          if (left > 0) perUser.set(userId, left);
          else perUser.delete(userId);
        },
      };
    },
    // From now on nothing new starts; running turns finish (the host waits for them, up to its grace period).
    drain() {
      draining = true;
    },
    // Ready for traffic: false while shutting down. Switched off is still ready (it answers, with a 503 message).
    ready: () => !draining,
    running: () => total,
  };
}

export type Admission = ReturnType<typeof createAdmission>;
export const isRefusal = (a: Slot | Refusal): a is Refusal => 'status' in a;
