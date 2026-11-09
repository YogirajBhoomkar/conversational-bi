import { describe, expect, it } from 'vitest';
import { priorMessages as toMessages, recentHistory } from './history';

const priorMessages = (...args: Parameters<typeof recentHistory>) => toMessages(recentHistory(...args));

const on = { turns: 3, maxChars: 100, includeSql: false };
const turn = (i: number) => ({ question: `q${i}`, answer: `a${i}` });

describe('priorMessages', () => {
  it('keeps the latest N turns, oldest first, as user and assistant pairs', () => {
    expect(priorMessages([1, 2, 3, 4, 5].map(turn), on)).toEqual([
      { role: 'user', content: 'q3' }, { role: 'assistant', content: 'a3' },
      { role: 'user', content: 'q4' }, { role: 'assistant', content: 'a4' },
      { role: 'user', content: 'q5' }, { role: 'assistant', content: 'a5' },
    ]);
  });

  it('sends nothing when history is off or absent', () => {
    expect(priorMessages([turn(1)], { ...on, turns: 0 })).toEqual([]);
    expect(priorMessages(undefined, on)).toEqual([]);
  });

  it('drops empty turns before counting', () => {
    expect(priorMessages([turn(1), { question: 'q2', answer: '  ' }, turn(3)], { ...on, turns: 2 }).map((m) => m.content)).toEqual(['q1', 'a1', 'q3', 'a3']);
  });

  it('cuts long text with a marker, and strips control characters', () => {
    const [q, a] = priorMessages([{ question: 'why\u0000‮no', answer: 'x'.repeat(500) }], on);
    expect(q.content).toBe('whyno');
    expect(a.content).toHaveLength(100);
    expect(a.content.endsWith('[…]')).toBe(true);
  });

  it('ignores SQL unless allowed, and labels it when it is', () => {
    const withSql = [{ ...turn(1), space: 'Placement', sql: 'SELECT 1' }];
    expect(priorMessages(withSql, on)[1].content).toBe('a1\n(Source: Placement)');
    expect(priorMessages(withSql, { ...on, includeSql: true })[1].content).toBe('a1\n(Source: Placement)\nSQL used: SELECT 1');
  });

  it('only ever produces user and assistant roles, whatever is sent', () => {
    const sneaky = [{ question: 'q', answer: 'a', role: 'system' } as never];
    expect(priorMessages(sneaky, on).map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(recentHistory(sneaky, on)[0]).not.toHaveProperty('role');
  });
});
