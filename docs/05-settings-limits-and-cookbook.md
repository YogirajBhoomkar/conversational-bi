# 5. Settings, Running It, Changing It, and Known Problems

> **Written before the November 2026 restructure.** File paths are updated, but some descriptions are out of date: routes, login and the chat turn are no longer in `server/src/mastra/index.ts` (now only the wiring), spaces and their ids are configuration, and settings are read once in `server/src/config`. Current layout: [onboarding/03-repo-map.md](onboarding/03-repo-map.md). Settings: `server/.env.example`.

Contents:
1. Settings (the `.env` file)
2. Running the app (and the rebuild trap)
3. How to change common things
4. When something goes wrong
5. Known limits and open items
6. Where the older docs are out of date

---

## 1. Settings

All settings are in `server/.env`. A blank template is `server/.env.example`.
**`.env` contains secrets. Never share or commit it.**

### Databricks connection

| Name | Meaning | Needed? |
|------|---------|---------|
| `DATABRICKS_SERVER_HOSTNAME` | Your workspace address, for example `dbc-xxxx.cloud.databricks.com` | Yes |
| `DATABRICKS_TOKEN` | A shared personal token. **Development only.** Not used once login is on | If `DATABRICKS_CLIENT_ID` is empty |
| `DATABRICKS_CLIENT_ID` | Turns on "Log in with Databricks" (each person uses their own token) | Optional |
| `DATABRICKS_REDIRECT_URI` | Overrides where Databricks sends people back after login | Optional |
| `BI_SPACE_ID_PLACEMENT` | Id of the **placement** Genie space (a default is built in) | Optional |
| `BI_SPACE_ID_CAPACITY` | Id of the **capacity** Genie space (a default is built in). *Not listed in `.env.example`* | Optional |
| `GENIE_MODE` | `conversation` (default) = the Conversation API. `agent` = streaming Agent mode | Optional |
| `DATABRICKS_HTTP_PATH`, `DATABRICKS_CATALOG`, `DATABRICKS_SCHEMA`, `DATABRICKS_PRODUCT_CATALOG` | Present in the template but **not used by the current code** | No |

### The AI model

| Name | Meaning |
|------|---------|
| `ANTHROPIC_API_KEY` | Key for Claude. Used when `LLM_BASE_URL` is empty |
| `ANTHROPIC_MODEL` | Which Claude model. Default `claude-sonnet-5-5` |
| `LLM_BASE_URL` | If set, use this OpenAI-compatible address (for example a company proxy) instead of Claude |
| `LLM_API_KEY` | Key for that address |
| `LLM_MODEL` | Model name at that address. Default `gpt-5.1` |

### Limits and server

| Name | Default | Meaning |
|------|---------|---------|
| `GENIE_ROW_CAP` | 200 | Most rows kept from one Genie result for display |
| `GENIE_FULL_ROW_CAP` | 5000 | Most rows loaded when the user asks for the full result |
| `GENIE_TIMEOUT_MS` | 180000 | How long to wait for Genie (3 minutes) |
| `PORT` | 4111 (dev) / 1976 (`npm start`) | Server port |
| `UI_DIST` | set by `npm start` | Folder of the built browser app to serve |
| `BI_MAX_BODY_BYTES` | 65536 | Largest request body; leaves room for the chat history sent with each question |

### Chat history, Genie pacing, guards (added November 2026)

The complete list, with descriptions, is `server/.env.example` (generated from `server/src/config/schema.ts`).

| Name | Default | Meaning |
|------|---------|---------|
| `BI_HISTORY_TURNS` | 3 | Earlier turns sent by the UI that the server passes to the model. 0 turns history off |
| `BI_HISTORY_MAX_CHARS` | 1500 | Longest question and answer kept per earlier turn |
| `BI_HISTORY_INCLUDE_SQL` | false | Pass the SQL of earlier turns to the model |
| `BI_GENIE_MAX_PER_MINUTE` | 5 | *Proposed.* Questions this instance starts at Genie per minute. The workspace quota divided by the number of pods. 0 = off |
| `BI_GENIE_QUEUE_WAIT_MS` | 60000 | *Proposed.* Longest wait for a free Genie slot |
| `BI_GUARD_INJECTION` | off | *Proposed.* Prompt-injection check: `off`, `log` or `block`. One guard-model call per question when on |
| `BI_GUARD_MODEL` | (none) | *Proposed.* The guard's model, same provider as the main model. Required when the check is on |
| `BI_GUARD_FAIL_CLOSED` | false | *Proposed.* Refuse the question when the guard model fails (newer Mastra only) |
| `BI_GUARD_OUTPUT` | on | *Proposed.* Remove images, links, HTML, URLs and internal names from what the model writes; replace figures when no data came back |
| `BI_GROUNDING` | log | *Proposed.* Log how many figures of an answer match nothing the data returned. Never changes the answer |
| `BI_SCOPE_MESSAGE` | (built from the spaces) | The reply to an off-topic question. Default: "I can help with questions about <space name> (<short phrase from its description>) …" |
| `VITE_HISTORY_TURNS` (UI build) | 3 | Earlier turns the UI sends with each question |

