# Lift report: Conversational BI

Where the work to make Conversational BI production ready and movable into GC's platform stands, what was checked, and what is still needed. As of 9 November 2026.

## Status by phase

| Phase | What | Status |
|---|---|---|
| 0 | Baseline and characterization tests | Done |
| 1 | Settings in one checked schema, spaces and business rules as configuration, generated `.env.example`, secret scan | Done |
| 2 | Ports: identity, tokens, model, state, logging, time | Done |
| 3 | Core separated from the HTTP layer, `createBiService`, NestJS templates | Done |
| 4 | Okta and token-exchange adapters | Dropped: GC's own guard and token service are reused (see `OPEN-QUESTIONS.md`) |
| 5 | Bounded state and storage from configuration | Not started; planned below |
| 6 | Structured, redacted logs; trace ids; timings and token counts | Done |
| 7 | Limits, timeouts, health checks, graceful shutdown, safe errors, security headers | Done |
| 8 | Published contract, version route, Dockerfile, lift kit | Done |
| 9 | Golden question set | Later, as agreed |
| 10 | UI portability for embedding | Not started; the contract (`docs/CONTRACT.md`) is ready for it |
| 11 | Verification, this report, README and onboarding | Done; see the documentation note below |

## Production hardening, 9 November 2026

Work on branch `feat/today-hardening` (not pushed). Items 1, 2, 3 and 8 are in the Phase 1 scope; items 4 to 7 are *Proposed* extras the client has not confirmed. Each Proposed item is its own commit and was checked to revert on its own: `git revert` of each one alone applies cleanly, and the type check and all tests pass after it.

| Commit | Item | Proposed? | What |
|---|---|---|---|
| `fec454c` | 1a | no | Spike as a test: an agent with no Memory takes a plain messages array |
| `bb3181b` | 1 | no | The UI sends the chat so far (`history`, contract 1.2.0); Memory, `bi-memory.db` and `@mastra/memory` removed; the prompt rewrites follow-ups into self-contained questions |
| `cb3a82b` | 2 | no | Conversation mode: our follow-ups are written only after `final`, when Genie sent none |
| `4fc4db5` | 3 | no | Tokens per agent, and Genie calls, failures, retries and time, in `chat.turn` |
| `3a7a84b` | 4 | **yes** | Genie limiter: questions started per minute; only the POST that starts one counts |
| `6e89906` | - | no | Refactor: one setting per line in the service wiring, so items 5 to 7 revert separately |
| `78d3886` | 5 | **yes** | Input guards on the supervisor: Unicode normalizer, prompt-injection check (off by default), `tripwire` handling |
| `c01363f` | 6 | **yes** | Output guards: images, links, HTML, URLs and internal names removed; no-data override; the UI renders no images or links |
| `f64e869` | 7 | **yes** | Groundedness check, log only |
| `69f6a14` | 8a | no | Our own graceful shutdown on every Mastra version |
| `aab8b8a` | 8 | no | `compat-check.mjs`, profiles, lift kit notes, `MASTRA-COMPAT.md` |
| (last) | 9 | no | Docs, open questions, this report |

### Spike results

| Spike | Tried | Found | Did |
|---|---|---|---|
| 1a | Supervisor with no Memory, `stream([user, assistant, user])`, stub model | The model gets the messages in order. A delegated sub-agent also gets the supervisor's whole message list (its system prompt too) plus the delegated question | Plain messages array; Memory removed. The prompt still asks for self-contained questions, since the Genie call gets only the question |
| 3a | Stub models with known usage | Suggester: `generate().usage`. Supervisor: `totalUsage` covers its own steps only. Sub-agents: their `step-finish` chunks arrive inside `tool-output` chunks of `agent-<name>` | Read from the stream; no model wrapper (the model is a Mastra router config, not an SDK model). `complete: false` when a source does not report |
| 5 | `PromptInjectionDetector` options on 1.79 and 1.32.1 | 1.32.1 has no `onDetection` and no `errorStrategy`; a failing guard model there always lets the question through | The detector runs inside a processor of ours that catches its abort, so log mode works on both. `BI_GUARD_FAIL_CLOSED` works only on newer Mastra |
| 8 | Mastra's own SIGTERM handling | 1.79 drains 5 s, then exits; 1.32 never exits | Mastra's handling off (`handleShutdownSignals: false`); ours exits |

