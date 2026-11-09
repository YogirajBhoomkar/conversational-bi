// Checks on what reaches the supervisor, before anything streams. Only the supervisor gets them: how sub-agents run
// input processors is not documented, and they only see the question the supervisor writes.
// - UnicodeNormalizer, always: drops control characters and collapses runs of whitespace.
// - Prompt injection, by setting (BI_GUARD_INJECTION): off; log (record a hit, never block); block (stop the turn).
//   It costs one call to the guard model per turn: only the new question is checked (the earlier turns are context
//   the prompt already tells the model not to obey).
//
// Mastra's PromptInjectionDetector cannot report a hit without blocking on every version we support (`onDetection`
// came after 1.32), so it runs inside a small processor of ours: the detector always "blocks", and we catch its abort.
// Then `log` records the hit and lets the question through, and `block` aborts for real, which ends the stream with a
// `tripwire` chunk (handled in core/chat/handleChat.ts).
import { TripWire } from '@mastra/core/agent';
import type { MastraModelConfig } from '@mastra/core/llm';
import { type InputProcessor, PromptInjectionDetector, UnicodeNormalizer } from '@mastra/core/processors';
import { log } from '../log';

export type InjectionMode = 'off' | 'log' | 'block';
export type InputGuardSettings = { injection: InjectionMode; model?: MastraModelConfig; failClosed: boolean };

type ProcessInputArgs = Parameters<PromptInjectionDetector['processInput']>[0];
export type Detector = { processInput(args: ProcessInputArgs): Promise<ProcessInputArgs['messages']> };

export const INJECTION_GUARD_ID = 'injection-guard';
export const GUARD_UNAVAILABLE = 'The input check could not run.';
// The detector's own wording when its model call failed (with errorStrategy 'strict'), as opposed to a detection.
const GUARD_FAILED = /^Prompt injection detection failed/;
const MAX_REASON = 300;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, MAX_REASON);

export function injectionGuard(detector: Detector, mode: Exclude<InjectionMode, 'off'>, failClosed: boolean): InputProcessor {
  const unavailable = (args: ProcessInputArgs, error: unknown) => {
    log().warn('guard.input.error', { processorId: INJECTION_GUARD_ID, error: errorText(error), failClosed });
    return failClosed ? args.abort(GUARD_UNAVAILABLE) : args.messages;
  };
  return {
    id: INJECTION_GUARD_ID,
    name: 'Prompt injection guard',
    async processInput(args: ProcessInputArgs) {
      try {
        return await detector.processInput({ ...args, abort: (reason?: string): never => { throw new TripWire(reason ?? ''); } });
      } catch (e) {
        if (!(e instanceof TripWire) || GUARD_FAILED.test(e.message)) return unavailable(args, e);
        const reason = e.message.slice(0, MAX_REASON);
        if (mode === 'block') return args.abort(reason);
        log().warn('guard.input.flagged', { processorId: INJECTION_GUARD_ID, reason });
        return args.messages;
      }
    },
  };
}

// The supervisor's input processors for the settings.
export function inputGuards(settings: InputGuardSettings, makeDetector = defaultDetector): InputProcessor[] {
  const normalizer = new UnicodeNormalizer({ stripControlChars: true, collapseWhitespace: true });
  if (settings.injection === 'off' || !settings.model) return [normalizer];
  return [normalizer, injectionGuard(makeDetector(settings.model, settings.failClosed), settings.injection, settings.failClosed)];
}

function defaultDetector(model: MastraModelConfig, failClosed: boolean): Detector {
  // `errorStrategy` exists only on newer Mastra versions; older ones always let the question through when the guard
  // model fails (logged by Mastra itself). Passed loosely so the code compiles on both. TODO(GC:mastra-version)
  const onModelError: Record<string, unknown> = failClosed ? { errorStrategy: 'strict' } : {};
  return new PromptInjectionDetector({ model, strategy: 'block', lastMessageOnly: true, ...onModelError });
}
