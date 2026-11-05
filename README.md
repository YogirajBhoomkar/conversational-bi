# Conversational BI

A conversational BI app for corridor profitability. You ask a question in plain English; a Mastra supervisor agent (Claude) asks a Databricks Genie space for the data, builds a chart, and writes a short answer. The chat UI shows the answer, chart, data table and the SQL that ran.

A beginner-friendly code walkthrough is in [`docs/code-guide.html`](docs/code-guide.html).

## How it fits together
- `server/` is the Mastra app.
  - `bi_supervisor` delegates to sub-agents: one `genie_<key>` per Genie space in `src/genie/registry.ts`, plus `chart_agent`.
  - Genie returns the numbers. The LLM never makes them up, and chart specs are built in code from the real rows.
  - Routes: `POST /bi/chat` (streams Server-Sent Events), `POST /bi/feedback`, and `/auth/*` for login.
- `ui/` is React 19 + Vite. It streams from `/bi/chat` and shows progress, the answer, a chart (Recharts, Plotly or D3: see `ui/src/charts/index.ts`), a sortable table, collapsible SQL, and Helpful / Not helpful buttons (sent to Genie as feedback).
- In production one process serves both the API and the built UI.

## Requirements
- Node.js 20 or newer.
- An Anthropic API key.
- A Databricks workspace with a Genie space, plus either a personal access token (dev) or an OAuth app connection (per-user login).

## Quick start
1. `npm run setup` installs both apps and creates `server/.env` from `server/.env.example`.
2. Edit `server/.env` (see [Settings](#settings)). At minimum set `DATABRICKS_SERVER_HOSTNAME`, `BI_SPACE_ID_PLACEMENT`, `ANTHROPIC_API_KEY`, and either `DATABRICKS_TOKEN` or `DATABRICKS_CLIENT_ID`.
3. `npm run build`, then `npm start`.
4. Open http://localhost:1976. Set the `PORT` environment variable to use another port.

`npm start` runs `mastra start` with `PORT` (default 1976) and `UI_DIST` pointing at `ui/dist`. It tells you if `.env` or the build is missing.

Chat history and Mastra storage are written to `mastra.db` and `bi-memory.db` files next to the running server. They are git-ignored.

## Settings
All settings live in `server/.env`, which is git-ignored. Never commit it or put secrets in the browser code.

| Name | Purpose |
|---|---|
| `DATABRICKS_SERVER_HOSTNAME` | Workspace host, for example `adb-123.18.azuredatabricks.net` (required) |
| `BI_SPACE_ID_PLACEMENT` | Genie space to query (falls back to the ID in `registry.ts`) |
| `DATABRICKS_TOKEN` | Shared personal access token. Dev only; unused once OAuth is on |
| `DATABRICKS_CLIENT_ID` | Turns on per-user login when set |
| `DATABRICKS_REDIRECT_URI` | Optional override of the login callback |
| `ANTHROPIC_API_KEY` | Lets the server call Claude (required) |
| `ANTHROPIC_MODEL` | Optional model name (default `claude-sonnet-5-5`) |
| `PORT` | Server port (4111 in dev, 1976 with `npm start`) |
| `UI_DIST` | Folder of the built UI to serve (set by `npm start`) |
| `GENIE_ROW_CAP` | Max rows kept per result (default 200) |
| `GENIE_TIMEOUT_MS` | Max wait for Genie (default 180000) |
| `DATABRICKS_HTTP_PATH`, `DATABRICKS_CATALOG`, `DATABRICKS_SCHEMA`, `DATABRICKS_PRODUCT_CATALOG` | Kept for reference; the current code does not use them |

## Login (Databricks OAuth)
Set `DATABRICKS_CLIENT_ID` to turn on per-user login (authorization code + PKCE, public client, scopes `all-apis offline_access`). Genie then runs with each user's own token, so Unity Catalog permissions apply. With it unset, the app uses the shared `DATABRICKS_TOKEN` and skips login (dev only).

Register the app connection in the Azure Databricks account console (Settings, App connections):
- Redirect URL: `http://localhost:<PORT>/auth/callback` (must match exactly; or whatever you set in `DATABRICKS_REDIRECT_URI`).
- Scope: All APIs.
- No client secret.

Then put the client ID in `DATABRICKS_CLIENT_ID` and restart.

Sessions are held in server memory behind an httpOnly cookie, so a server restart logs everyone out. Access tokens refresh automatically; a revoked session sends the user back to the login page. Chat threads are scoped per user.

## Development
1. `cd server && npm install && npm run dev` starts Mastra on :4111, with Studio at http://localhost:4111.
2. `cd ui && npm install && npm run dev` starts the UI on http://localhost:5173. It proxies `/bi` and `/auth` to the server (set `API_URL` to point elsewhere).
3. With OAuth on in dev, set `DATABRICKS_REDIRECT_URI=http://localhost:5173/auth/callback` and register that URL, so the login returns to the UI port. This path has not been tested.

Useful commands (run in `server/`):
- `npm test` runs the unit tests (Genie client and login logic).
- `npm run typecheck` checks types.
- `npx tsx scripts/smoke-genie.ts "your question"` calls Genie directly, without the agents.

Run `npm run typecheck` in `ui/` too, since `npm run build` there also type-checks.

## Adding a Genie space
Add an entry to `genieSpaces` in `server/src/genie/registry.ts` (`key`, `name`, `description`, `spaceId`). Its sub-agent and tool are created automatically, and the supervisor routes by the `description`, so make it specific.

## Known limits
- Sessions and Genie conversation IDs are in memory, so a restart logs users out and starts fresh Genie threads. Use a database or Redis for production.
- The real Databricks login flow needs a registered client ID and has only been tested with a placeholder.
- Confirm the Genie space is attached to the corridor profitability data. Early tests returned reinsurance placement data and read "corridor" as a region.
- LLM wording and chart choice can vary between runs; the figures come from Genie.
- UI types in `ui/src/types.ts` mirror `server/src/contracts.ts` and must be kept in sync by hand.
- Brand: the sidebar shows a text wordmark, not the logo file, and Mona Sans loads from Google Fonts rather than being self-hosted.
