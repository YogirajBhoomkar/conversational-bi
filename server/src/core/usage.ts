// What one chat turn cost: model tokens per agent and the Genie calls it made. The turn runs inside `withMeter`, so
// tools and the Genie client, however deep, record into the turn's meter through `meter()` (as `log()` does for the
// logger), with no global state. Outside a turn `meter()` is a meter nobody reads.
//
// Where the numbers come from (checked against the installed Mastra with stub models):
// - the supervisor: `stream.totalUsage`, which covers its own steps only;
// - each data agent: the `step-finish` chunks of its run, which the supervisor's stream forwards inside `tool-output`
//   chunks of the `agent-<name>` tool call (summed per step, so an agent that fails part-way still reports what it used);
// - the suggester: `generate().usage`.
// Genie's own model use happens inside Databricks and is not reported by its API, so it is not counted.
// When a source does not report, the snapshot says `complete: false` rather than guessing.
import { AsyncLocalStorage } from 'node:async_hooks';

export type Tokens = { inputTokens: number; outputTokens: number };
export type UsageSnapshot = {
  tokens: { total: Tokens; byAgent: Record<string, Tokens>; complete: boolean };
  genie: { calls: number; failed: number; retries: number; totalMs: number };
};

const DELEGATE_PREFIX = 'agent-'; // Mastra exposes a sub-agent to its supervisor as the tool `agent-<name>`

export function createUsageMeter() {
  const byAgent: Record<string, Tokens> = {};
  const delegated = new Map<string, boolean>(); // sub-agent call id -> usage seen
  const unreported = new Set<string>();
  const genie = { calls: 0, failed: 0, retries: 0, totalMs: 0 };

  const add = (agent: string, tokens: Partial<Tokens> | undefined) => {
    if (!tokens || (tokens.inputTokens === undefined && tokens.outputTokens === undefined)) return void unreported.add(agent);
    const sum = (byAgent[agent] ??= { inputTokens: 0, outputTokens: 0 });
    sum.inputTokens += tokens.inputTokens ?? 0;
    sum.outputTokens += tokens.outputTokens ?? 0;
  };

  return {
    add,
    // A model call whose usage could not be read (it failed, or the model did not report it).
    unreported: (agent: string) => void unreported.add(agent),
    // Reads a sub-agent's usage from a chunk of the supervisor's stream; other chunks are ignored.
    observe(chunk: { type: string; payload?: unknown }) {
      const p = chunk.payload as { toolCallId?: string; toolName?: string; output?: { type?: string; payload?: { output?: { usage?: Partial<Tokens> } } } } | undefined;
      if (!p?.toolCallId || !p.toolName?.startsWith(DELEGATE_PREFIX)) return;
      if (chunk.type === 'tool-call' && !delegated.has(p.toolCallId)) delegated.set(p.toolCallId, false);
      if (chunk.type === 'tool-output' && p.output?.type === 'step-finish') {
        add(p.toolName.slice(DELEGATE_PREFIX.length), p.output.payload?.output?.usage);
        delegated.set(p.toolCallId, true);
      }
    },
    genieCall({ durationMs, failed }: { durationMs: number; failed: boolean }) {
      genie.calls++;
      if (failed) genie.failed++;
      genie.totalMs += durationMs;
    },
    genieRetry: () => void genie.retries++,
    snapshot(): UsageSnapshot {
      const parts = Object.values(byAgent);
      const total = { inputTokens: parts.reduce((n, t) => n + t.inputTokens, 0), outputTokens: parts.reduce((n, t) => n + t.outputTokens, 0) };
      const complete = unreported.size === 0 && [...delegated.values()].every(Boolean);
      return { tokens: { total, byAgent: structuredClone(byAgent), complete }, genie: { ...genie } };
    },
  };
}

export type UsageMeter = ReturnType<typeof createUsageMeter>;

const current = new AsyncLocalStorage<UsageMeter>();
const unread = createUsageMeter();

export const meter = (): UsageMeter => current.getStore() ?? unread;
export const withMeter = <T>(m: UsageMeter, fn: () => T): T => current.run(m, fn);
