# 03. Repo map

## What you will learn
- What each folder and file is for.
- Where to put new code.
- The naming habits in this repo.

The repo is small: about 2,100 lines of TypeScript and CSS in total, including about 300 lines of tests (server and UI, counted on 2026-11-02).

## Top level

| Path | What it is |
|---|---|
| `package.json` | Root scripts: `setup`, `build`, `start` (all call `run.mjs`) |
| `run.mjs` | The launcher. Also accepts `all` (setup, build, start in one go) |
| `README.md` | The project's own summary and settings table |
| `.gitignore` | Ignores `node_modules`, `.env` files (but not `.env.example`), `dist`, `.mastra`, `*.db` |
| `.vscode/settings.json` | One editor setting for Python env files. Unrelated to this Node project |
| `server/` | The Mastra server |
| `ui/` | The React app |
| `docs/` | Older docs |
| `docs/onboarding/` | These docs |

## `server/`

| Path | What it holds |
|---|---|
| `package.json`, `tsconfig.json` | Dependencies and TypeScript settings. `tsconfig` only checks `src/**/*.ts` |
| `.env.example` | The list of setting names. Copy it to `.env` and fill it in |
| `.env` | Your local secrets. Git-ignored. Never commit it |
| `.mastra/` | Build output. Git-ignored. Created by `mastra build` |
| `src/contracts.ts` | Shared data shapes: Genie result, chat events, chart spec, interfaces |
| `src/mastra/index.ts` | The main file: routes, auth checks, static UI server, the `Mastra` object |
| `src/mastra/agents/index.ts` | The supervisor, Genie specialists and the follow-up agent, with their instructions |
| `src/mastra/tools/askGenie.ts` | The ask tool and the load-full-results tool |
| `src/mastra/chartSpec.ts` | Chart JSON from Genie to a chart spec |
| `src/mastra/collector.ts` | Per-request side channel |
| `src/mastra/history.ts` | Earlier questions and suggestions per chat (in memory, last 6 turns), used so new follow-ups never repeat |
| `src/mastra/trace.ts` | Turns the agents' stream into the scratchpad: the plan, one entry per data source, and under it Genie's short thoughts and queries |
| `src/mastra/suggest.ts` | Writes follow-up questions |
| `src/genie/registry.ts` | The list of Genie spaces |
| `src/genie/client.ts` | Genie Conversation API client |
| `src/genie/agentClient.ts` | Genie Agent mode client (GA API) |
| `src/genie/conversations.ts` | In-memory conversation and last-result maps |
| `src/auth/oauth.ts` | OAuth with PKCE: build login URL, exchange and refresh tokens |
| `src/auth/sessions.ts` | In-memory sessions, the cookie, token refresh |
| `src/auth/tokenProvider.ts` | The shared-token provider (dev) |
| `scripts/smoke-genie.ts` | A manual script that calls Genie directly |

## `ui/`

| Path | What it holds |
|---|---|
| `index.html` | The page shell. Loads fonts from Google Fonts |
| `vite.config.ts` | Dev server port 5173 and the proxy to the server |
| `src/main.tsx` | Starts React |
| `src/App.tsx` | Login page, chat page, sidebar, the send function |
| `src/components.tsx` | Table, feedback buttons, scratchpad, answer details, chart error guard |
| `src/api.ts` | `fetch` calls, including the stream reader |
| `src/types.ts` | Data types. Copies of the server shapes. Keep in sync by hand |
| `src/styles.css` | All styling in one file |
| `src/charts/` | Chart renderers. See [07a-charts.md](07a-charts.md) |

## Where tests live

Tests sit **next to** the file they test, named `*.test.ts`:

- `server/src/auth/auth.test.ts`
- `server/src/genie/client.test.ts`
- `server/src/genie/agentClient.test.ts`
- `server/src/mastra/chartSpec.test.ts`

The UI has tests only for the Plotly figure logic (`ui/src/charts/plotlyFigures.test.ts`). There are no tests for the routes or tools.

## Naming habits seen in the code

- Files: `camelCase.ts` for logic (`chartSpec.ts`, `askGenie.ts`). `PascalCase.tsx` for React chart components (`RechartsChart.tsx`).
- Folders: lowercase (`auth`, `genie`, `mastra`).
- Each server folder is a topic: `auth`, `genie`, `mastra`.
- One `index.ts` per `agents` folder and in `ui/src/charts/`.
- Constants in capitals (`COOKIE`, `ROW_CAP`, `PALETTE`).
- Comments explain the reason, and appear above the code.

I could not find lint or format config (no ESLint or Prettier file). The style is what the existing files show: single quotes, semicolons, two-space indents, and short lines of code with a trailing comment where useful.

## Where to put new code

| You want to add | Put it in |
|---|---|
| A new Genie space | `server/src/genie/registry.ts` |
| A new HTTP route | `server/src/mastra/index.ts` (see [06-backend.md](06-backend.md)) |
| A new AI tool | `server/src/mastra/tools/` |
| A new shared data shape | `server/src/contracts.ts` **and** `ui/src/types.ts` |
| A new chart type | `server/src/mastra/chartSpec.ts` and all three files in `ui/src/charts/` |
| A new screen piece | `ui/src/components.tsx`, used from `ui/src/App.tsx` |

## Key takeaways
- Server logic is split into three topic folders: `mastra`, `genie`, `auth`.
- `server/src/contracts.ts` and `ui/src/types.ts` must match. Nothing checks this for you.
- Tests sit beside the code and only cover Genie clients, login and chart building.
- No lint config was found. Copy the style of the file you edit.

## Where to look in the code
- `server/src/` and `ui/src/`: all the source.
- `.gitignore`: what stays out of the repo.
- `run.mjs`: how the pieces are started.
