// Graceful shutdown that works on every Mastra version we support, without relying on Mastra to exit. Newer Mastra
// handles SIGTERM itself (5 s drain by default, then exit), older ones do not exit at all, which leaves a pod hanging
// until it is killed. So the composition root turns Mastra's handling off and installs this instead:
//   1. refuse new questions at once (503) and report not ready, so traffic moves to other pods;
//   2. wait until the running answers finish, or BI_SHUTDOWN_GRACE_MS passes;
//   3. log the outcome, flush the log, exit 0. A second signal exits at once (1).
import type { BiLogger } from '../../ports/logger';

export type ShutdownDeps = {
  admission: { drain(): void; running(): number };
  logger: BiLogger;
  graceMs: number;
  exit?: (code: number) => void;
  flush?: () => Promise<void>;
  pollMs?: number;
};

const SIGNALS = ['SIGTERM', 'SIGINT'] as const;
const flushStdout = () => new Promise<void>((resolve) => process.stdout.write('', () => resolve()));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createShutdown({ admission, logger, graceMs, exit = (code) => process.exit(code), flush = flushStdout, pollMs = 100 }: ShutdownDeps) {
  let stopping = false;
  return async (signal: string) => {
    if (stopping) {
      logger.warn('service.forced_exit', { signal, running: admission.running() });
      return exit(1);
    }
    stopping = true;
    admission.drain();
    const started = Date.now();
    logger.info('service.stopping', { signal, running: admission.running(), graceMs });
    while (admission.running() > 0 && Date.now() - started < graceMs) await sleep(Math.min(pollMs, graceMs - (Date.now() - started)));
    const running = admission.running();
    logger[running ? 'warn' : 'info']('service.stopped', { waitedMs: Date.now() - started, running, timedOut: running > 0 });
    await flush();
    exit(0);
  };
}

// Registers the handler for SIGTERM and SIGINT, once per process.
export function installShutdown(deps: ShutdownDeps, proc: Pick<NodeJS.Process, 'on'> = process) {
  const shutdown = createShutdown(deps);
  for (const signal of SIGNALS) proc.on(signal, () => void shutdown(signal));
  return shutdown;
}

// Mastra options that hand signal handling to us. Not in older Mastra's types (which never handle signals), so passed
// as an untyped spread: older versions ignore the key.
export const ownSignalHandling: Record<string, unknown> = { handleShutdownSignals: false };
