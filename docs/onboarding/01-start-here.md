# 01. Start here

## What you will learn
- What Conversational BI does and who uses it.
- How these docs are organised.
- Which order to read them in.
- Where the older docs fit.

Last verified against: no git repository was present, so there is no commit id. Checked against the files on disk on 2026-11-02.

## What the app is

Conversational BI is a chat app. A person types a business question in plain English. The app answers with a short text answer, a chart, a table of numbers, and the SQL that produced them.

The topics are reinsurance placements and reinsurer capacity (`server/src/mastra/agents/index.ts`, supervisor `instructions`).

Here is the idea in one line. The AI never makes up numbers. A Databricks tool called **Genie** finds the numbers. The AI only chooses which Genie to ask and writes the short answer.

**Genie** is a Databricks feature. You ask it a question in English. It writes SQL, runs it on your data, and returns rows. A **Genie space** is one configured Genie for one set of tables.

## Who uses it

Business users who want numbers without writing SQL. They sign in with their Databricks account (`server/src/auth/oauth.ts`). In local development they can skip sign-in and use one shared token instead (`server/src/mastra/index.ts`, `oauth` flag).

The repo does not say which team owns the app or who to ask. See [99-open-questions.md](99-open-questions.md).

## The two parts

| Part | Folder | What it is |
|---|---|---|
| Server | `server/` | A Node.js program. It holds the AI agents, talks to Genie, and sends results to the browser |
| Browser app | `ui/` | A React page. It shows the chat, the chart and the table |

In production one server process also serves the built browser app. So there is one address to open (`server/src/mastra/index.ts`, `serveUi`).

## How these docs are organised

| Doc | Read it to learn |
|---|---|
| [02-big-picture.md](02-big-picture.md) | The parts and how they talk |
| [03-repo-map.md](03-repo-map.md) | Every folder and file, and the naming habits |
| [04-run-it-locally.md](04-run-it-locally.md) | How to start the app on your machine |
| [05-request-journey.md](05-request-journey.md) | One question followed from click to chart. **Most important** |
| [06-backend.md](06-backend.md) | The server routes and the live stream |
| [06a-agents-and-tools.md](06a-agents-and-tools.md) | The AI agents, tools, and how to add a Genie space |
| [07-frontend.md](07-frontend.md) | The browser app |
| [07a-charts.md](07a-charts.md) | How charts are made, and how to switch chart library |
| [08-auth-and-access.md](08-auth-and-access.md) | Sign-in and sessions |
| [09-data.md](09-data.md) | The data shapes and where data is stored |
| [10-config-and-secrets.md](10-config-and-secrets.md) | Settings (names only) |
| [11-build-test-deploy.md](11-build-test-deploy.md) | Build and tests. Deployment is unknown |
| [12-logging-and-monitoring.md](12-logging-and-monitoring.md) | What is logged and how to debug |
| [13-how-to-contribute.md](13-how-to-contribute.md) | Conventions, checklist, two recipes |
| [14-gotchas.md](14-gotchas.md) | Surprises and weak spots |
| [15-glossary.md](15-glossary.md) | Every term in plain English |
| [16-first-week.md](16-first-week.md) | Reading order and starter tasks |
| [99-open-questions.md](99-open-questions.md) | What the repo could not answer |
| [00-plan.md](00-plan.md) | The plan these docs were built from |

## Reading order

1. This doc.
2. 02, then 05. These two give you the whole picture.
3. 04, and run the app.
4. 06, 06a, 07, 07a, 08, 09 as you need them.
5. 14 before you change anything risky.

## The older docs

The folder `docs/` also holds older files (`docs/README.md`, `docs/01-big-picture.md` to `docs/05-settings-limits-and-cookbook.md`, `docs/code-guide.html`). These onboarding docs were checked against the code directly. Where an older doc disagrees with the code, trust the code. One known case: `docs/code-guide.html` still describes Vega-Lite charts, which the code no longer uses. See [14-gotchas.md](14-gotchas.md).

## Key takeaways
- It is a chat app: question in, short answer plus chart plus table plus SQL out.
- Genie supplies the numbers. The AI model only routes questions and writes the summary.
- `server/` holds the brain. `ui/` holds the screen. One process serves both in production.
- When docs and code disagree, trust the code.

## Where to look in the code
- `README.md`: the project's own summary.
- `server/src/mastra/index.ts`: the server's main file.
- `ui/src/App.tsx`: the browser app's main file.
- `run.mjs`: the setup, build and start script.
