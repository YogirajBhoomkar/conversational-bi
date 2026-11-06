# 14. Gotchas

> **Written before the November 2026 restructure.** File paths are updated, but some descriptions are out of date: routes, login and the chat turn are no longer in `server/src/mastra/index.ts` (now only the wiring), spaces and their ids are configuration, and settings are read once in `server/src/config`. Current layout: [03-repo-map.md](03-repo-map.md). Settings: `server/.env.example`.

## What you will learn
- The surprises that are most likely to cost you time.
- Which areas are fragile.
- Where the docs and code disagree.
- Workarounds, with file paths.

Each item says what to expect, why, and what to do.

## Build and run

**1. `npm start` runs old code until you rebuild.**
The server runs the built copy in `server/.mastra/output` (`run.mjs`, `start`). If you change server code and only rebuild the UI, the server keeps the old behaviour. We hit this for real: the server still sent the old chart format, and the new chart code crashed on it. Fix: run `npm run build` (both parts) after any change. The UI now survives a bad chart (see item 9).

**2. The server build can fail with `EBUSY` on Windows.**
The error says a folder in `server/.mastra/output` is "resource busy or locked". Seen in two cases: a still-running `npm start` server, and file locks from tools that watch or sync the folder (the project sat in a synced Documents folder). Fix: stop the running server, delete `server/.mastra/output`, build again. Long-term: keep the project outside synced folders. Source: `run.mjs` (`npx mastra build`), `.gitignore` (`.mastra`).

**3. `ui` type-checks every file, even unused chart renderers.**
`ui/tsconfig.json` includes all of `src`. So the Plotly and D3 files are checked even when `ui/src/charts/index.ts` does not use them. All three libraries must stay installed until you delete the files you do not want. See [07a-charts.md](07a-charts.md).

**4. `server` type check skips `scripts/`.**
`server/tsconfig.json` includes only `src/**/*.ts`. A mistake in `server/scripts/smoke-genie.ts` will not show up in `npm run typecheck`.

## Data and sync

**5. Two copies of the data shapes.**
`server/src/contracts.ts` and `ui/src/types.ts` are kept in sync by hand. Nothing checks them against each other. `ChartSpec` is also copied. A mismatch shows up at run time, not at build time.

**6. The table shows only a preview.**
Rows are cut to 200 by default (`GENIE_ROW_CAP`). `totalRows` tells the truth. Loading the full set (up to 5000) works only in Agent mode (`server/src/core/agents/askGenie.ts`, `server/src/core/genie/agentClient.ts`). In the default mode the tool answers "The full result is not available for the previous query."

**7. Only the latest result is shown.**
`chatRoute` picks the last result that has columns (`withData` in `server/src/mastra/index.ts`). If a question used both Genie spaces, the table shows only one of them. The chart likewise belongs to the latest result, and a later non-chart answer clears an earlier chart (`server/src/core/agents/askGenie.ts`).

**8. Bar charts with dates are not on a time axis.**
Only line charts get `xType: 'time'` (`server/src/core/chart/chartSpec.ts`). Dates on a bar chart become text categories in data order.

**9. A bad chart no longer blanks the page, but it is silent.**
`ChartBoundary` hides a failing chart and logs to the browser console (`ui/src/components.tsx`). The user sees no chart and no message. Check the console.

## State

**10. Everything important is in memory.**
Sessions, PKCE state, conversation ids and last results are lost on restart (`server/src/adapters/local/auth/sessions.ts`, `server/src/adapters/local/auth/oauth.ts`, `server/src/core/genie/conversations.ts`). They also cannot be shared between two server copies. After a restart the supervisor's memory (on disk) and Genie's conversation (in memory) no longer match.

**11. A page reload shows an empty chat but keeps the thread.**
The thread id is saved in `localStorage` (`bi-thread`), but the messages are only in React state (`ui/src/App.tsx`). After a reload you see an empty screen, yet follow-up questions continue the old thread on the server.

## Agents

**12. Routing rules live in two places.**
The Genie space `description` in `server/src/core/genie/registry.ts` feeds the supervisor prompt automatically. But the `ROUTING` block in `server/src/core/agents/prompts.ts` also names `genie_placement` and `genie_capacity` by hand. A new space needs both. The README mentions only the first.

**13. Agent behaviour is plain text and untested.**
Instructions in `server/src/core/agents/prompts.ts` control routing, chart requests and answer style. No test covers them. Small wording changes can change behaviour. Try real questions after any edit.

