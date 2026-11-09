import { describe, expect, it, vi } from 'vitest';
import { createSpaceRegistry } from '../genie/registry';
import { suggestFollowUps, type SuggestInput } from './suggest';

const registry = createSpaceRegistry([
  { key: 'placement', name: 'Lab – Placement Core', description: 'Placement counts and premium.', spaceId: 's1' },
  { key: 'capacity', name: 'Lab – Capacity & Reinsurer', description: 'Reinsurer capacity.', spaceId: 's2' },
]);

const base: SuggestInput = { question: 'Chart FOT premium by region', history: [] };

type Q = { question: string; space: string };
const agentReturning = (questions: Q[]) => ({ generate: vi.fn().mockResolvedValue({ object: { questions } }) }) as any;

describe('suggestFollowUps', () => {
  it('gives the model only the chat so far and the question just asked', async () => {
    const agent = agentReturning([]);
    await suggestFollowUps(agent, registry, { ...base, history: [{ question: 'How many placements by status?', answer: '5 statuses', suggested: ['Placements by region'] }] });
    const prompt: string = agent.generate.mock.calls[0][0];
    expect(prompt).toContain('Asked: How many placements by status?');
    expect(prompt).toContain('Answer: 5 statuses');
    expect(prompt).toContain('Already suggested: Placements by region');
    expect(prompt).toContain('The user has just asked: Chart FOT premium by region');
  });

  it('works on the very first question of a chat', async () => {
    const agent = agentReturning([{ question: 'FOT premium by underwriting year', space: 'placement' }]);
    expect(await suggestFollowUps(agent, registry, base)).toEqual(['FOT premium by underwriting year']);
    expect(agent.generate.mock.calls[0][0]).not.toContain('Earlier in this chat');
  });

  it('keeps only questions that name a real data agent', async () => {
    const agent = agentReturning([
      { question: 'FOT premium by underwriting year', space: 'placement' },
      { question: 'Weather forecast by region', space: 'weather' },
    ]);
    expect(await suggestFollowUps(agent, registry, base)).toEqual(['FOT premium by underwriting year']);
  });

  it('drops repeats of the current question, earlier questions and earlier suggestions', async () => {
    const agent = agentReturning([
      { question: 'chart FOT premium by region!', space: 'placement' },
      { question: 'How many placements by status?', space: 'placement' },
      { question: 'Placements by region', space: 'placement' },
      { question: 'Unused capacity by reinsurer', space: 'capacity' },
    ]);
    const history = [{ question: 'How many placements by status?', answer: '', suggested: ['Placements by region'] }];
    expect(await suggestFollowUps(agent, registry, { ...base, history })).toEqual(['Unused capacity by reinsurer']);
  });

  it('returns at most three, without duplicates within the batch', async () => {
    const agent = agentReturning(['a', 'b', 'b', 'c', 'd'].map((q) => ({ question: q, space: 'placement' })));
    expect(await suggestFollowUps(agent, registry, base)).toEqual(['a', 'b', 'c']);
  });

  it('returns nothing, without throwing, when the model call fails', async () => {
    const agent = { generate: vi.fn().mockRejectedValue(new Error('boom')) } as any;
    expect(await suggestFollowUps(agent, registry, base)).toEqual([]);
  });
});
