# 09. Data

> **Written before the November 2026 restructure.** File paths are updated, but some descriptions are out of date: routes, login and the chat turn are no longer in `server/src/mastra/index.ts` (now only the wiring), spaces and their ids are configuration, and settings are read once in `server/src/config`. Current layout: [03-repo-map.md](03-repo-map.md). Settings: `server/.env.example`.

## What you will learn
- Where data lives: Databricks, SQLite files, and memory.
- The main data shapes passed around.
- How the two Genie clients work.
- Limits that cut data off.

## There is no application database model

The app does not own business tables. The business data lives in Databricks and is reached through Genie. The app keeps only chat state.

| Store | What | Where |
|---|---|---|
| Databricks (via Genie) | All business data | Outside this repo |
| SQLite file `mastra.db` | Mastra's own storage | `server/src/mastra/index.ts`, `LibSQLStore` at `file:./mastra.db` |
| SQLite file `bi-memory.db` | The supervisor's chat memory | `server/src/core/agents/prompts.ts`, `Memory` |
| Server memory | Sessions, PKCE state, Genie conversation ids, last results | `server/src/adapters/local/auth/*.ts`, `server/src/core/genie/conversations.ts` |
| Browser `localStorage` | The current thread id, key `bi-thread` | `ui/src/App.tsx` |

**SQLite** is a database kept in a single file. **LibSQL** is a fork of it that Mastra uses.

Where the `.db` files land at run time depends on the folder the server starts in. I could not confirm that. See [99-open-questions.md](99-open-questions.md). They are git-ignored (`.gitignore`, `*.db`).

## The main shapes

All in `server/src/contracts.ts`. Each has a zod schema and a TypeScript type.

**`GenieResult`**: what one Genie call returns.

| Field | Meaning |
|---|---|
| `spaceId`, `question` | What was asked and where |
| `summary` | Genie's own text answer |
| `sql` | The SQL Genie ran, or null |
| `columns`, `rows` | The table. Rows are capped |
| `totalRows` | The real row count |
| `thinking` | Genie's reasoning steps |
| `suggestedQuestions` | Genie's suggested follow-ups |
| `statementId` | Id of the SQL statement, used to load the full result |
| `conversationId`, `messageId` | Genie ids, used for follow-ups and feedback |
| `error` | Error text, or null |

**`FinalAnswer`**: what the browser gets in the `final` event. It holds the answer text, `columns`, `rows`, `totalRows`, `charts` (a list, empty for table only; `chartSpec` is the deprecated first one), `sources`, `suggestedQuestions`. If `rows.length < totalRows`, the UI shows a "preview" label.

**`ChartSpec`**: see [07a-charts.md](07a-charts.md).

**`ChatEvent`**: the stream messages. See [05-request-journey.md](05-request-journey.md).

**Interfaces:** `GenieClient` (`ask`, `feedback`, optional `fetchFullResult`) and `TokenProvider` (`getToken`). Code elsewhere depends on these, not on a particular client.

The browser has its own copy of these shapes in `ui/src/types.ts`. They are kept in sync by hand ("keep in sync" comment at the top of that file).

## The two Genie clients

The choice is made once, at start, from `GENIE_MODE` (`server/src/mastra/index.ts`).

| | Conversation API (default) | Agent mode (`GENIE_MODE=agent`) |
|---|---|---|
| File | `server/src/core/genie/client.ts` | `server/src/core/genie/agentClient.ts` |
| How | Start a conversation, then **poll** the message until it completes | One request, answers **streamed** as events |
| Progress shown | Status names and Genie's "thoughts" | Real reasoning, each query, the final text |
| Full results | Not available (`statementId` is null) | `fetchFullResult` pages through the SQL Statement API |
| API status | No separate GA entry found in the release notes we read | **GA** since 27 Aug 2026 (only the Flash option is Beta) |

Notice that Agent mode still uses the Conversation client for feedback (`agentClient.ts`, `feedback`).

Both clients return an error **inside** the result (`error` field) instead of throwing. That is how a failed Genie call reaches the AI as plain text.

## Limits that cut data

| Limit | Default | Setting | Code |
|---|---|---|---|
| Rows kept per result | 200 | `GENIE_ROW_CAP` | `client.ts`, `agentClient.ts` |
| Rows when loading the full result | 5000 | `GENIE_FULL_ROW_CAP` | `tools/askGenie.ts` |
| Wait time for Genie | 180000 ms | `GENIE_TIMEOUT_MS` | `client.ts`, `agentClient.ts` |
| Sample rows shown to the AI | 20 | none | `tools/askGenie.ts` |
| Follow-up questions | 3 | none | `suggest.ts` |
| Agent steps per request | 12 | none | `agents/index.ts`, `maxSteps` |

If a result is larger than the cap, `totalRows` is higher than `rows.length`. The agent is told to say the table shows a preview and to ask before loading more.

## Reading and writing

- **Reads from Genie** happen only through the two clients.
- **Writes to Genie:** only feedback (thumbs up or down), via `POST .../feedback` (`client.ts`, `feedback`).
- **Writes to local storage:** done by Mastra for memory. The app code does not write SQL itself.

## External integrations

| Service | Used for | Code |
|---|---|---|
| Databricks Genie | Answers and SQL | `server/src/core/genie/` |
| Databricks SQL Statement API | Loading more rows (Agent mode) | `agentClient.ts`, `fetchFullResult` |
| Databricks OAuth and SCIM | Sign-in and user name | `server/src/adapters/local/auth/oauth.ts` |
| AI model provider | The agents' language model | `server/src/core/agents/prompts.ts` |
| Google Fonts | Fonts, loaded by the browser | `ui/index.html` |

## Key takeaways
- The app stores no business data. Databricks does.
- Chat state is split across two SQLite files, server memory, and one browser key.
- `GenieResult` is the core shape. `FinalAnswer` is what the browser gets.
- Two Genie modes exist. Only Agent mode can load full results.
- Row caps mean the table is often a preview.

## Where to look in the code
- `server/src/contracts.ts`: all shapes.
- `server/src/core/genie/client.ts` and `agentClient.ts`: the clients.
- `server/src/core/genie/conversations.ts`: in-memory maps.
- `server/src/core/agents/askGenie.ts`: row limits and the full-result tool.