**14. Charts rely on Genie's wording.**
The supervisor must use the word "chart" so Genie returns chart JSON. If Genie sends an unknown shape, the app logs `[genie] unparsed single-cell result` and shows only a table (`server/src/core/agents/askGenie.ts`).

**15. Agent mode is GA, but re-check its output format.**
Databricks' release notes say Agent mode went GA on 2 Jul 2026 and its APIs on 27 Aug 2026. Only Flash is Beta, so do not enable Flash. On 6 Aug 2026 the APIs changed to return tables as markdown (labelled Beta); the notes do not say whether that changed at GA. Our code reads query output text (`chartJsonOf` in `server/src/core/genie/agentClient.ts`), so test a chart question after any Databricks change. The stream also cuts long query output at about 600 characters, so chart JSON is re-loaded by statement id (same file). Confirm the feature is enabled in each workspace, because admins can switch some Genie features off.

## Security and safety

**16. A retried Genie question takes longer.**
Genie calls are retried with exponential backoff and jitter (`server/src/core/genie/retry.ts`, up to `GENIE_RETRY_ATTEMPTS`, default 3): a GET on 408, 429, 5xx or a network failure; a POST only on 429 or 503, so a question is never sent twice; and a run Genie itself reports as failed (for example SQL it wrote that does not parse), asked again in the same conversation. Access errors and timeouts are not retried. Each retry repeats Genie's work, so a question that fails twice can take two to three times as long. The scratchpad says when Genie is trying again.

**17. Stream errors return HTTP 200 and are not logged on the server.**
By the time something fails, the response has started. The error is sent as an `error` event (`chatRoute`), and not written to the server log.

**18. The `[genie] unparsed single-cell result` warning may contain data.**
It prints up to 300 characters of a result (`server/src/core/agents/askGenie.ts`).

**19. Fallback Genie space ids are hard-coded.**
`server/src/core/genie/registry.ts` uses a fixed id when the env variable is not set. Decide whether that belongs in source.

**20. The cookie `Secure` flag depends on the request URL.**
It is added only for `https` requests (`server/src/mastra/index.ts`). Behind a proxy that ends TLS, check what protocol the server sees.

**21. CORS is fixed to `http://localhost:5173`.**
(`server/src/mastra/index.ts`, `server.cors`.) Fine for same-origin production. A different front-end address would need a code change.

## Docs and setup

**22. The README mentions a `chart_agent` that does not exist.**
`README.md`, "How it fits together". The code builds charts in plain code (`server/src/core/chart/chartSpec.ts`) and has no such agent. Trust the code.

**23. Older Markdown files in `docs/` may be out of date.**
`docs/code-guide.html` was rewritten from the current code. The five older files (`docs/01-big-picture.md` to `docs/05-settings-limits-and-cookbook.md`) were only partly updated after the chart library change. Check them against the code before you rely on them.

**24. A blank setting is not the same as an unset one.**
`NAME=` in `server/.env` makes the value an empty string, and `process.env.NAME ?? default` does not fall back for an empty string. `GENIE_ROW_CAP=` becomes 0 rows, and `ANTHROPIC_MODEL=` breaks the model name. `server/.env.example` keeps optional settings commented out for this reason. See [10-config-and-secrets.md](10-config-and-secrets.md).

**25. Fonts come from Google Fonts.**
`ui/index.html` loads them at run time. A network that blocks Google will fall back to the system font.

**26. The sidebar uses a text wordmark, not the logo file** (`ui/src/App.tsx`, `README.md` "Known limits").

**27. `.vscode/settings.json` has a Python setting.**
It does nothing for this Node project.

## Key takeaways
- Rebuild both parts after any change. The server runs the built copy.
- State is in memory. Restarts and extra copies break sessions.
- Keep `contracts.ts` and `types.ts` in sync by hand.
- Agent rules are untested text. Try real questions.
- Trust the code over `README.md` and the older files in `docs/`.

## Where to look in the code
- `run.mjs`, `.gitignore`: build behaviour.
- `server/src/mastra/index.ts`: routes, `withData`, CORS, cookie.
- `server/src/core/agents/prompts.ts`: routing and instructions.
- `server/src/core/genie/registry.ts`: spaces and fallback ids.
- `server/src/core/genie/conversations.ts`, `server/src/adapters/local/auth/sessions.ts`: memory state.
- `ui/src/App.tsx`, `ui/src/components.tsx`: thread id, chart guard.
