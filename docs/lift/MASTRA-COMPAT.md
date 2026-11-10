# Mastra version compatibility

For the engineers who merge Conversational BI into GC's monorepo. As of 10 November 2026.

## What we know

**GC runs `@mastra/core` 1.32.1 on Node 22.13 or later, and this repository is pinned to exactly that set** (since 10 November 2026; before, it used 1.79). What is built and tested here is what runs in GC.

| Package | Version | How |
|---|---|---|
| `@mastra/core` | 1.32.1 | dependency |
| `@mastra/libsql` | 1.10.0 | dependency |
| `mastra` (CLI) | 1.7.3 | dev dependency |
| `@mastra/deployer`, `@mastra/server` | 1.32.1 | `overrides` |
| `@mastra/loggers` | 1.1.1 | `overrides` (the CLI would pull 1.3.9) |
| Node | 22.13.0 or later | `engines`; the Docker image is `node:22-alpine` |

Exact versions, no `^`, so an install can never move above GC's set.

| Finding | What we did |
|---|---|
| `server.drainTimeout` does not exist in 1.32's server config: a compile error | Removed. Shutdown is ours (`server/src/edge/mastra/shutdown.ts`) |
| On 1.32, after SIGTERM the process never exits: a pod hangs until killed. The current Mastra handles SIGTERM itself (5 s drain by default, then exit), which would cut running answers short | Our handler refuses new questions, waits up to `BI_SHUTDOWN_GRACE_MS` for running ones, flushes the log and exits; Mastra's own handling is off (`handleShutdownSignals: false`, which 1.32 ignores) |
| Versions must be pinned together, or the server fails **at start-up**, not at install: the `mastra` CLI pulls the newest `@mastra/deployer` and `@mastra/server` (crash: missing `@mastra/core/a2a/v1` export) | Pin both to `@mastra/core`'s version with `overrides` |
| `@mastra/loggers` must be the old one | Pinned to 1.1.1 with an override, so the CLI's own copy is the old one too (checked: install, build, boot and chat pass) |
| Package version counters are independent: `@mastra/memory` 1.32.x is far newer than `@mastra/core` 1.32.x | Match a set by release date, never by number. `@mastra/memory` is no longer a dependency (the UI sends the chat history) |
| `PromptInjectionDetector` in 1.32 has no `onDetection` and no `errorStrategy` | The detector runs inside a processor of ours, so `log` mode works. On 1.32 a failing guard model always lets the question through, so **`BI_GUARD_FAIL_CLOSED` has no effect in GC** |
| Mastra's `engines` field says Node 22.13 or later | Type check, tests, `mastra build`, boot and chat all pass on Node 22.13.0 (GC's minimum) |

Everything else the code uses exists in both: `Agent` with `agents`, `tools` and `inputProcessors`, a plain messages array for `stream`, `totalUsage`, sub-agent `step-finish` chunks inside `tool-output`, `RequestContext`, `registerApiRoute`, `TripWire`, `UnicodeNormalizer`, and the `tripwire` stream chunk (`{ reason, processorId }`).

## The pairing rule

Install one Mastra release set. These move together: `@mastra/core`, `@mastra/deployer`, `@mastra/server`, `@mastra/libsql`, `@mastra/loggers` (if installed) and the `mastra` CLI. Pick the versions published around the same date as GC's `@mastra/core`, and pin `@mastra/deployer` and `@mastra/server` to exactly that `@mastra/core` version. GC's lockfile decides; `lift/deps.manifest.json` (`mastra`) lists the packages and the tested sets.

## Profiles

| Profile (`server/compat/`) | Versions |
|---|---|
| `current.json` | The repository's `package.json`, installed from its lockfile: GC's set, `@mastra/core` 1.32.1 |
| `mastra-1.32.json` | The same set without the lockfile (fresh resolution of everything else); kept to catch a dependency that drifts |

To check another set (a GC upgrade), copy `mastra-1.32.json`, put the new versions in, and run it before changing `package.json`.

## Running the check

From `server/`:

```
node scripts/compat-check.mjs --profile current --node 22.13.0
node scripts/compat-check.mjs --profile mastra-1.32
```

It works in a temporary copy (the repository's `node_modules`, build output and `.env` files are not touched): it applies the versions, installs, type-checks, runs the tests, builds with `mastra build`, boots the build with dummy settings on a free port, and checks `GET /health/live`, `GET /bi/version`, that `POST /bi/chat` streams the model trace first and a friendly `error` for the failing dummy model, and that SIGTERM ends the process within the grace period plus 2 seconds. It prints PASS, FAIL or SKIP per step and exits 1 on a failure. `--keep` leaves the copy for inspection. It needs the npm registry.

## Results, 10 November 2026: the pinned set (Windows development machine)

| Step | `current` (1.32.1 from the lockfile) |
|---|---|
| Install, type check, tests (272, 2 skipped), `mastra build` | PASS |
| Boot, health, version, chat: on Node 26 and on Node 22.13.0 | PASS |
| Type check, tests and `mastra build` run on Node 22.13.0 itself | PASS |
| SIGTERM exit | SKIP: Windows cannot deliver SIGTERM to a handler |

## Results, 9 November 2026 (before the pin; Windows development machine)

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

- SIGTERM on Linux (needs a Linux machine or the Docker image).
- GC's exact patch levels of the other packages, if they differ from the set above; their lockfile is the final word.
- SIGTERM on Linux: the shutdown logic is unit-tested, but the signal-driven check has only been skipped (Windows). Run the script on Linux or in the image.
- Real model and Genie calls on the old set: the check uses a dummy model endpoint and no Databricks.
- Agent-mode Genie streaming on the old set.
