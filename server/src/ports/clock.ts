// Time, so expiry and caching can be tested without waiting. Production uses Date.now.
export interface Clock {
  now(): number; // milliseconds since the epoch
}

export const systemClock: Clock = { now: () => Date.now() };
