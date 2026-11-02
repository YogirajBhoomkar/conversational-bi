# 99. Open questions

## What you will learn
- What these docs could not confirm from the repo.
- What was checked for each question.
- Who would likely know.

Each question says what I checked. Where the docs made a choice anyway, it says which one.

## Process and ownership

| # | Question | What I checked | Likely owner | Choice made in the docs |
|---|---|---|---|---|
| 1 | What are the branch, pull request and review rules? | No `.git`, no PR template, no `CODEOWNERS`, no contributing file | Team lead | [13-how-to-contribute.md](13-how-to-contribute.md) says "ask" |
| 2 | What commit id should "last verified" use? | No git repository, so no `git log` or commit id | Team lead | [01-start-here.md](01-start-here.md) uses the date and says no commit id exists |
| 3 | Who owns this app, and who answers questions? | Searched for owner names and contact files: none | Team lead | [16-first-week.md](16-first-week.md) lists roles, not people |
| 4 | Should the new docs replace or sit beside the older `docs/` files? | The two sets overlap. `docs/code-guide.html` is out of date | Team lead | Kept separate under `docs/onboarding/` |

## Deployment and operations

| # | Question | What I checked | Likely owner | Choice made |
|---|---|---|---|---|
| 5 | How does the app reach dev, QC and prod? | Searched the whole repo for Dockerfile, Helm chart, CI or CD files: none | Platform or DevOps | [11-build-test-deploy.md](11-build-test-deploy.md) lists questions only |
| 6 | Are there security or dependency scans in the pipeline? | Same search | Platform or DevOps | Not documented |
| 7 | Where do production secrets and settings come from? | Only `server/.env` and the shell are used in code | Platform or DevOps | [10-config-and-secrets.md](10-config-and-secrets.md) lists names only |
| 8 | Is production meant to run one server copy? | Sessions, PKCE state and conversation ids are in memory (`server/src/auth/*.ts`, `server/src/genie/conversations.ts`) | App owner, platform | Documented as single-copy |
| 9 | Where do logs, alerts and dashboards live? | Only `console` calls found in the code | Platform or DevOps | [12-logging-and-monitoring.md](12-logging-and-monitoring.md) lists questions |
| 10 | What Node version is required? | README says "20 or newer". No `engines` field, `.nvmrc` or container file | Platform or DevOps | Documented as "20 or newer, per README" |
| 11 | Where does `mastra start` write `mastra.db` and `bi-memory.db`? | Code uses relative `file:./...` paths. README says "next to the running server". No `.db` file found in `server/` at the time of checking | App owner | Documented as "depends on the start folder" |
| 12 | How is the app fronted in production (proxy, TLS)? | The cookie `Secure` flag depends on the request URL (`server/src/mastra/index.ts`) | Platform or DevOps | Flagged in [14-gotchas.md](14-gotchas.md) |
| 13 | Is the UI always served from the same address as the API? | CORS allows only `http://localhost:5173` (`server/src/mastra/index.ts`) | App owner | Assumed same origin in production |

## Data and behaviour

| # | Question | What I checked | Likely owner | Choice made |
|---|---|---|---|---|
| 14 | Which Genie mode runs in production? | `GENIE_MODE=agent` uses a Beta API (`server/src/genie/agentClient.ts`). Default is the Conversation API | App owner | Both documented |
| 15 | Are the hard-coded fallback Genie space ids in `server/src/genie/registry.ts` intended? | Read the file. Ids were not copied into the docs | App owner, security | Flagged in [14-gotchas.md](14-gotchas.md) |
| 16 | Which Genie space is attached to the "corridor profitability" data? | README says early tests returned placement data and read "corridor" as a region | Data owner | Not documented beyond the README note |
| 17 | What does "FOT" stand for? | The code uses it as a status and a premium measure but never spells it out | Reinsurance domain expert | [15-glossary.md](15-glossary.md) says "not spelled out" |
| 18 | Does the supervisor's tool-step filter match how sub-agent tools appear? | `stepOf` in `server/src/mastra/index.ts` matches tool names that contain `genie`. I did not run the app to see the names Mastra reports | App owner | [05-request-journey.md](05-request-journey.md) describes the intended behaviour |
| 19 | Where is `ANTHROPIC_API_KEY` read? | Not in the repo's code. Presumably by the Mastra AI layer from the `anthropic/...` model name | App owner | Documented as "read by the AI library" |
| 20 | What does Mastra Studio show? | Only the README mentions it. I did not run it | App owner | Described from the README |
| 21 | Should a reload restore the chat messages? | The thread id is saved but messages are not (`ui/src/App.tsx`) | App owner | Listed in [14-gotchas.md](14-gotchas.md) |
| 22 | Can the shared dev-mode user `dev` ever be used in a shared environment? | Shared-token mode makes every user `dev` and shares threads | App owner, security | Documented as dev only, per README |

## Docs that disagree with code

| # | Item | What I found | Choice made |
|---|---|---|---|
| 23 | `README.md` mentions a `chart_agent` | None exists in `server/src/mastra/agents/index.ts` | Docs follow the code |
| 24 | `docs/code-guide.html` describes Vega-Lite charts | Charts are now library-neutral, drawn by Recharts, Plotly or D3 | Docs follow the code. Task 3 in [16-first-week.md](16-first-week.md) |

## Key takeaways
- Most gaps are about people and environments, not code: owners, deployment, logging, secrets.
- A few behaviours were not run: Studio, tool-step names, and the real OAuth flow.
- Where the docs had to choose, they follow the code.

## Where to look in the code
- `server/src/mastra/index.ts`: items 8, 12, 13, 18.
- `server/src/genie/registry.ts`: item 15.
- `server/src/genie/agentClient.ts`: item 14.
- `README.md`: items 11, 16, 23.
