# Onboarding docs: plan (Phase 0)

This is the plan for the onboarding docs. It is for review. No other onboarding docs exist yet.

Every claim below comes from a file I read. Paths are relative to the repo root. Nothing was run, installed or built for this plan.

## What the app does (one paragraph)

Conversational BI is a chat app for business questions about reinsurance placements and reinsurer capacity. A user types a question, for example "Chart FOT premium by region". The server hands the question to a supervisor AI agent (built with Mastra). The supervisor picks a specialist agent. The specialist asks a Databricks Genie space, which runs SQL and returns rows. The server turns the rows into a table and, when asked, a chart. The browser shows a short written answer, the chart, a sortable table, the SQL that ran, and suggested follow-up questions. The numbers always come from Genie, never from the AI model (`server/src/mastra/agents/index.ts`, supervisor `instructions`). In production one Node process serves both the API and the built UI (`server/src/mastra/index.ts`, `serveUi`).

## Tech stack

| Layer | Technology | Version | Where it is set |
|---|---|---|---|
| Server runtime | Node.js, ES modules, TypeScript | TypeScript 5.9.3 (installed). Node: README says "20 or newer"; no `engines` field or version file found | `server/package.json`, `server/tsconfig.json`, `README.md` |
| Agent framework | Mastra (`@mastra/core`, `mastra` CLI) | 1.79.0 / 1.35.0 | `server/package.json` |
| Agent memory and storage | `@mastra/memory`, `@mastra/libsql` (SQLite files) | 1.39.0 / 1.27.0 | `server/src/mastra/agents/index.ts`, `server/src/mastra/index.ts` |
| AI model | Anthropic Claude (default `claude-sonnet-5-5`), or any OpenAI-compatible endpoint via `LLM_BASE_URL` | `@ai-sdk/anthropic` 4.0.89 | `server/src/mastra/agents/index.ts` (`model()`) |
| Data source | Databricks Genie (Conversation API, or Agent mode when `GENIE_MODE=agent`) | n/a (hosted service) | `server/src/genie/client.ts`, `server/src/genie/agentClient.ts` |
| Validation | zod | 4.6.7 | `server/src/contracts.ts` |
| Server tests | vitest | 3.2.7 | `server/package.json` |
| Browser app | React, Vite, TypeScript | 19.3.1 / 7.3.7 / 5.9.3 | `ui/package.json`, `ui/vite.config.ts` |
| Charts | Recharts (on), Plotly and D3 (switchable) | 3.10.1 / 4.2.0 / 7.9.0 | `ui/src/charts/index.ts`, `ui/package.json` |
| Login | Databricks OAuth (authorization code + PKCE), or a shared token in dev | n/a | `server/src/auth/oauth.ts`, `server/src/auth/sessions.ts` |
| Launcher | One Node script: setup, build, start | n/a | `run.mjs`, root `package.json` |

