import { describe, expect, it } from 'vitest';
import { createAdmission, isRefusal, type Slot } from './admission';

describe('createAdmission', () => {
  it('limits questions per user and in total, and frees a slot once, on release', () => {
    const a = createAdmission({ enabled: true, maxPerUser: 2, maxTotal: 3 });
    const first = a.admit('u1') as Slot;
    a.admit('u1');
    expect(a.admit('u1')).toMatchObject({ status: 429, reason: 'user-busy', retryAfterSeconds: 10 });
    a.admit('u2');
    expect(a.admit('u3')).toMatchObject({ status: 429, reason: 'busy' });
    first.release();
    first.release(); // a second release changes nothing
    expect(a.running()).toBe(2);
    expect(isRefusal(a.admit('u1'))).toBe(false);
  });

  it('refuses everything while switched off, but stays ready', () => {
    const a = createAdmission({ enabled: false, maxPerUser: 2, maxTotal: 3 });
    expect(a.admit('u1')).toMatchObject({ status: 503, reason: 'disabled' });
    expect(a.ready()).toBe(true);
  });

  it('refuses new questions once draining, lets running ones finish, and stops being ready', () => {
    const a = createAdmission({ enabled: true, maxPerUser: 2, maxTotal: 3 });
    const running = a.admit('u1') as Slot;
    a.drain();
    expect(a.admit('u2')).toMatchObject({ status: 503, reason: 'draining' });
    expect(a.ready()).toBe(false);
    running.release();
    expect(a.running()).toBe(0);
  });
});
