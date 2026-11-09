import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AnswerText from '../components/AnswerText/AnswerText';
import TraceText from '../components/TraceView/TraceText';

const MODEL_TEXT = 'There are **42**. ![p](https://example.invalid/p?d=42) Read [the guide](https://example.invalid/x). <img src="https://example.invalid/q"> <a href="https://example.invalid">raw</a>';

describe('model text renders with nothing that points outside', () => {
  for (const [name, html] of [
    ['answer', () => renderToStaticMarkup(<AnswerText>{MODEL_TEXT}</AnswerText>)],
    ['scratchpad', () => renderToStaticMarkup(<TraceText text={MODEL_TEXT} />)],
  ] as const) {
    it(`${name}: no image, no anchor, no raw HTML; the link keeps its text`, () => {
      const out = html();
      expect(out).not.toMatch(/<img|<a[\s>]|href=|src=/);
      expect(out).toContain('the guide');
      expect(out).toContain('<strong>42</strong>');
    });
  }
});