Not found in the repo: Dockerfile, Helm chart, CI/CD workflow, git history, lint or format config, a UI test setup. See [open questions](#first-open-questions).

## Repo map

| Folder or file | What lives there |
|---|---|
| `run.mjs`, `package.json` | The `npm run setup / build / start` launcher |
| `server/` | The Mastra server: agents, tools, HTTP routes, Genie clients, login |
| `server/src/mastra/index.ts` | The main file. Creates the `Mastra` object, all HTTP routes and the static UI server |
| `server/src/mastra/agents/index.ts` | The supervisor agent, one agent per Genie space, and the follow-up agent |
| `server/src/mastra/tools/askGenie.ts` | The two tools the Genie agents can call: ask a question, and load the full result |
| `server/src/mastra/chartSpec.ts` | Turns Genie's chart JSON into a library-neutral chart spec |
| `server/src/mastra/collector.ts`, `suggest.ts` | The side channel that carries rows, SQL and chart to the UI, and the follow-up question writer |
| `server/src/genie/` | Genie clients (two modes), the list of Genie spaces, and in-memory conversation tracking |
| `server/src/auth/` | OAuth login, in-memory sessions, token providers |
| `server/src/contracts.ts` | The shared data shapes (zod schemas and TypeScript types) |
| `server/scripts/smoke-genie.ts` | A manual script that calls Genie directly |
| `ui/` | The React app |
| `ui/src/App.tsx`, `components.tsx`, `api.ts`, `types.ts` | The page, the display pieces, the streaming API call, and the data types |
| `ui/src/charts/` | One file per chart library, plus `index.ts` (the one-line switch) |
| `docs/` | Older docs (five Markdown files and `code-guide.html`). They exist already and are not part of this task |
| `docs/onboarding/` | These docs |

## Planned docs

I kept your list and adjusted it to this repo.

| File | Change from your list |
|---|---|
| 01-start-here.md | As planned. "Last verified" line needs a commit id, but there is no git repo (see open questions) |
| 02-big-picture.md | As planned |
| 03-repo-map.md | As planned. The repo is small (about 2,100 lines of TypeScript and CSS), so this stays short |
| 04-run-it-locally.md | As planned. Env variable names only |
| 05-request-journey.md | As planned. Uses the worked example below |
| 06-backend.md | Adjusted. There are no controllers, guards or interceptors. It covers the HTTP routes in `mastra/index.ts`, the SSE stream, error handling, and "how to add a route" |
| 06a-agents-and-tools.md | **New.** The supervisor, Genie sub-agents, tools, the collector, and "how to add a Genie space" |
| 07-frontend.md | Adjusted. There is no router or state library. It is one page with React `useState` |
| 07a-charts.md | **New.** The chart pipeline and how to switch chart libraries |
| 08-auth-and-access.md | As planned. Covers OAuth + PKCE, sessions, and the shared-token dev mode. No roles or permissions exist in the app. Access is whatever the user's Databricks account allows |
| 09-data.md | Adjusted. There is no database model. It covers the shapes in `contracts.ts`, the SQLite files, in-memory stores, and the Genie integration |
| 10-config-and-secrets.md | As planned. No feature flags found (only `GENIE_MODE`, which acts like one) |
| 11-build-test-deploy.md | **Thin.** Only build and test can be confirmed. Deployment is unknown from the repo |
| 12-logging-and-monitoring.md | **Thin.** Only `console.warn` calls found. No tracing or dashboard config |
| 13-how-to-contribute.md | **Thin on process.** Branch and PR flow is unknown. The two recipes (add an endpoint, add a UI piece) come from real code |
| 14-gotchas.md | As planned |
| 15-glossary.md | As planned |
| 16-first-week.md | As planned. Starter tasks are chosen in Phase 3 |
| 99-open-questions.md | As planned. Created at the end of the first batch |

## Main worked example for 05-request-journey.md

The first starter button in the UI: **"Chart FOT premium by region"** (`ui/src/App.tsx`, `STARTERS`).

1. The browser: `Chat.send` in `ui/src/App.tsx` calls `streamChat` in `ui/src/api.ts`. It sends `POST /bi/chat` with `{ threadId, message }`.
2. The server: `chatRoute` in `server/src/mastra/index.ts` checks who the caller is (`authenticate`), then creates a fresh `collector` and a `RequestContext`.
3. The supervisor agent runs (`supervisor.stream`). Its instructions route placement and FOT premium questions to `genie_placement` (`server/src/mastra/agents/index.ts`).
4. The `genie_placement` agent calls the tool `ask-placement` (`server/src/mastra/tools/askGenie.ts`).
5. The tool calls `client.ask` (`server/src/genie/client.ts` or `agentClient.ts`). That calls Databricks Genie and sends progress lines back to the browser as `thinking` events.
6. Genie answers a chart request with one cell of chart JSON. `parseGenieChartJson` (`server/src/mastra/chartSpec.ts`) turns it into a real table and a `ChartSpec`. Both go into the collector.
7. The supervisor writes a short answer. The route builds a `final` event from the collector (rows, SQL, chart spec, sources) and streams it. Then it may send a `suggestions` event (`server/src/mastra/suggest.ts`).
8. The browser: `streamChat` parses each `data:` line. `Details` in `ui/src/components.tsx` draws the chart through `ui/src/charts/index.ts`, plus the table, the SQL and the follow-up buttons.

I will also draw the login flow (`/auth/login`, `/auth/callback`) as a second sequence diagram in doc 08.

## First open questions

These will move to `99-open-questions.md`.

1. **No git repository.** `git log` and commit ids are unavailable, and the branch and PR flow cannot be confirmed. What should the "last verified" line use instead? Who owns branching rules? (Checked: no `.git` folder, no `CODEOWNERS`, no PR template.)
2. **No deployment files.** No Dockerfile, Helm chart or CI workflow in the repo. How does this reach dev, QC and prod? (Checked: file listing of the whole repo.) Likely owner: the platform or DevOps team.
3. **README and code disagree.** `README.md` says the supervisor delegates to a `chart_agent`. The code has no such agent. Charts are built in plain code (`server/src/mastra/chartSpec.ts`). I will treat the code as correct. Please confirm.
4. **Hard-coded fallback Genie space IDs** in `server/src/genie/registry.ts`. They are used when the env variables are unset. Is that intended, and are these IDs safe to keep in source? (I will not copy them into the docs.)
5. **Where do the SQLite files end up?** Code uses `file:./mastra.db` and `file:./bi-memory.db` (relative paths). README says they sit "next to the running server". I could not confirm where `mastra start` puts them, since the working folder differs between `mastra dev` and the built output.
6. **Node version.** README says 20 or newer. There is no `engines` field or `.nvmrc`. Which version does the target environment run?
7. **Which Genie mode runs in production?** `GENIE_MODE=agent` uses a Beta API (`server/src/genie/agentClient.ts`). Is it expected in prod?
8. **Env variables missing from `server/.env.example`.** The code reads `GENIE_ROW_CAP`, `GENIE_TIMEOUT_MS`, `GENIE_FULL_ROW_CAP`, `GENIE_CAPACITY_SPACE_ID` (as `DATABRICKS_GENIE_CAPACITY_SPACE_ID`), `DATABRICKS_REDIRECT_URI`, `PORT`, `UI_DIST`, `LLM_*` and `ANTHROPIC_*`. Some are not in the example file. I will list the ones I can confirm from code and flag the rest.
9. **Session and conversation state is in memory** (`server/src/auth/sessions.ts`, `server/src/genie/conversations.ts`). It is lost on restart and cannot be shared by two server copies. Is production meant to run a single copy?
10. **Logging and monitoring.** I found only `console.warn` and `console.error` calls. Is there a log or tracing setup outside this repo?
11. **Cookie `Secure` flag.** It is set only when the request URL is `https` (`server/src/mastra/index.ts`, `/auth/callback`). Behind a proxy that ends TLS, the server may see `http`. I cannot confirm how prod is fronted.
12. **CORS is fixed to `http://localhost:5173`** (`server/src/mastra/index.ts`, `cors.origin`). Is the UI always served from the same origin in prod?
13. **Existing `docs/` folder.** It overlaps with the new docs. `docs/code-guide.html` still describes Vega-Lite charts, which were removed. Should the new docs link to the old ones, replace them, or stay separate?
14. **Who to ask.** No owners are named in the repo. Doc 16 needs a "who to ask" section.

## Notes on how I will work

- I did not open `server/.env`. It holds secrets. The docs will use `server/.env.example` for variable names only.
- Test status: four test files exist (`server/src/auth/auth.test.ts`, `server/src/genie/client.test.ts`, `server/src/genie/agentClient.test.ts`, `server/src/mastra/chartSpec.test.ts`). There are no UI tests. I will not run tests during the doc work.

## Waiting for your review

I have stopped here. Tell me if you want any change to the doc list or the worked example, and answer any open question you can. Then I will write batch 1 (docs 01 to 05, plus `99-open-questions.md`).
