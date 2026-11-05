import { describe, expect, it } from 'vitest';
import type { GenieSpace } from '../../contracts';
import { agentName, askToolName, fetchFullToolName, genieAgentDescription, genieAgentInstructions, suggestInstructions, supervisorInstructions } from './prompts';

// Five made-up spaces: the prompts must work for any number of spaces and any business.
const SPACES: GenieSpace[] = ['orders', 'stock', 'returns', 'suppliers', 'web_traffic'].map((key, i) => ({
  key,
  name: `Fake ${key} space`,
  description: `Fake description ${i} for ${key}.`,
  ...(i % 2 === 0 ? { routing: `Fake routing ${i} for ${key}.` } : {}),
  spaceId: `fake-id-${i}`,
}));
const input = { spaces: SPACES, domainRules: 'FAKE RULE: weeks start on Monday.', chartTypes: ['bar', 'line'] };

describe('prompts', () => {
  it('the supervisor lists every space, and routes by `routing` or else by the description', () => {
    const p = supervisorInstructions(input);
    SPACES.forEach((s, i) => {
      expect(p).toContain(`- ${agentName(s.key)}: ${s.description}`);
      expect(p).toContain(`- ${i % 2 === 0 ? s.routing : s.description} -> ${agentName(s.key)}`);
    });
    expect(p).toContain('These chart types can be drawn: bar, line. Every type in that list is supported');
  });

  it('the supervisor appends the domain rules, and leaves the section out when there are none', () => {
    expect(supervisorInstructions(input)).toMatch(/DOMAIN RULES\nFAKE RULE: weeks start on Monday\.$/);
    const bare = supervisorInstructions({ ...input, domainRules: '  ' });
    expect(bare).not.toContain('DOMAIN RULES');
  });

  it('a data agent names its own tools', () => {
    for (const s of SPACES) {
      const p = genieAgentInstructions(s);
      expect(p).toContain(`using the ${askToolName(s.key)} tool`);
      expect(p).toContain(`Use ${fetchFullToolName(s.key)} ONLY`);
      expect(genieAgentDescription(s)).toContain(s.description);
    }
    expect([askToolName('web_traffic'), fetchFullToolName('web_traffic'), agentName('web_traffic')]).toEqual(['ask-web_traffic', 'fetch-full-web_traffic', 'genie_web_traffic']);
  });

  it('the follow-up writer lists every space key with its description', () => {
    const p = suggestInstructions(input);
    for (const s of SPACES) expect(p).toContain(`- ${s.key}: ${s.description}`);
  });

  it('nothing about a particular business is written into the prompts', () => {
    const all = [supervisorInstructions({ ...input, domainRules: '' }), suggestInstructions(input), ...SPACES.flatMap((s) => [genieAgentInstructions(s), genieAgentDescription(s)])].join('\n');
    expect(all).not.toMatch(/placement|capacity|reinsur|underwriting|FOT|premium|USD/i);
  });
});
