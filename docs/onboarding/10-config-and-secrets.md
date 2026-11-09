# 10. Config and secrets

> **Written before the November 2026 restructure.** File paths are updated, but some descriptions are out of date: routes, login and the chat turn are no longer in `server/src/mastra/index.ts` (now only the wiring), spaces and their ids are configuration, and settings are read once in `server/src/config`. Current layout: [03-repo-map.md](03-repo-map.md). Settings: `server/.env.example`.

## What you will learn
- Every setting the code reads (names only).
- Which ones are secrets.
- Where settings come from.
- Which settings change behaviour like a feature flag.
- Which settings are missing from the example file.

No values appear in these docs. Use placeholders.

## Where settings come from

- A file `server/.env`, loaded by `import 'dotenv/config'` at the top of `server/src/mastra/index.ts`, and by `mastra start --env .env` in `run.mjs`.
- The shell environment. Values set there are used by the code the same way.
- `server/.env` is git-ignored (`.gitignore`: `.env`, `.env.*`, but `!.env.example`).
- `npm run setup` copies `server/.env.example` to `server/.env` if it is missing (`run.mjs`).

There is only one config source. I found no per-environment config files (dev, QC, prod) in the repo. How each environment gets its settings is unknown. See [99-open-questions.md](99-open-questions.md).

## Settings found in the code

I listed these by searching the source for `process.env`. "Secret" means: do not log it, do not commit it, do not paste it into chat.

| Name | Secret? | Purpose | Default | Where read |
|---|---|---|---|---|
| `DATABRICKS_SERVER_HOSTNAME` | no | Databricks host. Required | none (throws if unset) | `genie/client.ts`, `genie/agentClient.ts`, `auth/oauth.ts` |
| `DATABRICKS_TOKEN` | **yes** | Shared token for dev mode | none (throws if used and unset) | `auth/tokenProvider.ts` |
| `DATABRICKS_CLIENT_ID` | no | Turns on per-user OAuth when set | unset (dev mode) | `auth/oauth.ts` |
| `DATABRICKS_REDIRECT_URI` | no | Overrides the OAuth callback address | `http://localhost:<PORT>/auth/callback` | `auth/oauth.ts` |
| `BI_SPACE_ID_PLACEMENT` | no | Placement Genie space | a fallback id in code | `genie/registry.ts` |
| `BI_SPACE_ID_CAPACITY` | no | Capacity Genie space | a fallback id in code | `genie/registry.ts` |
| `GENIE_MODE` | no | `agent` selects Agent mode. Anything else is the Conversation API | unset | `mastra/index.ts` |
| `GENIE_ROW_CAP` | no | Rows kept per result | 200 | `genie/client.ts`, `genie/agentClient.ts` |
| `GENIE_TIMEOUT_MS` | no | Max wait for Genie | 180000 | same |
| `GENIE_RETRY_ATTEMPTS` | no | How many times a Genie call is tried before giving up, with backoff between tries | 3 | `genie/retry.ts` |
| `SUGGEST_WAIT_MS` | no | After the answer, max wait for our own follow-up questions before the stream closes | 8000 | `mastra/index.ts` |
| `GENIE_FULL_ROW_CAP` | no | Max rows when loading the full result | 5000 | `mastra/tools/askGenie.ts` |
| `ANTHROPIC_API_KEY` | **yes** | Lets the model library call Claude | none | read by the AI library, not by repo code |
| `ANTHROPIC_MODEL` | no | Model name | `claude-sonnet-5-5` | `mastra/agents/index.ts` |
| `LLM_BASE_URL` | no | Use an OpenAI-compatible endpoint instead of Anthropic | unset | `mastra/agents/index.ts` |
| `LLM_API_KEY` | **yes** | Key for that endpoint | none | same |
| `LLM_MODEL` | no | Model name for that endpoint | `gpt-5.1` | same |
| `PORT` | no | Server port | 4111 (dev), 1976 (`npm start`) | `mastra/index.ts`, `auth/oauth.ts`, `run.mjs` |
| `UI_DIST` | no | Folder of the built UI to serve | unset (set by `npm start`) | `mastra/index.ts`, `run.mjs` |
| `API_URL` | no | Where the Vite dev server proxies `/bi` and `/auth` | `http://localhost:4111` | `ui/vite.config.ts` |
| `BI_MAX_BODY_BYTES` | no | Largest request body (room for the chat history) | 65536 | `config/schema.ts` |
| `BI_HISTORY_TURNS` | no | Earlier turns from the UI passed to the model; 0 = off | 3 | `config/schema.ts`, `core/chat/history.ts` |
| `BI_HISTORY_MAX_CHARS` | no | Cap per earlier question and answer | 1500 | same |
| `BI_HISTORY_INCLUDE_SQL` | no | Pass earlier turns' SQL to the model | false | same |
| `BI_GENIE_MAX_PER_MINUTE` | no | *Proposed.* Genie questions started per minute by this instance; 0 = off | 5 | `core/genie/limiter.ts` |
| `BI_GENIE_QUEUE_WAIT_MS` | no | *Proposed.* Longest wait for a Genie slot | 60000 | same |
| `BI_GUARD_INJECTION` | no | *Proposed.* Prompt-injection check: off, log, block | off | `core/guards/input.ts` |
| `BI_GUARD_MODEL` | no | *Proposed.* Model of that check; required when it is on | none | same |
| `BI_GUARD_FAIL_CLOSED` | no | *Proposed.* Refuse when the guard model fails | false | same |
| `BI_GUARD_OUTPUT` | no | *Proposed.* Clean images, links, HTML, URLs and internal names from model text | on | `core/guards/output.ts` |
| `BI_GROUNDING` | no | *Proposed.* Log figures that match no data (log only) | log | `core/guards/grounding.ts` |
| `BI_GUARD_SCOPE` | no | Replace a text-only Genie reply with the scope message: off, log, enforce | enforce | `core/guards/scope.ts` |
| `BI_SCOPE_MESSAGE` | no | Reply to an off-topic question | built from the spaces | `core/agents/prompts.ts` (`scopeMessage`) |
| `VITE_HISTORY_TURNS` | no | Earlier turns the UI sends (UI build time) | 3 | `ui/src/hooks/history.ts` |

