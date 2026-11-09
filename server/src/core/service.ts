// Builds the whole Conversational BI service from configuration and adapters. Nothing happens at import time:
// the composition root (mastra/index.ts) or another host (a NestJS module, a test) calls this once.
import type { BiConfig } from '../config/load';
import type { ChatRequest, FeedbackRequest } from '../contracts';
import type { TokenProvider } from '../ports/auth';
import type { BiRequestContext } from '../ports/context';
import type { BiLogger } from '../ports/logger';
import type { ModelProvider } from '../ports/model';
import { createAgents } from './agents/createAgents';
import { scopeMessage } from './agents/prompts';
import { type ChatDeps, handleChat, handleFeedback } from './chat/handleChat';
import { createOutputGuard } from './guards/output';
import { DatabricksGenieAgentClient } from './genie/agentClient';
import { DatabricksGenieClient } from './genie/client';
import { createGenieLimiter } from './genie/limiter';
import { createSpaceRegistry } from './genie/registry';
import { inputGuards } from './guards/input';
import { retryPolicy } from './genie/retry';

// guardModel: the model of the prompt-injection check, when BI_GUARD_INJECTION is on.
export type BiAdapters = { tokens: TokenProvider; model: ModelProvider; logger: BiLogger; guardModel?: ModelProvider };

export function createBiService(config: BiConfig, adapters: BiAdapters) {
  const registry = createSpaceRegistry(config.spaces);
  const scope = scopeMessage(registry.spaces, config.scope.message); // one message, in the prompt and the reply check
  const genieOptions = { host: config.databricks.host, rowCap: config.genie.rowCap, timeoutMs: config.genie.timeoutMs, retry: retryPolicy(config.genie.retryAttempts),
    // One limiter for the instance, shared by every space and user: the quota is per workspace.
    limiter: createGenieLimiter({ maxPerMinute: config.genie.maxPerMinute, maxWaitMs: config.genie.queueWaitMs }) };
  // GENIE_MODE=agent uses Genie Agent mode (GA), which streams the agent's reasoning. Default is the Conversation API.
  const genie = config.genie.mode === 'agent' ? new DatabricksGenieAgentClient(adapters.tokens, genieOptions) : new DatabricksGenieClient(adapters.tokens, genieOptions);
  const { supervisor, genieAgents, suggestAgent } = createAgents(genie, {
    registry,
    model: adapters.model.model,
    domainRules: config.domainRules,
    fullRowCap: config.genie.fullRowCap,
    inputGuards: inputGuards({ injection: config.guards.injection, model: adapters.guardModel?.model, failClosed: config.guards.failClosed }),
    scopeMessage: scope,
  });
  const chatDeps: ChatDeps = {
    supervisor,
    suggestAgent,
    registry,
    modelLabel: adapters.model.label,
    suggestWaitMs: config.suggestWaitMs,
    genieMode: config.genie.mode,
    logger: adapters.logger,
    outputGuard: createOutputGuard(config.outputGuard, registry),
    turnTimeoutMs: config.service.turnTimeoutMs,
    history: config.history,
    grounding: config.grounding,
  };

  return {
    registry,
    agents: { supervisor, suggestAgent, ...genieAgents },
    handleChat: (ctx: BiRequestContext, request: ChatRequest) => handleChat(chatDeps, ctx, request),
    handleFeedback: (ctx: BiRequestContext, request: FeedbackRequest) => handleFeedback({ genie, registry, logger: adapters.logger }, ctx, request),
  };
}

export type BiService = ReturnType<typeof createBiService>;
