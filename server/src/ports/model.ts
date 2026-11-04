// The language model the agents run on.
// Local: Anthropic, or an OpenAI-compatible endpoint. GC: most likely the OpenAI-compatible endpoint GC provides.
// The API key stays inside `model`; `label` is what the scratchpad shows and must not contain a secret.
import type { MastraModelConfig } from '@mastra/core/llm';

export interface ModelProvider {
  readonly model: MastraModelConfig;
  readonly label: string;
}
