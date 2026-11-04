import type { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import type { SpaceRegistry } from '../genie/registry';
import type { Turn } from './history';

// Follow-ups use only what the data agents say they cover (their descriptions, in the agent's instructions) and the chat so far.
// Each follow-up names the one data agent that can answer it, so we only offer questions the assistant can really handle.
const suggestionsSchema = (registry: SpaceRegistry) =>
  z.object({ questions: z.array(z.object({ question: z.string(), space: z.enum(registry.spaces.map((s) => s.key) as [string, ...string[]]) })).max(3) });

export type SuggestInput = {
  question: string; // the question the user has just asked
  history: Turn[];  // earlier turns of this chat, oldest first
};

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const norm = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const promptOf = ({ question, history }: SuggestInput) =>
  [
    history.length
      ? `Earlier in this chat (oldest first):\n${history
          .map((t, i) => `${i + 1}. Asked: ${t.question}\n   Answer: ${clip(t.answer, 400)}${t.suggested.length ? `\n   Already suggested: ${t.suggested.join(' / ')}` : ''}`)
          .join('\n')}\n`
      : '',
    `The user has just asked: ${question}`,
    '\nSuggest follow-up questions.',
  ]
    .filter(Boolean)
    .join('\n');

// Best effort: follow-ups are a nicety, so any failure just means none are shown. Never rejects.
export async function suggestFollowUps(agent: Agent, registry: SpaceRegistry, input: SuggestInput): Promise<string[]> {
  try {
    const out = await agent.generate(promptOf(input), { structuredOutput: { schema: suggestionsSchema(registry) } });
    const seen = new Set([input.question, ...input.history.flatMap((t) => [t.question, ...t.suggested])].map(norm));
    const questions: string[] = [];
    for (const { question, space } of out.object?.questions ?? []) {
      const q = question.trim();
      if (!q || !registry.byKey(space) || seen.has(norm(q))) continue;
      seen.add(norm(q));
      questions.push(q);
    }
    return questions.slice(0, 3);
  } catch (e) {
    console.warn('[suggest] failed:', e instanceof Error ? e.message : e);
    return [];
  }
}
