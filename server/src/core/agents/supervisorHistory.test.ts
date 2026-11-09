// The chat history comes from the UI with each request, not from Mastra Memory. These tests pin the Mastra behaviour
// that relies on (checked on every supported Mastra version by scripts/compat-check.mjs).
import { Agent } from '@mastra/core/agent';
import { describe, expect, it } from 'vitest';
import { promptLines, stubModel } from './stubModel';

const drain = async (stream: { fullStream: AsyncIterable<unknown> }) => {
  for await (const _ of stream.fullStream) void _;
};

describe('an agent with no Memory, given a plain messages array', () => {
  it('passes every earlier message to the model, in order', async () => {
    const { model, prompts } = stubModel([{ text: 'a2' }]);
    const agent = new Agent({ id: 's', name: 's', instructions: 'sys', model });
    await drain(await agent.stream([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ]));
    expect(promptLines(prompts[0]).filter((l) => !l.startsWith('system'))).toEqual(['user: q1', 'assistant: a1', 'user: q2']);
  });

  it('delegates to a sub-agent, which gets the question the supervisor wrote as its last message', async () => {
    const sub = stubModel([{ text: 'sub answer' }]);
    const child = new Agent({ id: 'child', name: 'child', description: 'answers data questions', instructions: 'child sys', model: sub.model });
    const sup = stubModel([{ toolName: 'agent-child', args: { prompt: 'Placement count by region in 2024' } }, { text: 'done' }]);
    const agent = new Agent({ id: 'sup', name: 'sup', instructions: 'sys', model: sup.model, agents: { child } });
    await drain(await agent.stream([{ role: 'user', content: 'Placement count in 2024' }, { role: 'assistant', content: '120' }, { role: 'user', content: 'and by region?' }]));
    expect(promptLines(sub.prompts[0]).at(-1)).toBe('user: Placement count by region in 2024');
  });
});
