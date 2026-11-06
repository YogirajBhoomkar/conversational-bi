import { describe, expect, it } from 'vitest';
import { asList } from './listify';

describe('asList', () => {
  it('turns inline numbered parts into an intro and a numbered list', () => {
    const q = 'For the last 5 years, provide: (1) one chart of limit by year; (2) one chart of limit by region; (3) one sankey of the status flow.';
    expect(asList(q)).toBe('For the last 5 years, provide:\n\n1. one chart of limit by year\n2. one chart of limit by region\n3. one sankey of the status flow.');
  });

  it('leaves text without at least two numbered parts unchanged', () => {
    expect(asList('Chart limit by region (1) only.')).toBe('Chart limit by region (1) only.');
    expect(asList('Compare (2) things and (3) more.')).toBe('Compare (2) things and (3) more.');
    expect(asList('Plain question.')).toBe('Plain question.');
  });
});