### Settings added

| Setting | Default | Item |
|---|---|---|
| `BI_HISTORY_TURNS` | 3 | 1 |
| `BI_HISTORY_MAX_CHARS` | 1500 | 1 |
| `BI_HISTORY_INCLUDE_SQL` | false | 1 |
| `BI_MAX_BODY_BYTES` | 65536 (was 16384) | 1 |
| `VITE_HISTORY_TURNS` (UI build) | 3 | 1 |
| `BI_GENIE_MAX_PER_MINUTE` | 5 (0 = off) | 4, *Proposed* |
| `BI_GENIE_QUEUE_WAIT_MS` | 60000 | 4, *Proposed* |
| `BI_GUARD_INJECTION` | off | 5, *Proposed* |
| `BI_GUARD_MODEL` | none (required when on) | 5, *Proposed* |
| `BI_GUARD_FAIL_CLOSED` | false | 5, *Proposed* |
| `BI_GUARD_OUTPUT` | on | 6, *Proposed* |
| `BI_GROUNDING` | log | 7, *Proposed* |

### Where the code differs from the brief

- Item 1: `@mastra/memory` is gone entirely, so the 1.32 profile does not install it. The older `App.tsx` / `api.ts` path is imported but not rendered, so it was left as is; the main and demo pages both send history through `useChat`.
- Item 2: the brief mentions existing skip rules for small talk, clarification and errors; there were none. Now no follow-ups are written for a clarification, and a failed turn never starts them.
- Item 3: Genie retries are counted inside `withRetry`, which covers the question-level and the HTTP-level retries.
- Item 4: the limiter also has `refund()` (a 429 or 503 gives its slot back) and an `onWait` callback for the status line.
- Item 6: an agent or tool name tied to a space is replaced by the space's name instead of removed, so sentences stay readable. Genie text with figures counts as usable data for the no-data override (Genie can answer in text only).

### Verified

- Baseline before the work: server 136 tests in 22 files, UI 19 tests in 2 files, type checks clean, UI build passing.
- Now: server 207 tests in 30 files, UI 24 tests in 4 files; type checks clean; `mastra build`, the UI build and the demo build pass; `.env.example` and the contract files regenerated and in sync; the secret scan finds nothing.
- `compat-check` on both profiles (`current`, core 1.79.0; `mastra-1.32`, core 1.32.1): install, type check, tests, build, boot, `/health/live`, `/bi/version` and the chat check (model trace first, a friendly error for the dummy model) all pass. The current build also boots and answers on Node 20.20.2 (informational).
- Each Proposed commit reverted alone: clean; the type check and the tests pass.
- A follow-up across a simulated restart and a second instance (characterization test: two fresh service instances get the same messages for the same follow-up).
- Earlier: `lift.mjs` against a scratch repository (dry run, copy, both refusals; no `.env` or database file copied), and the demo page streaming through to the server.

### Not verified

- **No live Genie and no real model calls** for any of today's work: everything ran against stub models, fake streams and a dummy model endpoint.
- **SIGTERM on Linux.** Windows cannot deliver SIGTERM to a handler, so the compat check skips that step; the shutdown logic is unit-tested with fake timers only.
- **The client environment** and GC's real Mastra versions.
- **The guard model's judgement.** The injection tests use a stub detector; whether a real small model flags the fixture questions is untested.
- **The Docker image** (Docker is not installed) and **the NestJS templates** (not compiled here).
- Agent-mode Genie on the old Mastra set; the 1.32 profile on Node 20.
- Mastra prints its own `[WORKFLOW] Error executing step…` line to the console when an input guard blocks; it holds the reason, not the question.

## Scope guard: off-topic questions, 9 November 2026

Seen in real use: "Tell me a joke" went to a Genie space, Genie answered with a joke, it was shown as the answer, and follow-ups were written for it. Rule now: a question is in scope only if one of the configured Genie spaces can answer it. Scope comes from the spaces configuration (names, descriptions, routing), never from words in code. Phase 1 scope; branch `feat/scope-guard` (from `feat/today-hardening`, not pushed), two commits:

