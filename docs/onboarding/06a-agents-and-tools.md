# 06a. Agents and tools

## What you will learn
- The three kinds of agent in the server and what each one does.
- What a tool is, and what the two tools do.
- How the collector, memory and conversation ids fit in.
- How to add a Genie space.
- Where the agent rules are written, and how to change them safely.

## What an agent is

An **agent** here is an AI model plus a set of written instructions plus a list of tools it may call. You define it in code with `new Agent({...})` from `@mastra/core/agent`. A **tool** is a normal function the agent may call. It has a name, a description, and typed input and output (`createTool` with zod types).

## The three agents

All are built in `createAgents` in `server/src/mastra/agents/index.ts`.

| Agent id | Count | Job |
|---|---|---|
| `bi_supervisor` | 1 | Reads the user's question, delegates to a specialist, writes the final answer |
| `genie_<key>` | 1 per Genie space (2 today: `placement`, `capacity`) | Turns the question into a Genie call and reports faithfully |
| `suggest_agent` | 1 | Writes up to three follow-up questions from the Genie descriptions and the chat so far. Runs in parallel with the answer |

The supervisor gets the specialists in its `agents` option. That is how it can delegate to them. It also gets `maxSteps: 12`, a limit on how many agent and tool steps one request may take.

## Which model

The `model()` function picks the AI model:

```ts
const baseUrl = process.env.LLM_BASE_URL;
if (baseUrl) {
  return { id: `litellm/${process.env.LLM_MODEL ?? 'gpt-5.1'}`, url: baseUrl, apiKey: process.env.LLM_API_KEY };
}
return `anthropic/${process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5'}` as const;
```

Notice there are two modes: a custom OpenAI-compatible endpoint (for example a proxy), or Anthropic by default. The snippet is shortened from `server/src/mastra/agents/index.ts`.

## The tools

Both are in `server/src/mastra/tools/askGenie.ts`. Each Genie agent gets its own pair, named with the space key.

**`ask-<key>`** (`createAskGenieTool`):
1. Calls the Genie client with the question, the stored conversation id, and the user's session id.
2. Sends progress lines to the browser with `collector.emit`.
3. Remembers the new conversation id.
4. Runs `parseGenieChartJson`. If it is chart data, it swaps in the real table and sets `collector.chart`. If not, `collector.chart` becomes `null`.
5. Saves the result in the collector and as the "last result".
6. Returns a **small** object to the AI: summary, SQL, columns, 20 sample rows, row counts, `truncated`, `chartReady`, `error`.

**`fetch-full-<key>`** (`createFetchFullResultsTool`): loads more rows of the previous query. It exists because the table normally shows only a preview (200 rows by default). It is meant for when the user asks for "all the data". The cap is `GENIE_FULL_ROW_CAP`, default 5000. It works only in Agent mode, because it needs a statement id and `fetchFullResult` (`server/src/genie/agentClient.ts`).

## The collector

See [02-big-picture.md](02-big-picture.md). In short: a per-request object, created in the chat route and passed through `RequestContext`. Tools use `getCollector(requestContext)` to reach it (`server/src/mastra/collector.ts`). If it is missing, `getCollector` throws `collector missing from request context`.

## Memory and conversations

Two different things keep context:

| What | Where | Lifetime |
|---|---|---|
| The supervisor's chat memory | `Memory` with a `LibSQLStore` file `bi-memory.db` (`server/src/mastra/agents/index.ts`) | On disk |
| Genie's own conversation id per thread and space | A `Map` in `server/src/genie/conversations.ts` | In memory, lost on restart |

After a restart the supervisor still remembers the chat, but Genie starts a new conversation. This is noted in the README ("Known limits").

## How the supervisor decides

All the rules are plain text inside the supervisor's `instructions`:

- Routing by topic: placement, status, layer, total limit and FOT premium go to `genie_placement`. Reinsurer, capacity, authorized or signed, declines and quoted premium go to `genie_capacity`.
- Never invent numbers.
- Ask one short question if unclear.
- Chart requests: pass the word "chart" in the question to Genie, in one call. The list of drawable chart types comes from `SUPPORTED_CHART_TYPES` in `server/src/mastra/chartSpec.ts`.
- If the result is truncated, say so and ask before loading the rest.
- Final answer is short plain prose. No tables, no lists.

Because the rules are text, changing wording can change behaviour in ways tests will not catch. There are no tests for the agents.

## How to add a Genie space

1. Open `server/src/genie/registry.ts`.
2. Add an entry to `genieSpaces`:
   ```ts
   {
     key: 'mynew',                 // used in agent and tool names
     name: 'Display name',
     description: 'What it owns, and what it does not.',
     spaceId: process.env.DATABRICKS_GENIE_MYNEW_SPACE_ID ?? '<space-id>',
   },
   ```
3. Write the `description` carefully. The supervisor routes by it (`README.md`, "Adding a Genie space").
4. Add routing words for the new space to the `ROUTING` block of the supervisor instructions in `server/src/mastra/agents/index.ts`. The current routing lines name `genie_placement` and `genie_capacity` explicitly.
5. The agent, the two tools and the registration in the `Mastra` object are created automatically from the list (`createAgents`, and `genieAgents` in `server/src/mastra/index.ts`).
6. Use the setting name pattern of the existing entries, add it to `server/.env.example`, and rebuild.

Step 4 is my reading of the code. The README says only that routing uses the `description`, but the supervisor prompt also has hard-coded routing lines. See [14-gotchas.md](14-gotchas.md).

## Key takeaways
- Supervisor, one specialist per Genie space, and a follow-up writer.
- Tools return small summaries to the AI and put the big data in the collector.
- Agent behaviour is controlled by instruction text, and it is untested.
- Adding a space is a few lines in `registry.ts`, plus a routing line in the supervisor.

## Where to look in the code
- `server/src/mastra/agents/index.ts`: `createAgents`, `model`.
- `server/src/mastra/tools/askGenie.ts`: both tools.
- `server/src/mastra/collector.ts`: `getCollector`, `getThreadId`.
- `server/src/genie/registry.ts`: `genieSpaces`.
- `server/src/genie/conversations.ts`: conversation maps.
- `server/src/mastra/suggest.ts`: `suggestFollowUps`.
