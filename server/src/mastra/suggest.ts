import type { Agent } from '@mastra/core/agent';
import { z } from 'zod';

const Suggestions = z.object({ questions: z.array(z.string()).max(3) });

// Best effort: follow-ups are a nicety, so any failure just means none are shown.
export async function suggestFollowUps(
  agent: Agent,
  { question, answer, columns }: { question: string; answer: string; columns: string[] },
): Promise<string[]> {
  try {
    const out = await agent.generate(
      `User question: ${question}\nAnswer: ${answer}\n${columns.length ? `Result columns: ${columns.join(', ')}\n` : ''}Suggest follow-up questions.`,
      { structuredOutput: { schema: Suggestions } },
    );
    return (out.object?.questions ?? []).map((q) => q.trim()).filter(Boolean).slice(0, 3);
  } catch (e) {
    console.warn('[suggest] failed:', e instanceof Error ? e.message : e);
    return [];
  }
}