| Commit | What |
|---|---|
| `4e14bad` (A) | A SCOPE section in the supervisor prompt. A greeting, thanks and "what can you do" are answered without a data agent. Anything else that needs no data gets the **scope message** and no agent or tool call. A mixed question gets the data part answered and one sentence declining the rest. When unsure, the supervisor asks back instead of refusing. Follow-ups are judged with the earlier turns. The scope message is built from the spaces: "I can help with questions about <name> (<short phrase from its description>) … Ask me something about that data." No follow-ups, ours or Genie's, for a turn without a Genie result that has SQL or rows |
| (B) | The reply check (`core/guards/scope.ts`). It applies when Genie was called, every call succeeded, none returned SQL or rows, and no question went back to the user. The answer is then replaced with the same scope message (`text-reset`, then the message), with no table, charts or sources. No model call. Logs `guard.scope.replaced` or `guard.scope.flagged` with counts only, and `outOfScope: true` in `chat.turn` |

Settings:

| Setting | Default | What |
|---|---|---|
| `BI_SCOPE_MESSAGE` | built from the spaces | Replaces the scope message, in the prompt and the reply check alike |
| `BI_GUARD_SCOPE` | enforce | `enforce` replaces a text-only Genie reply, `log` only records it, `off` does nothing |

Behaviour that changed:

- **Follow-ups:** written only for a turn that got data. Before, every turn except a clarification or a failure got them.
- **Agent mode follow-ups:** they used to start before the supervisor ran. They now start as soon as the first data result comes back, still in parallel with the answer.
- **Text-only Genie replies:** shown as the answer before; now replaced, in every Genie mode. This includes a legitimate one (see below).
- **Small talk:** the prompt no longer answers small talk other than greetings and thanks.
- **Failed Genie calls:** left alone by the scope check. The output guard's "couldn't get data" message still applies, so a time-out is not answered with "ask me something about the data".

Where the code differs from the brief: the reply check also needs every Genie call to have succeeded.

Tests:
- **Fixtures:** in one place (`core/guards/scopeFixtures.ts`).
- **Prompt level (`core/agents/scope.test.ts`):**
  - The real agents with a scripted stub model and a fake Genie.
  - The five off-topic questions get the scope message, with no Genie call and no follow-ups.
  - A data question and a follow-up that needs the earlier turn are delegated.
  - "hello", "thanks" and "what can you do" are answered without Genie.
  - The mixed question keeps its data.
  - The message differs for two and five spaces, and the override works.
- **Guard level (`core/guards/scope.test.ts`):**
  - A text-only reply is replaced.
  - Kept: zero rows with SQL, a clarification (tool or text), a failed turn, a failed Genie call.
  - `log` and `off` leave the answer.
  - No follow-ups for a replaced turn (both Genie modes) or a greeting.
- **Characterization:** one new test, through the real configuration: the default `enforce`, the message built from the spaces, `BI_SCOPE_MESSAGE` and `off`.
- **Counts:** server 246 tests in 32 files (was 207 in 30); type check clean; `.env.example` regenerated.
- **`compat-check` on both profiles** (`current`, core 1.79.0; `mastra-1.32`, core 1.32.1): install, type check, tests (244 passed, 2 skipped because the copy is not a git checkout), `mastra build`, boot, health, version and the chat check all pass. SIGTERM is skipped on Windows, as before.

Not verified (no live Genie or model):

- **Whether a real model follows the SCOPE section.** The stub plays the model, so the tests show the rule is in the prompt and that each reply flows through correctly, not that the model obeys it. This needs a run of the fixture questions against the real model.
- **How the real Genie spaces reply to off-topic questions:** text only (replaced), a refusal (also text only, so replaced with our message), or an attempted query (kept, because it has SQL).
- **Whether a legitimate text-only reply gets replaced.** Genie can answer in text without a query, for example a definition from the space's instructions or "this space has no data on that". Under `enforce` those become the scope message. If that shows up in UAT, `BI_GUARD_SCOPE=log` keeps the answers and still counts them (`guard.scope.flagged`), to size the problem.
- **The wording of the generated message for the client's real space descriptions.** It takes the part of the first sentence before a colon. A description that starts differently may read oddly; `BI_SCOPE_MESSAGE` is the fix.
- **The Mastra build in place.** `.mastra/output` was locked by a running local server, so the build was checked only inside `compat-check`, in a temporary copy. The UI was not changed, so it was not rebuilt.

