# 03. Repo map

## What you will learn
- What each folder and file is for.
- Where to put new code.
- The rules that keep the core movable into GC's platform.

## Top level

| Path | What it is |
|---|---|
| `package.json`, `run.mjs` | `npm run setup`, `npm run build`, `npm start` (main UI on 1976, demo page on 1977) |
| `README.md` | The project summary |
| `LIFT_AND_SHIFT.md` | How GC brings this into its monorepo |
| `server/` | The service |
| `ui/` | The chat page |
| `demo-ui/` | A temporary plain page for a client demo; delete the folder and the `DEMO-UI` lines in `run.mjs` to remove it |
| `lift/` | What the lift copies (`LIFT_MANIFEST.txt`), what it needs (`deps.manifest.json`), the Nx `project.json` template |
| `scripts/lift.mjs` | Copies the app into GC's repository (dry run by default) |
| `docs/CONTRACT.md` | The HTTP contract |
| `docs/lift/` | Lift documents: report, open questions, GC configuration, Datadog, baseline |
| `docs/onboarding/` | These docs |

## `server/`

The layers depend in one direction: `edge` and `mastra` use `core`; `core` uses `ports` and `contracts`; `adapters` implement `ports`. `core` never imports an adapter, Mastra's server, or `process.env`.

| Path | What it holds |
|---|---|
| `src/contracts.ts` | The shapes that cross the boundary: requests, stream events, the final answer, charts, Genie results. `CONTRACT_VERSION` |
| `src/contractFiles.ts` | Renders `contracts/*.schema.json` and `contracts/bi.openapi.yaml` from those shapes (`npm run contracts`) |
| `src/config/schema.ts` | Every setting: name, type, default, help text. The single list |
| `src/config/load.ts` | Reads and checks the settings once at start (`loadConfig`); the only place that reads `process.env` |
| `src/config/spaces.ts` | The spaces file, and `BI_SPACE_ID_<KEY>` |
| `src/config/envExample.ts` | Renders `.env.example` from the schema (`npm run env:example`) |
| `src/ports/` | Interfaces the core needs from its host: identity and tokens (`auth.ts`), the request context, the model, the logger, state, time |
| `src/core/service.ts` | `createBiService(config, adapters)`: builds everything; the one entry point for a host |
| `src/core/agents/` | `prompts.ts` (every instruction text, written from the configured spaces), `createAgents.ts` (supervisor, one agent per space, follow-up writer), `askGenie.ts` (the ask and load-all-rows tools) |
| `src/core/chat/` | `handleChat.ts` (one turn as a stream of events, timeout, final answer), `collector.ts` (what tools hand back besides text) |
| `src/core/genie/` | Genie clients (`client.ts` Conversation API, `agentClient.ts` Agent mode), `retry.ts`, `registry.ts`, `conversations.ts` |
| `src/core/chart/chartSpec.ts` | Genie's chart JSON to a chart description |
| `src/core/trace/trace.ts` | The supervisor's stream to scratchpad entries and streamed answer text |
| `src/core/suggest/` | Follow-up questions |
| `src/core/admission.ts` | Who may start a question now (limits, switch-off, shutdown) |
| `src/core/log.ts` | The request logger (`log()`), user hashing |
| `src/core/errors.ts` | `ValidationError`, `AuthError`, `UpstreamError` |
| `src/adapters/local/auth/` | Local Databricks login (OAuth with PKCE), sessions, the shared development token |
| `src/adapters/logging/logger.ts` | The logger: readable lines or JSON, with secrets removed |
| `src/adapters/model.ts` | The model: Anthropic or an OpenAI-compatible endpoint |
| `src/edge/mastra/` | The HTTP layer on Mastra's server: `routes.ts`, `http.ts` (body limit, SSE, error mapping), `security.ts`, `local-dev.ts` (login routes, serving the UI) |
| `src/edge/templates/nest/` | NestJS controller and module templates for hosting in GC |
| `src/mastra/index.ts` | The composition root for `mastra start`: config, adapters, service, routes |
| `src/safety/` | Tests that guard the repository: no secrets, the dependency manifest in sync |
| `config/examples/` | The example spaces file and domain rules |
| `contracts/` | Generated contract files |
| `scripts/` | `env-example.ts`, `contracts.ts`, `smoke-genie.ts` (calls Genie directly) |
| `Dockerfile`, `.dockerignore` | The image |

Tests sit next to the code they test (`*.test.ts`). `src/edge/mastra/chatRoute.characterization.test.ts` pins the whole HTTP behaviour end to end.

## `ui/`

| Path | What it holds |
|---|---|
| `src/main.tsx` | Starts React with the chat page |
| `src/pages/ChatPage/` | The page: header, thread, composer |
| `src/components/` | One folder per component: `TraceView` (scratchpad), `AnswerText` (Markdown), `ChartCard`, `DataTableCard`, `Composer`, `SuggestionChips`, `Message`, ... |
| `src/hooks/useChat.ts` | Sends a question and applies the stream events |
| `src/hooks/useAuthGuard.ts` | Sends a signed-out visitor to the login (local OAuth mode) |
| `src/api/chatApi.ts`, `src/api.ts` | The `fetch` calls and the stream reader |
| `src/chartsUtil/buildFigure.ts`, `src/charts/` | Turning a chart description into a Plotly figure; the type switcher |
| `src/types.ts` | Copies of the server shapes; keep in sync with `server/src/contracts.ts` |
| `src/App.tsx`, `src/components.tsx`, `src/styles.css` | The earlier UI, no longer rendered |

## Where to put new code

| You are adding | Put it in |
|---|---|
| A Genie space | The spaces file and `BI_SPACE_ID_<KEY>`; no code |
| A business rule for the answers | The domain rules file; no code |
| A setting | `server/src/config/schema.ts`, then `BiConfig` in `load.ts`, then `npm run env:example` |
| Behaviour of a turn | `server/src/core/...`, with a test next to it |
| Something the host must provide | A port in `server/src/ports/`, an adapter in `server/src/adapters/` |
| An HTTP route | `server/src/edge/mastra/routes.ts`, and the same in the NestJS controller template |
| A field in the answer or a new event | `server/src/contracts.ts`, `npm run contracts`, `ui/src/types.ts`, `docs/CONTRACT.md` |
| A chart type | `server/src/core/chart/chartSpec.ts` and the UI's chart builder |

## Rules
- Nothing about the business in code. Prompts are written from the configured spaces; a test fails if a business word appears in them.
- `process.env` is read only in `server/src/config/load.ts`.
- Secrets never reach a log, an error message or a test snapshot.

## Key takeaways
- `core` is the product; `edge`, `adapters` and `mastra` attach it to a host.
- Spaces and business rules are configuration.
- Generated files (`.env.example`, `contracts/`) are checked by tests against their source.
