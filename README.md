# Conversational BI

Ask questions about your data in plain English. A supervisor agent sends each question to the right Databricks Genie space (or several), and streams back a written answer, the data table, charts built from Genie's own data, and the SQL that ran. While it works, a scratchpad shows the plan, each data source and every query.

It is built to move into GC's platform (`gc-bridge-v2`): the core does not depend on its host, every setting is checked at start, and logs, limits, health checks and the HTTP contract are production ready. See [LIFT_AND_SHIFT.md](LIFT_AND_SHIFT.md) and [docs/lift/REPORT.md](docs/lift/REPORT.md).

## How it fits together

- `server/` is the service (TypeScript, Mastra, Node 22.13 or later).
  - `src/config`: every setting in one schema, read and checked once at start.
  - `src/core`: the agents and prompts, the Genie clients, the chat turn, charts, the scratchpad, limits. No HTTP and no host code.
  - `src/ports`: the interfaces the core needs from its host (identity, tokens, model, logging).
  - `src/adapters`: local login and tokens, the model provider, the logger.
  - `src/edge`: the HTTP routes on Mastra's server, and NestJS templates for hosting in GC.
  - `src/mastra/index.ts`: wires it all together for `mastra start`.
- `ui/`: the chat page (React, Vite, MUI). It reads the answer stream and draws the scratchpad, the answer, the charts and the table.
- `demo-ui/`: a temporary, deliberately plain page for an interim client demo. It runs on its own port; remove it with the folder (see its README).
- Genie spaces are configuration, not code: a JSON file lists them, and one agent and its tools are created per space. Business rules (what "Year" means, units) are a text file. Nothing about the business is written into the code; a test enforces it.

## Requirements

- Node.js 22.13 or later.
- A model: an Anthropic API key, or an OpenAI-compatible endpoint (`LLM_BASE_URL`).
- A Databricks workspace with Genie spaces, and either a personal access token (development) or an OAuth app connection (per-user login).

## Quick start

1. `npm run setup` installs both apps and creates `server/.env` from `server/.env.example`.
2. Fill in `server/.env`. The required lines are listed without `#`: `DATABRICKS_SERVER_HOSTNAME`, `DATABRICKS_TOKEN` (or `DATABRICKS_CLIENT_ID`), `ANTHROPIC_API_KEY`, and one `BI_SPACE_ID_<KEY>` per space in the spaces file (with the example file: `BI_SPACE_ID_PLACEMENT` and `BI_SPACE_ID_CAPACITY`).
3. `npm run build`, then `npm start`.
4. Open http://localhost:1976 (main UI). The demo page is on http://localhost:1977.

If a setting is missing or wrong, the server stops with one message that names each one (and never shows a value).

## Settings

Every setting, with its default and meaning, is in [`server/.env.example`](server/.env.example), generated from `server/src/config/schema.ts` (`npm run env:example`; a test fails if it is out of date). Never commit `server/.env`.

The spaces come from `BI_SPACES_FILE` (default: `server/config/examples/spaces.example.json`) and the business rules from `BI_DOMAIN_RULES_FILE` (default: `server/config/examples/domain-rules.example.md`). For GC deployments see [docs/lift/GC-CONFIG.md](docs/lift/GC-CONFIG.md).

## Adding a Genie space

Add an entry to the spaces file (`key`, `name`, `description`, optional `routing`) and set `BI_SPACE_ID_<KEY>`. Restart. The agent, its tools, the routing and the scratchpad name are created from the entry. Write the description for routing: what the space holds, and what it does not.

## Login (Databricks OAuth, local mode)

Set `DATABRICKS_CLIENT_ID` to turn on per-user login (authorization code with PKCE, public client, scopes `all-apis offline_access`). Genie then runs with each user's own token, so Unity Catalog permissions apply. Without it, everyone uses the shared `DATABRICKS_TOKEN` (development only). Register the app connection in the Databricks account console with the redirect URL `http://localhost:<PORT>/auth/callback` and no client secret.

In GC, sign-in is GC's Okta and the Databricks token comes from GC's own token service; see [LIFT_AND_SHIFT.md](LIFT_AND_SHIFT.md).

## Development

- `cd server && npm run dev` starts Mastra on :4111 (with Studio). `cd ui && npm run dev` starts the UI on :5173, proxying `/bi` and `/auth` to the server.
- In `server/`: `npm test`, `npm run typecheck`, `npm run contracts` (regenerates the published contract), `npm run env:example`.
- In `ui/`: `npm test`, `npx tsc --noEmit`.

## The API

`POST /bi/chat` streams the answer as Server-Sent Events; `POST /bi/feedback` rates an answer; `GET /bi/version`, `/health/live` and `/health/ready` are for operations. The contract is in [docs/CONTRACT.md](docs/CONTRACT.md), with JSON Schemas and an OpenAPI file in `server/contracts`. Logs are described in [docs/lift/DATADOG.md](docs/lift/DATADOG.md).

## Known limits

- Login sessions, Genie conversation ids and recent turns are kept in server memory: a restart logs users out and starts new Genie conversations. A bounded store and a shared one for several pods are planned ([REPORT.md](docs/lift/REPORT.md), phase 5).
- The answer's wording varies between runs; the figures always come from Genie.
- `ui/src/types.ts` mirrors `server/src/contracts.ts` by hand; `server/contracts/*.schema.json` is the reference.
