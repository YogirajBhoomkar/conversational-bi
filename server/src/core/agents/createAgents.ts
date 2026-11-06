import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import type { MastraModelConfig } from '@mastra/core/llm';
import type { GenieClient } from '../../contracts';
import { agentName, askToolName, clarifyToolName, fetchFullToolName, genieAgentDescription, genieAgentInstructions, suggestInstructions, supervisorInstructions } from './prompts';
import type { SpaceRegistry } from '../genie/registry';
import { SUPPORTED_CHART_TYPES } from '../chart/chartSpec';
import { createAskGenieTool, createFetchFullResultsTool } from './askGenie';
import { createClarifyTool } from './clarify';

export type AgentSettings = { registry: SpaceRegistry; model: MastraModelConfig; domainRules: string; fullRowCap: number };

export function createAgents(client: GenieClient, { registry, model, domainRules, fullRowCap }: AgentSettings) {
  const { spaces } = registry;

  // One sub-agent per Genie space. Its only job is to turn a question into a Genie call and report faithfully.
  const genieAgents = Object.fromEntries(
    spaces.map((space) => [
      agentName(space.key),
      new Agent({
        id: agentName(space.key),
        name: agentName(space.key),
        description: genieAgentDescription(space),
        instructions: genieAgentInstructions(space),
        model,
        tools: {
          [askToolName(space.key)]: createAskGenieTool(space, client),
          [fetchFullToolName(space.key)]: createFetchFullResultsTool(space, client, fullRowCap),
        },
      }),
    ]),
  );

  const supervisor = new Agent({
    id: 'bi_supervisor',
    name: 'bi_supervisor',
    description: 'Conversational BI supervisor',
    instructions: supervisorInstructions({ spaces, domainRules, chartTypes: SUPPORTED_CHART_TYPES }),
    model,
    agents: { ...genieAgents },
    tools: { [clarifyToolName]: createClarifyTool() },
    memory: new Memory({ storage: new LibSQLStore({ id: 'bi-memory', url: 'file:./bi-memory.db' }) }),
    defaultOptions: { maxSteps: 12 },
  });

  // Writes the "suggested follow-ups" shown under an answer (Genie Agent mode returns none).
  const suggestAgent = new Agent({
    id: 'suggest_agent',
    name: 'suggest_agent',
    description: 'Suggests follow-up questions after an answer.',
    instructions: suggestInstructions({ spaces }),
    model,
  });

  return { supervisor, genieAgents, suggestAgent };
}
