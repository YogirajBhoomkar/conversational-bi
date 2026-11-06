import { describe, expect, it } from 'vitest';
import { newCollector, type TurnValues } from '../chat/collector';
import { createClarifyTool } from './clarify';

describe('ask_user_to_choose', () => {
  const run = async (input: unknown) => {
    const collector = newCollector();
    const values = { collector } as Partial<TurnValues>;
    const out = await createClarifyTool().execute!(input as never, { requestContext: { get: (k: keyof TurnValues) => values[k] } } as never);
    return { collector, out };
  };

  it('hands the question and options to the answer and tells the model to stop', async () => {
    const { collector, out } = await run({ question: 'Which year do you mean?', options: ['Underwriting year', 'Calendar year'] });
    expect(collector.clarification).toEqual({ question: 'Which year do you mean?', options: ['Underwriting year', 'Calendar year'] });
    expect(out).toMatchObject({ shown: true });
  });

  it('rejects fewer than two or more than four options', async () => {
    for (const options of [['only one'], ['a', 'b', 'c', 'd', 'e']]) {
      const { collector } = await run({ question: 'Which?', options });
      expect(collector.clarification).toBeUndefined();
    }
  });
});
