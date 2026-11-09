// The reply check: a Genie reply that is text only is not a data answer. The supervisor prompt keeps off-topic questions
// away from the data agents (SCOPE in core/agents/prompts.ts), but a model can still be talked into delegating one, and
// a Genie space will then answer a joke with a joke. This is the deterministic backstop: no model call.
//
// It applies when all of these hold: at least one Genie call was made this turn, every call succeeded, none returned
// SQL or rows, and no question went back to the user. A query that ran and found zero rows has SQL, so it is a real
// "no data found" answer and is kept. A failed Genie call is left to the output guard's no-data message; a failed turn
// never reaches this check. BI_GUARD_SCOPE: enforce replaces the answer with the scope message, log only records it,
// off does nothing.
import type { Clarification, GenieResult } from '../../contracts';
import { isDataResult } from '../chat/collector';
import { log } from '../log';

export type ScopeGuardMode = 'off' | 'log' | 'enforce';
export type ScopeGuard = { mode: ScopeGuardMode; message: string; check(results: GenieResult[], clarification?: Clarification): 'keep' | 'replace' };

export const textOnlyReply = (results: GenieResult[], clarification?: Clarification) =>
  results.length > 0 && !clarification && results.every((r) => !r.error) && !results.some(isDataResult);

export function createScopeGuard(mode: ScopeGuardMode, message: string): ScopeGuard {
  return {
    mode,
    message,
    check(results, clarification) {
      if (mode === 'off' || !textOnlyReply(results, clarification)) return 'keep';
      // Counts only: the question and Genie's text stay out of the log.
      const fields = { genieCalls: results.length, mode };
      if (mode === 'log') {
        log().warn('guard.scope.flagged', fields);
        return 'keep';
      }
      log().warn('guard.scope.replaced', fields);
      return 'replace';
    },
  };
}