---

## 2. Running the app

You need **Node.js 22.13 or newer** (Mastra requires it).

### Normal way (one program serves everything)

From the main folder:

```
npm run setup     # once: installs libraries, creates server/.env from the template
npm run build     # builds the browser app and the server
npm start         # runs it on http://localhost:1976
```

### Developer way (two programs, instant reload)

```
cd server && npm run dev     # server on http://localhost:4111 (Mastra Studio also here)
cd ui && npm run dev         # browser app on http://localhost:5173
```

### The rebuild trap (important)

`npm start` runs the **already built** copies in `server/.mastra/output/` and `ui/dist/`. It does **not** read your source files.

> **If you change code and the app behaves the same as before, you forgot to rebuild.**

To pick up code changes:
1. **Stop** the running server. (On Windows the build fails with a "resource busy or locked" error while the server is running.)
2. Run `npm run build` from the main folder.
3. Run `npm start`.

### Useful commands (inside `server/`)

| Command | What it does |
|---------|--------------|
| `npm test` | Runs all the automatic tests |
| `npm run typecheck` | Checks the code for type mistakes |
| `npx tsx scripts/smoke-genie.ts "your question"` | Asks Genie directly (chat mode), **no AI involved**. Good for checking Databricks access |

(Run `npm run typecheck` in `ui/` too.)

---

## 3. How to change common things

| I want to... | Do this |
|--------------|---------|
| **Add a new Genie space** | Add an entry to `genieSpaces` in `server/src/core/genie/registry.ts` (key, name, description, space id). Its agent and tools are created automatically. Write a specific description, because the supervisor routes by it. Mention it in the supervisor's ROUTING lines in `agents/index.ts` if it needs special rules |
| **Change how answers sound** | Edit the supervisor's `instructions` text in `server/src/core/agents/prompts.ts` |
| **Change which questions go where** | Same file: the ROUTING section of the supervisor instructions, plus each space's `description` in `registry.ts` |
| **Change the follow-up suggestions** | Edit the `suggest_agent` instructions in `agents/index.ts` |
| **Switch Genie mode** | Set `GENIE_MODE=agent` (streaming) or empty (older), then rebuild and restart |
| **Use a different AI model** | Set `ANTHROPIC_MODEL`, or `LLM_BASE_URL` + `LLM_MODEL` + `LLM_API_KEY` |
| **Show more or fewer rows** | `GENIE_ROW_CAP` and `GENIE_FULL_ROW_CAP` |
| **Change the starter questions** | The `STARTERS` list at the top of `ui/src/App.tsx` |
| **Add a chart type** | In `mastra/chartSpec.ts`: map the type name Genie sends (the `type` key in its chart JSON) to a drawing in `parseGenieChartJson`, and add how to draw it in the three renderers in `ui/src/charts/`. Then update the "only bar/column, line and scatter are drawn" sentence in the supervisor instructions in `agents/index.ts`. The Genie space itself decides which types it can send |
| **Change colours or fonts** | `ui/src/styles.css` |
| **Change what the browser receives** | Edit `contracts.ts` **and** `ui/src/types.ts` (keep both identical), then the route in `mastra/index.ts` and the screen code |
| **Check the code still works** | `npm test` and `npm run typecheck` in `server/`, `npm run typecheck` in `ui/` |

---

## 4. When something goes wrong