Recommendation (needs the client): the owner of each Genie space should add an instruction to the space itself, such as "Answer only questions about this data; for anything else, say you can only answer questions about <the space's subject>." Genie then stops answering off-topic questions at the source, and our check becomes the backstop.

## Phase 5 in detail (proposed)

Three pieces of state live in plain maps in the process memory: login sessions (local mode), Genie conversation ids per thread and space, and the last result per thread and space (for "show all rows"). The last two are best-effort: an instance without them starts a new Genie conversation, and "show all rows" says the full result is not available. The chat history is no longer kept on the server: the UI sends it with each question (contract 1.2.0). Mastra's own storage is a LibSQL file in the build folder (`mastra.db`).

Problems:

1. The maps never shrink. A long-running pod grows with every conversation.
2. With more than one pod, a follow-up that lands on another pod starts a new Genie conversation (the chat history itself now comes with the request).
3. The database files sit in `.mastra/output`, so every rebuild deletes them, and a container writes to its image folder.

The plan:

| Step | What |
|---|---|
| 5.1 | One `StateStore` implementation in memory (the port exists): entries expire after 8 hours without use, at most 5,000 threads (least recently used dropped first), a sweep timer that does not keep the process alive. All three maps move behind it |
| 5.2 | A `BI_STORAGE_URL` setting for Mastra's storage. Locally: files in `server/data/` (outside the build folder). In GC: in memory by default, or a database URL |
| 5.3 | The model chosen by configuration only (already mostly true) |
| 5.4 | A snapshot test of the prompts, so any change to the instruction text is visible in review |
| 5.5 | `docs/lift/STATE.md`: what is kept, where, for how long, and what happens on restart |
| Later | A shared store for several pods (a `StateStore` on GC's MongoDB or Redis). Until then, one pod per user session (session affinity) |

Effect for users: nothing changes on one pod; conversations older than 8 hours start fresh. Effort: about a day.

## Changes made outside the phases (from review of real answers)

- Charts: a chart from one space is no longer lost when another space answers; chart and table queries in Agent mode are paired; every chart of a turn is shown; the same data in another chart type is shown once (the UI switches types); no chart for a single data point; a chart is offered whenever it adds value.
- Streaming: the plan and the answer stream as they are written.
- Scratchpad: one loader, one block per data source, every thought and query in full.
- Answers: shaped by the question (a sentence for a lookup, a list for a ranking, the gap for a comparison) instead of one template.
- Space ids for any number of spaces from `BI_SPACE_ID_<KEY>`.
- A temporary demo page (`demo-ui/`) on its own port.

## Documentation

`README.md`, `LIFT_AND_SHIFT.md`, `docs/CONTRACT.md`, `docs/onboarding/03-repo-map.md` and everything in `docs/lift/` are current. The other onboarding and `docs/0*` pages have their file paths updated and carry a note that some descriptions predate the restructure; they need a content refresh.

## Decisions needed

From us:

1. Phase 5: go ahead as planned above?
2. Phase 10: how the chat page moves into GC's UI (React components in GC's app, or a frame), and who does it.
3. Push: the `feat/today-hardening` branch is not pushed.
4. Items 4 to 7: confirm with the client which Proposed items stay; each can be removed with `git revert`.

From GC (details in `OPEN-QUESTIONS.md`):

1. Which NestJS app hosts the core (Node 22), and GC's guard and token service names.
2. The model endpoint.
3. Space ids, names and descriptions per environment, and who owns the domain rules.
4. Session affinity, or a shared store for conversation state.
5. The ingress must not buffer the answer stream.
6. GC's Mastra versions, the Genie quota and mode, and whether a guard-model call per question is allowed.
7. The space owners: add a "refuse questions that are not about this data" instruction to each Genie space (see the scope guard section).
