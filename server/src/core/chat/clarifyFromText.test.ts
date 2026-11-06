import { describe, expect, it } from 'vitest';
import { clarificationFromText } from './clarifyFromText';

describe('clarificationFromText', () => {
  it('turns a question written as text, with its options, into choices (as the model wrote it in a real chat)', () => {
    const text = 'Please choose one metric to rank by:\n\nPlacement count\nTotal limit\nFOT premium\nSigned limit\nOr type your own (for example "margin between quoted and FOT").';
    expect(clarificationFromText(text)).toEqual({ question: 'Please choose one metric to rank by', options: ['Placement count', 'Total limit', 'FOT premium', 'Signed limit'] });
  });

  it('accepts bullets, numbers and bold', () => {
    expect(clarificationFromText('Which year do you mean?\n- **Underwriting year**\n- Calendar year')).toEqual({ question: 'Which year do you mean?', options: ['Underwriting year', 'Calendar year'] });
    expect(clarificationFromText('Which region?\n1. EMEA\n2. APAC\n3. North America')).toMatchObject({ options: ['EMEA', 'APAC', 'North America'] });
  });

  it('leaves real answers alone', () => {
    expect(clarificationFromText('**EMEA leads** with 1,737.2M.')).toBeNull();
    expect(clarificationFromText('Top regions by limit:\n1. EMEA: 1,737.2M. Largest by far, driven by cat.\n2. APAC: 856.1M')).toBeNull(); // sentences, not choices
    expect(clarificationFromText('I can answer questions about:\n- placements\n- capacity\n\nAsk me anything about them.')).toBeNull(); // text after the list
    expect(clarificationFromText('Which one?\n- a\n- b\n- c\n- d\n- e')).toBeNull(); // too many
    expect(clarificationFromText('Which one?\n- only')).toBeNull();
  });
});
