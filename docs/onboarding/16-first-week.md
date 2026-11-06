# 16. First week

> **Written before the November 2026 restructure.** File paths are updated, but some descriptions are out of date: routes, login and the chat turn are no longer in `server/src/mastra/index.ts` (now only the wiring), spaces and their ids are configuration, and settings are read once in `server/src/config`. Current layout: [03-repo-map.md](03-repo-map.md). Settings: `server/.env.example`.

## What you will learn
- A reading order for your first days.
- Five small starter tasks found in the code.
- What to ask, and where to look when you are stuck.

## Suggested order

**Day 1: understand it.**
1. [01-start-here.md](01-start-here.md), [02-big-picture.md](02-big-picture.md), [05-request-journey.md](05-request-journey.md).
2. [04-run-it-locally.md](04-run-it-locally.md). Get the app running and ask the three starter questions in the UI.
3. Open a chart answer. Click the SQL block and the data table.

**Day 2: follow the code.**
1. Read `server/src/mastra/index.ts` top to bottom (213 lines). Match it to [06-backend.md](06-backend.md).
2. Read `server/src/core/agents/prompts.ts` and `server/src/core/agents/askGenie.ts` with [06a-agents-and-tools.md](06a-agents-and-tools.md).
3. Read `ui/src/App.tsx` and `ui/src/components.tsx` with [07-frontend.md](07-frontend.md).

**Day 3: the details.**
1. [07a-charts.md](07a-charts.md) and `server/src/core/chart/chartSpec.ts`.
2. [08-auth-and-access.md](08-auth-and-access.md) and the tests in `server/src/adapters/local/auth/auth.test.ts`.
3. [09-data.md](09-data.md) and [10-config-and-secrets.md](10-config-and-secrets.md).

**Day 4: before you change anything.**
1. [14-gotchas.md](14-gotchas.md) and [13-how-to-contribute.md](13-how-to-contribute.md).
2. Run `npm test` and `npm run typecheck` in `server/`, and `npm run typecheck` in `ui/`.

**Day 5: your first change.** Pick a task below.

## Starter tasks

These were found by reading the code. Each is small and low-risk.

**1. Make blank settings safe.**
A blank `NAME=` replaces the default instead of using it (see [10-config-and-secrets.md](10-config-and-secrets.md)). Change the code that reads settings (for example in `server/src/core/genie/client.ts`) to treat an empty string as unset, and add a test.

**2. Fix the README's `chart_agent` line.**
`README.md` says the supervisor delegates to a `chart_agent`. It does not exist. Correct the sentence (check with the team first).

**3. Retire or refresh the older Markdown docs.**
`docs/01-big-picture.md` to `docs/05-settings-limits-and-cookbook.md` overlap with `docs/code-guide.html`. Check each against the code, then update or remove it (check with the team first).

**4. Add a test for the chart-clearing rule.**
`createAskGenieTool` clears `collector.chart` when a later answer is not a chart (`server/src/core/agents/askGenie.ts`). No test covers it. Add one with a fake client, using the pattern in `server/src/core/genie/client.test.ts`. This is also the first test of a tool, so mention that in the pull request.

**5. Add tests for the cookie helper.**
`cookie()` in `server/src/adapters/local/auth/sessions.ts` adds `Secure` only when asked. `auth.test.ts` tests cookie parsing but not cookie writing. Add two small tests.

Bigger ideas, not for week one: validate request bodies with the zod schemas, add a lint setup, add UI tests, log stream errors on the server.

## Who to ask

The repo names no owners. Until that is clear:

- Data and Genie questions: the team that owns the Databricks workspace and the Genie spaces.
- Deployment and logs: the platform or DevOps team.
- Business meaning of terms like FOT: a reinsurance domain expert.
- Everything else: your team lead.

The full list of unanswered questions is in [99-open-questions.md](99-open-questions.md).

## Key takeaways
- Read the picture first (02, 05), then run the app, then read the code.
- Read [14-gotchas.md](14-gotchas.md) before you change anything.
- Start with a config, docs or test task.
- Ask humans about owners, deployment and domain words. The repo cannot answer them.

## Where to look in the code
- `server/src/mastra/index.ts`: the main file.
- `server/src/core/genie/client.ts`, `server/src/core/agents/prompts.ts`: task 1.
- `README.md`, `docs/01-big-picture.md` to `docs/05-settings-limits-and-cookbook.md`: tasks 2 and 3.
- `server/src/core/agents/askGenie.ts`, `server/src/adapters/local/auth/sessions.ts`: tasks 4 and 5.
