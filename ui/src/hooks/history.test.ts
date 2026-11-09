import { describe, expect, it } from 'vitest';
import type { FinalAnswer, Message } from '../types';
import { buildHistory, MAX_ANSWER_CHARS, MAX_QUESTION_CHARS } from './history';

const result = (answer: string, spaceName?: string): FinalAnswer => ({
  answer, columns: [], rows: [], totalRows: 0, charts: [], chartSpec: null, suggestedQuestions: [],
  sources: spaceName ? [{ spaceId: 's', spaceName, question: 'q', sql: null, messageId: 'm', conversationId: 'c' }] : [],
});
const user = (id: string, text: string): Message => ({ id, role: 'user', text });
const reply = (id: string, over: Partial<Extract<Message, { role: 'assistant' }>> = {}): Message => ({ id, role: 'assistant', text: '', trace: [], startedAt: 0, pending: false, ...over });

describe('buildHistory', () => {
  it('pairs each finished answer with the question before it, and names the first source', () => {
    const messages = [user('u1', 'How many placements?'), reply('a1', { result: result('There are 42.', 'Placement') })];
    expect(buildHistory(messages)).toEqual([{ question: 'How many placements?', answer: 'There are 42.', space: 'Placement' }]);
  });

  it('skips pending, failed and answer-less turns', () => {
    const messages = [
      user('u1', 'q1'), reply('a1', { error: 'boom' }),
      user('u2', 'q2'), reply('a2', { result: result('  ') }),
      user('u3', 'q3'), reply('a3', { result: result('a3') }),
      user('u4', 'q4'), reply('a4', { pending: true }),
    ];
    expect(buildHistory(messages)).toEqual([{ question: 'q3', answer: 'a3' }]);
  });

  it('cuts long turns, so ten of them stay well under the 64 KB body limit', () => {
    const messages = Array.from({ length: 10 }, (_, i) => [user(`u${i}`, 'q'.repeat(9000)), reply(`a${i}`, { result: result('a'.repeat(50_000)) })]).flat();
    const history = buildHistory(messages, 10);
    expect(history).toHaveLength(10);
    for (const t of history) {
      expect(t.question.length).toBeLessThanOrEqual(MAX_QUESTION_CHARS);
      expect(t.answer.length).toBeLessThanOrEqual(MAX_ANSWER_CHARS);
      expect(t.answer.endsWith(' […]')).toBe(true);
    }
    expect(new TextEncoder().encode(JSON.stringify({ threadId: 't', message: 'q', history })).length).toBeLessThan(65_536);
  });

  it('keeps only the latest N, and none when N is 0', () => {
    const messages = [1, 2, 3, 4].flatMap((i) => [user(`u${i}`, `q${i}`), reply(`a${i}`, { result: result(`a${i}`) })]);
    expect(buildHistory(messages, 2).map((t) => t.question)).toEqual(['q3', 'q4']);
    expect(buildHistory(messages, 0)).toEqual([]);
  });
});
