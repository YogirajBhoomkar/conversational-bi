# Lift report: Conversational BI

Where the work to make Conversational BI production ready and movable into GC's platform stands, what was checked, and what is still needed. As of 5 November 2026.

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

## Verified

- Type check clean, server 126 tests and UI 17 tests passing, Mastra build and UI build successful.
- The built server was started with test settings: health and readiness, the version route, the 413 body limit, the 400 validation, security headers, structured log lines, and a failed turn answering the user with a reference while the log holds the cause (and no secret).
- The demo page (port 1977) streamed a question through to the server.
- `lift.mjs` against a scratch repository: dry run, copy, refusal on uncommitted changes, refusal on existing files; no `.env` or database file is ever copied.

## Not verified

- **The Docker image.** Docker is not installed on the development machine; the Dockerfile has not been built.
- **The NestJS templates.** They are not compiled here; they need GC's guard, token service and paths.
- **A live run against Databricks after the latest changes** (multiple charts, streaming, the scratchpad, answer style). This needs a run with real settings: rebuild, `npm start`, and ask questions in a new chat.
- **Shutdown under a real SIGTERM.** The logic is unit-tested; a signal-driven test on Linux (the pod) is still to do.

## Phase 5 in detail (proposed)

Today four pieces of state live in plain maps in the process memory: login sessions (local mode), Genie conversation ids per thread and space, the last result per thread and space (for "show all rows"), and the recent turns used for follow-up questions. Mastra's own storage and the conversation memory are LibSQL files in the build folder (`mastra.db`, `bi-memory.db`).

Problems:

1. The maps never shrink. A long-running pod grows with every conversation.
2. With more than one pod, a follow-up question that lands on another pod loses its Genie conversation and its memory.
3. The database files sit in `.mastra/output`, so every rebuild deletes them, and a container writes to its image folder.

The plan:

| Step | What |
|---|---|
| 5.1 | One `StateStore` implementation in memory (the port exists): entries expire after 8 hours without use, at most 5,000 threads (least recently used dropped first), a sweep timer that does not keep the process alive. All four maps move behind it |
| 5.2 | `BI_STORAGE_URL` and `BI_MEMORY_URL` settings for Mastra's storage and the conversation memory. Locally: files in `server/data/` (outside the build folder). In GC: in memory by default, or a database URL |
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
3. Push: 27 local commits are not pushed yet.

From GC (details in `OPEN-QUESTIONS.md`):

1. Which NestJS app hosts the core (Node 22), and GC's guard and token service names.
2. The model endpoint.
3. Space ids, names and descriptions per environment, and who owns the domain rules.
4. Session affinity, or a shared store for conversation state.
5. The ingress must not buffer the answer stream.
