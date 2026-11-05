# 04. Run it locally

## What you will learn
- What you need before you start.
- Which settings to fill in (names only).
- How to run the app in two ways.
- How to run the tests.
- Common errors and fixes.

## Before you start

You need:
- **Node.js.** The README says 20 or newer (`README.md`). No version file exists. The docs were checked with a newer Node, but the target version is unknown.
- **An Anthropic API key**, or an OpenAI-compatible endpoint (`server/src/mastra/agents/index.ts`, `model()`).
- **A Databricks workspace** with a Genie space, and either a personal access token (PAT) or an OAuth app connection (`README.md`).

A **personal access token (PAT)** is a password-like string from Databricks. It acts as you. Use it for local work only.

## Settings

Run `npm run setup` once. It installs both apps and copies `server/.env.example` to `server/.env` if that file is missing (`run.mjs`, `setup`).

Then fill in `server/.env`. Never commit it. At minimum:

| Name | Value |
|---|---|
| `DATABRICKS_SERVER_HOSTNAME` | `<your-databricks-host>` |
| `BI_SPACE_ID_PLACEMENT` | `<placement-genie-space-id>` |
| `BI_SPACE_ID_CAPACITY` | `<capacity-genie-space-id>` |
| `ANTHROPIC_API_KEY` | `<anthropic-api-key>` |
| `DATABRICKS_TOKEN` | `<personal-access-token>` (dev only) |

If `DATABRICKS_CLIENT_ID` is set, the app uses per-user login instead of the token (`server/src/mastra/index.ts`). Leave it empty for the simplest local run.

All settings are listed in [10-config-and-secrets.md](10-config-and-secrets.md).

## Way 1: run like production (one process)

From the repo root:

```
npm run setup
npm run build
npm start
```

Then open http://localhost:1976. Set `PORT` to change the port (`run.mjs`, `start`).

`npm start` stops with a message if `server/.env` is missing or if the build has not been run (`run.mjs`, `start`).

After you change any code, run `npm run build` again. The server runs the built copy in `server/.mastra/output`, so old code keeps running until you rebuild.

## Way 2: run for development (two processes)

Terminal 1:
```
cd server
npm run dev
```
This starts Mastra on port 4111. Mastra's own test page ("Studio") is at the same address (`README.md`).

Terminal 2:
```
cd ui
npm run dev
```
This starts the browser app on http://localhost:5173. It forwards `/bi` and `/auth` to the server. Set `API_URL` to point at another server (`ui/vite.config.ts`).

Notice the proxy line in `ui/vite.config.ts`. It is why you do not need CORS settings locally.

If you turn on OAuth in dev, the README says to set `DATABRICKS_REDIRECT_URI` to the 5173 address and register it. The README also says this path "has not been tested" (`README.md`, Development).

## Tests and checks

In `server/`:
- `npm test` runs the unit tests (`vitest run`).
- `npm run typecheck` checks types. It covers `src/` only, not `scripts/`.

In `ui/`:
- `npm run typecheck` checks types.
- `npm run build` also checks types first (`tsc --noEmit && vite build`).

Try Genie alone, without the AI agents:
```
cd server
npx tsx scripts/smoke-genie.ts "your question"
```
(`server/scripts/smoke-genie.ts`. It uses the shared token. It needs `DATABRICKS_TOKEN` and a host.)

## Common errors

| What you see | Likely cause | Fix |
|---|---|---|
| `server/.env is missing. Run: node run.mjs setup` | No `.env` file | Run `npm run setup` (`run.mjs`) |
| `Not built yet. Run: node run.mjs build` | UI or server not built | Run `npm run build` (`run.mjs`) |
| `DATABRICKS_SERVER_HOSTNAME is not set` | Missing setting | Set it in `server/.env` (`server/src/genie/client.ts`) |
| `DATABRICKS_TOKEN is not set` | No token in shared-token mode | Set it, or set `DATABRICKS_CLIENT_ID` for login (`server/src/auth/tokenProvider.ts`) |
| Charts do not show after a code change | Server still runs an old build | Stop it, run `npm run build`, start again |
| `EBUSY: resource busy or locked` during the server build (seen on Windows) | A running server, or a file watcher or sync tool, holds `server/.mastra/output` | Stop the running server. Delete `server/.mastra/output`. Build again |
| Everyone is logged out after a restart | Sessions are in memory | Expected (`server/src/auth/sessions.ts`) |

## Key takeaways
- `npm run setup`, `npm run build`, `npm start` is the shortest path. Open port 1976.
- For live development, run `server` and `ui` each with `npm run dev`.
- Rebuild after every code change when using `npm start`.
- Never commit `server/.env`.

## Where to look in the code
- `run.mjs`: setup, build and start steps.
- `server/.env.example`: setting names.
- `ui/vite.config.ts`: dev proxy.
- `server/scripts/smoke-genie.ts`: direct Genie test.
