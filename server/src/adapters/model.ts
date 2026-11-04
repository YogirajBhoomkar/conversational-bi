// The language model, from configuration. openai-compatible: an endpoint such as a model gateway (what GC is expected to
// provide); anthropic: Anthropic directly (local default). The label is the model name, shown in the scratchpad.
// TODO(GC:model-endpoint) confirm GC's endpoint is OpenAI-compatible (chat completions) and which model name to use.
import type { ModelSettings } from '../config/load';
import type { ModelProvider } from '../ports/model';

export function createModelProvider(m: ModelSettings): ModelProvider {
  const model =
    m.provider === 'openai-compatible'
      ? { id: `litellm/${m.model}` as const, url: m.baseUrl, apiKey: m.apiKey }
      : { id: `anthropic/${m.model}` as const, apiKey: m.apiKey };
  return { model, label: m.model };
}
