// Builds the whole Conversational BI service from configuration and adapters. Nothing happens at import time:
// the composition root (mastra/index.ts) or another host (a NestJS module, a test) calls this once.
import type { BiConfig } from '../config/load';
import type { ChatRequest, FeedbackRequest } from '../contracts';
import type { TokenProvider } from '../ports/auth';
import type { BiRequestContext } from '../ports/context';
import type { BiLogger } from '../ports/logger';
import type { ModelProvider } from '../ports/model';
import { createAgents } from './agents/createAgents';
import { handleChat, handleFeedback } from './chat/handleChat';
import { DatabricksGenieAgentClient } from './genie/agentClient';
import { DatabricksGenieClient } from './genie/client';
import { createSpaceRegistry } from './genie/registry';
import { retryPolicy } from './genie/retry';

export type BiAdapters = { tokens: TokenProvider; model: ModelProvider; logger: BiLogger };

export function createBiService(config: BiConfig, adapters: BiAdapters) {
  const registry = createSpaceRegistry(config.spaces);
  const genieOptions = { host: config.databricks.host, rowCap: config.genie.rowCap, timeoutMs: config.genie.timeoutMs, retry: retryPolicy(config.genie.retryAttempts) };
  // GENIE_MODE=agent uses Genie Agent mode (GA), which streams the agent's reasoning. Default is the Conversation API.
  const genie = config.genie.mode === 'agent' ? new DatabricksGenieAgentClient(adapters.tokens, genieOptions) : new DatabricksGenieClient(adapters.tokens, genieOptions);
  const { supervisor, genieAgents, suggestAgent } = createAgents(genie, { registry, model: adapters.model.model, domainRules: config.domainRules, fullRowCap: config.genie.fullRowCap });
  const chatDeps = { supervisor, suggestAgent, registry, modelLabel: adapters.model.label, suggestWaitMs: config.suggestWaitMs, genieMode: config.genie.mode, logger: adapters.logger, turnTimeoutMs: config.service.turnTimeoutMs, history: config.history };

  return {
    registry,
    agents: { supervisor, suggestAgent, ...genieAgents },
    handleChat: (ctx: BiRequestContext, request: ChatRequest) => handleChat(chatDeps, ctx, request),
    handleFeedback: (ctx: BiRequestContext, request: FeedbackRequest) => handleFeedback({ genie, registry, logger: adapters.logger }, ctx, request),
  };
}

export type BiService = ReturnType<typeof createBiService>;
