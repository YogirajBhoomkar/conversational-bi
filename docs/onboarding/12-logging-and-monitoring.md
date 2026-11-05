# 12. Logging and monitoring

## What you will learn
- What the app logs today.
- What it does not do (tracing, metrics, dashboards).
- How to debug a problem on your machine.
- What to ask about other environments.

## What exists

Logging is only `console.log`-style calls. I found no logging library, no request id, no tracing set-up and no metrics or dashboard config in the repo.

Every log call in the app code. (`server/scripts/smoke-genie.ts` and `run.mjs` also print to the terminal, but they are tools, not the app.)

| Message starts with | Level | When | Code |
|---|---|---|---|
| `DATABRICKS_CLIENT_ID not set: using the shared DATABRICKS_TOKEN...` | warn | At start, in dev mode | `server/src/mastra/index.ts` |
| `[chart] not drawing: type=... numericY=...` | warn | Genie sent a chart type the app cannot draw, or non-numeric y values | `server/src/mastra/chartSpec.ts` |
| `[genie] unparsed single-cell result, column=...` | warn | A one-cell result that is not recognised chart JSON. Shows up to 300 characters | `server/src/mastra/tools/askGenie.ts` |
| `[genie] could not load chart JSON:` | warn | The follow-up load of chart JSON by statement id failed | `server/src/genie/agentClient.ts` |
| `[suggest] failed:` | warn | The follow-up writer failed. The answer still goes out | `server/src/mastra/suggest.ts` |
| `[chart] could not draw:` | error, in the **browser** console | A chart threw while drawing | `ui/src/components.tsx`, `ChartBoundary` |

Notice the `[genie] unparsed single-cell result` warning can include a slice of real data. Keep that in mind when you decide where logs go.

Not logged: each request, each user, each Genie call, timings, token use. Errors inside the chat stream are sent to the browser as an `error` event but not logged on the server (`server/src/mastra/index.ts`, `catch`).

## Tools you already have

| Tool | How | Shows |
|---|---|---|
| Mastra Studio | Run `npm run dev` in `server/`, open http://localhost:4111 (`README.md`) | Agents and their runs |
| The scratchpad | In the chat UI while a question runs, and after (click to open) | The plan, one block per data source with its question, Genie's short thoughts and each query (running, then done) (`ui/src/components/TraceView/TraceView.tsx`) |
| The SQL block | Under every answer | The SQL Genie ran |
| `smoke-genie.ts` | `npx tsx scripts/smoke-genie.ts "question"` in `server/` | The raw Genie result, without the AI agents |
| Browser dev tools, Network tab | Open the `/bi/chat` request, look at the response | The raw stream of events |

I did not verify what Studio shows. That comes from the README.

## How to debug common problems

**No chart appears.**
1. In the Network tab, find the `final` event. Is `charts` empty?
2. If yes, look at the server console for `[chart] not drawing` or `[genie] unparsed single-cell result`.
3. If it is not null but nothing draws, look at the browser console for `[chart] could not draw`. A server still running an old build is the usual cause. See [14-gotchas.md](14-gotchas.md).

**The answer is wrong or empty.**
1. Open the SQL block. Is the SQL what you expect?
2. Run the question with `smoke-genie.ts` to take the AI agents out of the picture.
3. Open the scratchpad to see what each agent decided and what Genie did.

**You are asked to log in again.**
Sessions are in memory. A server restart ends them. Also check that the callback address matches the registered one.

**It hangs, then says Genie timed out.**
The wait limit is 180 seconds by default (`GENIE_TIMEOUT_MS`).

## Other environments

Nothing in the repo describes how logs are collected or where dashboards are in dev, QC or prod. Ask the platform team:

1. Where does server console output go?
2. Is there an alert on errors?
3. Can the `[genie]` warnings, which may contain data, be stored safely there?

See [99-open-questions.md](99-open-questions.md).

## Key takeaways
- Logging is six `console` calls. There is no tracing or metrics.
- Stream errors reach the browser but not the server log.
- Use the Network tab, the SQL block and `smoke-genie.ts` to narrow a problem.
- How logs work outside your machine is unknown.

## Where to look in the code
- `server/src/mastra/index.ts`: the stream `catch`.
- `server/src/mastra/chartSpec.ts`, `tools/askGenie.ts`, `genie/agentClient.ts`, `suggest.ts`: the warnings.
- `ui/src/components.tsx`: `ChartBoundary`, `Scratchpad`.
- `server/scripts/smoke-genie.ts`: the direct test.