| What you see | Most likely reason | What to do |
|--------------|--------------------|------------|
| Changes do not show up | App not rebuilt | See "The rebuild trap" above |
| Build fails: `EBUSY: resource busy or locked` | The server is still running and holds its files | Stop the server, then build |
| "Please log in" after a restart | Sessions live in memory | Log in again |
| Error mentioning `403` or "preview" on a Genie call | Agent mode not enabled for the workspace | Ask a workspace admin to enable the preview **"Agent Mode APIs for Genie Agents"**, or set `GENIE_MODE` empty |
| Error `404` on a Genie call | Wrong space id, or the space does not support Agent mode | Check the ids in `registry.ts` / `.env` |
| The answer has numbers but **no chart** | Genie did not send chart data (the question may not have asked for a chart), sent it in an unknown shape, or sent a type we do not draw | Look at the server console. `[genie] unparsed single-cell result …` means an unknown shape. `[chart] not drawing: type="…"` means an unsupported type. `[genie] could not load chart JSON` means the statement fetch failed. Share the line |
| No follow-up buttons | The suggestion step failed or was skipped (small talk, errors) | Look for `[suggest] failed:` in the server console |
| "Genie timed out" | Over 3 minutes | Raise `GENIE_TIMEOUT_MS`, or ask a simpler question |
| Thinking log shows only status words | You are in chat mode | Set `GENIE_MODE=agent` |
| "preview: N of M rows" and you want everything | Normal for big results | Answer "yes" when the assistant asks, or ask "load the full result" |
| Port already in use | Another copy is running | Stop it, or set `PORT` |

---

## 5. Known limits and open items

Be aware of these before showing or shipping the app.

### Must know

1. **Data is held in server memory.** Sessions, Genie conversation ids and "last result" vanish on restart, and **do not work across several server copies** (see the table in file 4, section 8). Chat memory is stored in local files. For production this needs a shared database or cache.
2. **Agent mode is GA** (APIs since 27 Aug 2026). Confirm it is enabled in the workspace. Only the Flash option is Beta.
3. **Numbers need checking.** The same question ("FOT premium by region and year") returned **different totals on two runs** in Agent mode (for example North America 2024 once showed about 228.9M, another time 53.7M). This has **not been resolved**. Someone who knows the data should confirm what the "Total FOT Premium USD" measure should include (for example whether it should be limited to FOT status) and fix it on the Genie side.
4. **The login mode matters.** With no `DATABRICKS_CLIENT_ID`, everyone shares one token and one set of permissions. Use this for development only.
5. **Node 22.13 or newer is required** by Mastra.

### Good to know

6. **Previews.** Large results are shown as a preview until the user asks for everything. Full loading is capped at 5,000 rows, works only in Agent mode, and **has not been tested on a truly large result**. Results too large to load inline return an error.
7. **No keep-alive pings.** If a step stays silent for a long time, a strict proxy (for example one with a ~2 minute idle limit) could cut the stream.
8. **Follow-up suggestions** were tested with code-level tests but **not yet against the live AI model** at the time of writing. Treat them as unproven until you see the buttons appear.
9. **Chat-mode "thinking" is probably empty.** The code reads a `thoughts` field that Databricks' documentation does not list.
10. **Feedback buttons** worked once in a test against an Agent mode message (the call succeeded). Not tested further.
11. **Charts depend on Genie.** Genie supplies the chart data, so a chart only appears if the Genie space answers a "chart" question with chart JSON. This was verified for the **placement** space in Agent mode; the **capacity** space has not been tested. Only column/bar, line and scatter types are drawn. If a chart's data is very large, loading it relies on the SQL Statement API (up to the inline size limit).
12. **Answers vary.** The AI's wording and chart choices can change between runs. The figures come from Genie.
13. **The two type files** (`server/src/contracts.ts` and `ui/src/types.ts`) must be edited together by hand.
14. **No cancel button.** Once a question is sent, it runs to the end.
15. **Branding:** the sidebar shows a text name, not the logo, and the Mona Sans font loads from Google Fonts.

---

## 6. Where the older docs are out of date

| Document | Out-of-date point |
|----------|-------------------|
| Main `README.md` | Says Node 20 is enough (needs 22.13+); describes one Genie space (now two); does not mention `GENIE_MODE`, `GENIE_FULL_ROW_CAP`, `BI_SPACE_ID_CAPACITY`, live thinking, Agent mode, full-result loading or follow-up suggestions |
| `docs/code-guide.html` | Written before Agent mode, streaming thinking, follow-up suggestions and full-result loading. Uses older names such as `genie_gcmp` and `mastra_supervisor/` |

These Markdown files in `docs/` match the current code.

Back to the index: [README.md](README.md)