Settings added in November 2026 are read through the one schema in `server/src/config/schema.ts`; `server/.env.example` is generated from it and lists every setting with its help text.

Notice `ANTHROPIC_API_KEY` is not read anywhere in the repo's own code. The Mastra AI layer reads it, based on the `anthropic/...` model name. I could not confirm that from the repo, only from the README and `.env.example`.

## Not used by the code

`server/.env.example` also lists `DATABRICKS_HTTP_PATH`, `DATABRICKS_CATALOG`, `DATABRICKS_SCHEMA` and `DATABRICKS_PRODUCT_CATALOG`. The README says they are "kept for reference; the current code does not use them". My search of the source agrees.

## The example file

`server/.env.example` lists every setting above, except `UI_DIST` and `API_URL`, which `npm start` and the UI dev server set. Required settings are blank. Optional settings are commented out with `#`.

**Do not leave an optional setting blank.** `NAME=` with nothing after it counts as set, and it replaces the default, because the code uses `process.env.NAME ?? default` (`server/src/core/genie/registry.ts`, `server/src/core/agents/prompts.ts`, `server/src/core/genie/client.ts`). For example `GENIE_ROW_CAP=` becomes `Number('')`, which is 0 rows, and `ANTHROPIC_MODEL=` gives a broken model name.

## Secrets

- Real secrets: `DATABRICKS_TOKEN`, `ANTHROPIC_API_KEY`, `LLM_API_KEY`, and any OAuth tokens held in memory.
- OAuth uses no client secret. The app is a public client (`README.md`).
- Secrets live only on the server. The browser code never gets them (`README.md`, Settings).
- Where production secrets come from (a vault, pipeline variables, or something else) is not in the repo.

One thing to know: `server/src/core/genie/registry.ts` has hard-coded fallback Genie space ids. A space id is not a password, but it is an internal identifier. Ask whether it should stay in source. See [14-gotchas.md](14-gotchas.md).

## Feature flags

There is no flag system. These settings change behaviour like flags:

- `GENIE_MODE=agent` switches the whole Genie client (`server/src/mastra/index.ts`).
- `DATABRICKS_CLIENT_ID` switches between shared-token mode and OAuth (`server/src/mastra/index.ts`).
- `BI_GUARD_INJECTION`, `BI_GUARD_OUTPUT` and `BI_GROUNDING` switch the guards (all *Proposed*, see `docs/lift/REPORT.md`).
- `BI_HISTORY_TURNS=0` switches follow-up context off.

The chart library is a build-time choice, not a setting. See [07a-charts.md](07a-charts.md).

## Key takeaways
- All settings come from `server/.env` or the shell. No per-environment files exist in the repo.
- Real secrets: `DATABRICKS_TOKEN`, `ANTHROPIC_API_KEY`, `LLM_API_KEY`.
- `DATABRICKS_CLIENT_ID` and `GENIE_MODE` change behaviour most.
- Optional settings must stay commented out in `.env`, never blank.

## Where to look in the code
- `server/.env.example`: the example file.
- `server/src/mastra/index.ts`: `GENIE_MODE`, `PORT`, `UI_DIST`.
- `server/src/adapters/local/auth/oauth.ts`: OAuth settings.
- `server/src/core/genie/registry.ts`: Genie space settings.
- `run.mjs`: how `.env` is created and used.
