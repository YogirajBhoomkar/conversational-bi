// A scripted language model for tests: each call takes the next step (text or one tool call) and records the prompt
// it was given. Written against the plain AI SDK v2 model interface, so it works with every Mastra version we support.
import type { LanguageModelV2, LanguageModelV2CallOptions, LanguageModelV2StreamPart } from '@ai-sdk/provider-v5';

export type StubStep = { text: string } | { toolName: string; args: object };
export type StubUsage = { inputTokens: number; outputTokens: number };

export function stubModel(steps: StubStep[], usage: StubUsage = { inputTokens: 10, outputTokens: 5 }) {
  const prompts: LanguageModelV2CallOptions['prompt'][] = [];
  let call = 0;
  const next = (options: LanguageModelV2CallOptions) => {
    prompts.push(options.prompt);
    return steps[Math.min(call++, steps.length - 1)];
  };
  const tokens = { ...usage, totalTokens: usage.inputTokens + usage.outputTokens };
  const parts = (step: StubStep): LanguageModelV2StreamPart[] => [
    { type: 'stream-start', warnings: [] },
    ...('text' in step
      ? ([{ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: step.text }, { type: 'text-end', id: 't' }] as LanguageModelV2StreamPart[])
      : ([{ type: 'tool-call', toolCallId: `call-${call}`, toolName: step.toolName, input: JSON.stringify(step.args) }] as LanguageModelV2StreamPart[])),
    { type: 'finish', finishReason: 'text' in step ? 'stop' : 'tool-calls', usage: tokens },
  ];
  const model: LanguageModelV2 = {
    specificationVersion: 'v2',
    provider: 'stub',
    modelId: 'stub-model',
    supportedUrls: {},
    doGenerate: async (options) => {
      const step = next(options);
      return {
        content: 'text' in step ? [{ type: 'text', text: step.text }] : [{ type: 'tool-call', toolCallId: `call-${call}`, toolName: step.toolName, input: JSON.stringify(step.args) }],
        finishReason: 'text' in step ? 'stop' : 'tool-calls',
        usage: tokens,
        warnings: [],
      };
    },
    doStream: async (options) => {
      const chunks = parts(next(options));
      return { stream: new ReadableStream({ start(c) { chunks.forEach((p) => c.enqueue(p)); c.close(); } }) };
    },
  };
  return { model, prompts };
}

// The text of each message of a recorded prompt, as "role: text", for assertions.
export const promptLines = (prompt: LanguageModelV2CallOptions['prompt']) =>
  prompt.map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : m.content.map((p) => ('text' in p ? p.text : `[${p.type}]`)).join('')}`);
