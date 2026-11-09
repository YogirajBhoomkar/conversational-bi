import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { silentLogger } from '../../core/log';
import { createShutdown, installShutdown } from './shutdown';

beforeEach(() => vi.useFakeTimers({ now: 0 }));
afterEach(() => vi.useRealTimers());

function setup(running: number, graceMs = 25_000) {
  const state = { running, drained: false };
  const exit = vi.fn();
  const admission = { drain: () => void (state.drained = true), running: () => state.running };
  const shutdown = createShutdown({ admission, logger: silentLogger, graceMs, exit, flush: async () => {}, pollMs: 100 });
  return { state, exit, shutdown };
}

describe('shutdown', () => {
  it('stops taking questions at once and exits as soon as the running ones finish', async () => {
    const { state, exit, shutdown } = setup(2);
    void shutdown('SIGTERM');
    expect(state.drained).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(exit).not.toHaveBeenCalled();
    state.running = 0;
    await vi.advanceTimersByTimeAsync(100);
    expect(exit).toHaveBeenCalledWith(0);
    expect(Date.now()).toBeLessThan(2000);
  });

  it('exits at the grace limit with answers still running', async () => {
    const { exit, shutdown } = setup(1, 5000);
    void shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(4900);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('exits at once on a second signal', async () => {
    const { exit, shutdown } = setup(1);
    void shutdown('SIGTERM');
    await shutdown('SIGINT');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits straight away when nothing is running', async () => {
    const { exit, shutdown } = setup(0);
    await shutdown('SIGTERM');
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('listens for SIGTERM and SIGINT', () => {
    const on = vi.fn();
    installShutdown({ admission: { drain() {}, running: () => 0 }, logger: silentLogger, graceMs: 0, exit: vi.fn() }, { on } as never);
    expect(on.mock.calls.map(([signal]) => signal)).toEqual(['SIGTERM', 'SIGINT']);
  });
});
