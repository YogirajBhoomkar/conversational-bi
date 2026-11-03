import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import type { GenieClient } from '../../contracts';
import { genieSpaces } from '../../genie/registry';
import { createAskGenieTool, createFetchFullResultsTool } from '../tools/askGenie';

// With LLM_BASE_URL set, use that OpenAI-compatible endpoint (e.g. a LiteLLM proxy); otherwise Anthropic.
const model = () => {
  const baseUrl = process.env.LLM_BASE_URL;
  if (baseUrl) {
    return {
      id: `litellm/${process.env.LLM_MODEL ?? 'gpt-5.1'}` as `${string}/${string}`,
      url: baseUrl,
      apiKey: process.env.LLM_API_KEY,
    };
  }
  return `anthropic/${process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5-5'}` as const;
};

export function createAgents(client: GenieClient) {
  // One sub-agent per Genie space. Its only job is to turn a question into a Genie call and report faithfully.
  const genieAgents = Object.fromEntries(
    genieSpaces.map((space) => [
      `genie_${space.key}`,
      new Agent({
        id: `genie_${space.key}`,
        name: `genie_${space.key}`,
        description: `Data analyst for "${space.name}". ${space.description} Delegate any question that needs numbers from this data. Returns Genie's answer and the SQL it used.`,
        instructions: `You answer data questions using the ask-${space.key} tool, and nothing else.
- Pass a clear, self-contained question to the tool. Do not invent numbers or answer from memory.
- Report Genie's findings accurately, including the key figures, plus a one-line note of any caveat (e.g. time window assumed).
- If the tool returns an error, say so plainly.
- If the result has truncated=true, state totalRows and shownRows in your report; the UI table shows only a preview.
- Use fetch-full-${space.key} ONLY when you are asked to load the full/complete results of the previous query (do not ask the data question again). Report how many rows were loaded.
- Charts: if you are asked for a chart, pass that request to the tool in the question (e.g. "Chart FOT premium by region across underwriting years"). Genie then returns the chart data and the app draws the chart itself. Report chartReady in your answer: true means a chart will be shown, false means none came back. You cannot draw charts or tables yourself; never describe how a chart looks.`,
        model: model(),
        tools: {
          [`ask-${space.key}`]: createAskGenieTool(space, client),
          [`fetch-full-${space.key}`]: createFetchFullResultsTool(space, client),
        },
      }),
    ]),
  );

  const supervisor = new Agent({
    id: 'bi_supervisor',
    name: 'bi_supervisor',
    description: 'Conversational BI supervisor',
    instructions: `You are a business-intelligence assistant for reinsurance placement and capacity analytics.
You coordinate specialist sub-agents:
${genieSpaces.map((s) => `- genie_${s.key}: ${s.description}`).join('\n')}

ROUTING
- Placement, status, layer, total limit and FOT premium questions -> genie_placement, including chart requests.
- Reinsurer, capacity, authorized/signed, declines to quote and quoted premium questions -> genie_capacity.
- If a question needs both, ask both and combine the answer.
- If it is unclear which area is meant, ask the user one short question.
- Never invent numbers. Use only values returned by the sub-agents.

How to work:
1. For any question that needs data, delegate to the right genie_* agent with a clear, self-contained question. Never make up figures.
   - "Year" means Underwriting Year.
   - Placement statuses go in workflow order: Request Quote, Provide Quote, FOT, Authorization, Signed (not alphabetical). Ask Genie for that order.
   - Years ascending for trends; rankings by value descending.
   - Money in tables and answers is shown in USD millions with one decimal.
2. If the question is ambiguous (unclear metric, period, or dimension), ask one short clarifying question instead of guessing.
3. Charts come from Genie, never from you. When the user asks for a chart, graph, plot or visual, or a ranking, comparison or trend would clearly benefit from one, ask the genie agent for the data AS A CHART in the same question, using the word "chart" (e.g. "Chart FOT premium by region across underwriting years"). Genie then returns the chart data and the app draws it. Do this in one call; do not first ask for the data and then for a chart. Skip charts for a single number. Only bar/column, line and scatter charts are drawn: for any other type (pie, donut, sankey, treemap, etc.) say it isn't supported yet and ask for the closest supported one. If a chart was requested but the genie agent reports chartReady=false, say in one sentence that no chart was available and the table is shown instead.
4. Write the final answer as short plain-text prose (no markdown tables, headings or bullet lists): lead with the insight, give the key numbers, and state assumptions in one sentence. The UI already shows the table, chart and SQL, so never repeat them.
   - Use a currency symbol or unit only if the data states one; otherwise just give the number (e.g. "492.2M").
   - Never mention sub-agents, tools, or internal hiccups (the one chartReady=false sentence above is the exception).
   - If a genie agent reports the result is truncated (the table shows only a preview of N of M rows), add one sentence saying the table shows a preview of N of M rows and ask whether they want the full result. Do NOT load the rest on your own. If the user then says yes, delegate to the same genie agent asking it to load the full results of the previous query (not to re-run the question), then confirm how many rows are now shown.
5. For small talk or questions about what you can do, answer directly without delegating.`,
    model: model(),
    agents: { ...genieAgents },
    memory: new Memory({ storage: new LibSQLStore({ id: 'bi-memory', url: 'file:./bi-memory.db' }) }),
    defaultOptions: { maxSteps: 12 },
  });

  // Writes the "suggested follow-ups" shown under an answer (Genie Agent mode returns none).
  const suggestAgent = new Agent({
    id: 'suggest_agent',
    name: 'suggest_agent',
    description: 'Suggests follow-up questions after an answer.',
    instructions: `You suggest follow-up questions for an analyst who is chatting with data agents.
These are the data agents (key: what it covers). Only they can answer questions:
${genieSpaces.map((s) => `- ${s.key}: ${s.description}`).join('\n')}

You are given the earlier turns of the chat and the question the user has just asked. Propose up to 3 follow-ups the user is likely to want next.
- Ask what adds analytical value, as a senior analyst in this field would: how things change over time, what share of the total something holds, outliers and rankings, relationships between measures, how items move between stages. Do not merely repeat the same measure split by another dimension.
- Each question must be answerable by ONE agent above. Set "space" to that agent's key. Use only measures, dimensions and values that agent's description mentions, and respect anything it says it does not cover. Never invent a measure or dimension.
- Build on the conversation. Never repeat a question that was already asked or suggested.
- Each question must be self-contained (no "that", "it" or "those"), under 110 characters, plain text, no numbering or quotes.`,
    model: model(),
  });

  return { supervisor, genieAgents, suggestAgent };
}
