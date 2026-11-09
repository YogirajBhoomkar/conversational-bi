# Mastra version compatibility

For the engineers who merge Conversational BI into GC's monorepo, where an older Mastra is installed than the one this repository pins. As of 9 November 2026.

## What we know

GC's exact Mastra versions are not known yet (`OPEN-QUESTIONS.md`, `mastra-version`). The public registry has no `@mastra/core` 1.32.9; the closest published version is **1.32.1**, so that set is what we test against.

| Finding | What we did |
|---|---|
| `server.drainTimeout` does not exist in 1.32's server config: a compile error | Removed. Shutdown is ours (`server/src/edge/mastra/shutdown.ts`) |
| On 1.32, after SIGTERM the process never exits: a pod hangs until killed. The current Mastra handles SIGTERM itself (5 s drain by default, then exit), which would cut running answers short | Our handler refuses new questions, waits up to `BI_SHUTDOWN_GRACE_MS` for running ones, flushes the log and exits; Mastra's own handling is off (`handleShutdownSignals: false`, which 1.32 ignores) |
| Versions must be pinned together, or the server fails **at start-up**, not at install: the `mastra` CLI pulls the newest `@mastra/deployer` and `@mastra/server` (crash: missing `@mastra/core/a2a/v1` export) | Pin both to `@mastra/core`'s version with `overrides` |
| `@mastra/loggers` must be the old one | A direct dependency at the old version, not an override |
| Package version counters are independent: `@mastra/memory` 1.32.x is far newer than `@mastra/core` 1.32.x | Match a set by release date, never by number. `@mastra/memory` is no longer a dependency (the UI sends the chat history) |
| `PromptInjectionDetector` in 1.32 has no `onDetection` and no `errorStrategy` | The detector runs inside a processor of ours, so `log` mode works on both. On 1.32 a failing guard model always lets the question through; `BI_GUARD_FAIL_CLOSED` works only on newer versions |
| Mastra's `engines` field says Node 22.13 or later | The build also boots and answers on Node 20.20.2 (informational; not a supported setup) |

Everything else the code uses exists in both: `Agent` with `agents`, `tools` and `inputProcessors`, a plain messages array for `stream`, `totalUsage`, sub-agent `step-finish` chunks inside `tool-output`, `RequestContext`, `registerApiRoute`, `TripWire`, `UnicodeNormalizer`, and the `tripwire` stream chunk (`{ reason, processorId }`).

## The pairing rule

Install one Mastra release set. These move together: `@mastra/core`, `@mastra/deployer`, `@mastra/server`, `@mastra/libsql`, `@mastra/loggers` (if installed) and the `mastra` CLI. Pick the versions published around the same date as GC's `@mastra/core`, and pin `@mastra/deployer` and `@mastra/server` to exactly that `@mastra/core` version. GC's lockfile decides; `lift/deps.manifest.json` (`mastra`) lists the packages and the tested sets.

## Profiles

| Profile (`server/compat/`) | Versions |
|---|---|
| `current.json` | The repository's `package.json`, installed from its lockfile (`@mastra/core` 1.79.0, `mastra` 1.35.0) |
| `mastra-1.32.json` | `@mastra/core` 1.32.1, `@mastra/libsql` 1.10.0, `@mastra/loggers` 1.1.1, `mastra` 1.7.3; overrides `@mastra/deployer` and `@mastra/server` 1.32.1 |

To check GC's set, copy `mastra-1.32.json`, put GC's versions in, and run it.

## Running the check

From `server/`:

```
node scripts/compat-check.mjs --profile mastra-1.32
node scripts/compat-check.mjs --profile current --node 20
```

It works in a temporary copy (the repository's `node_modules`, build output and `.env` files are not touched): it applies the versions, installs, type-checks, runs the tests, builds with `mastra build`, boots the build with dummy settings on a free port, and checks `GET /health/live`, `GET /bi/version`, that `POST /bi/chat` streams the model trace first and a friendly `error` for the failing dummy model, and that SIGTERM ends the process within the grace period plus 2 seconds. It prints PASS, FAIL or SKIP per step and exits 1 on a failure. `--keep` leaves the copy for inspection. It needs the npm registry.

## Results, 9 November 2026 (Windows development machine)

| Step | `current` | `mastra-1.32` |
|---|---|---|
| Install | PASS (core 1.79.0, CLI 1.35.0) | PASS (core 1.32.1, CLI 1.7.3) |
| Typecheck | PASS | PASS |
| Tests | PASS (205, 2 skipped: repository-only checks) | PASS (205, 2 skipped) |
| `mastra build` | PASS | PASS |
| Boot, health, version | PASS | PASS |
| Chat: model trace first, friendly error | PASS | PASS |
| SIGTERM exit | SKIP: Windows cannot deliver SIGTERM to a handler | SKIP |
| Node 20.20.2 boot, health, version, chat (informational) | PASS | not run |

## Still unknown

- GC's real Mastra versions; the check should be run on that set before merging.
- SIGTERM on Linux: the shutdown logic is unit-tested, but the signal-driven check has only been skipped (Windows). Run the script on Linux or in the image.
- Real model and Genie calls on the old set: the check uses a dummy model endpoint and no Databricks.
- Agent-mode Genie streaming on the old set.
