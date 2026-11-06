// Safety net for when the model writes its clarifying question as text instead of calling ask_user_to_choose:
// "Please choose one metric to rank by:\n- Placement count\n- Total limit\nOr type your own." becomes a question with
// options, so the UI can show it as choices. Only text that is nothing but a short question and 2 to 4 short options
// is converted; anything else (an answer, a ranking, a longer explanation) is left alone. The caller applies it only
// to turns that fetched no data.
import type { Clarification } from '../../contracts';

const MAX_TEXT = 700;
const MAX_OPTION = 80;
const BULLET = /^(?:[-*•]|\d{1,2}[.)])\s+/;
const OWN_ANSWER = /^(or\b|you can also|feel free|alternatively)/i; // "Or type your own ..." — the UI offers that itself
const clean = (s: string) => s.replace(BULLET, '').replace(/\*\*/g, '').replace(/[.;,]$/, '').trim();

export function clarificationFromText(text: string): Clarification | null {
  if (text.length > MAX_TEXT) return null;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const at = lines.findIndex((l) => /[?:]$/.test(clean(l)) || /[?:]\**$/.test(l));
  if (at < 0) return null;
  const question = clean(lines[at]).replace(/:$/, '').trim();
  const options: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (OWN_ANSWER.test(clean(line))) break;
    if (!BULLET.test(line) && /[.!]$/.test(line)) break; // a closing sentence, not a choice
    const option = clean(line);
    if (!option || option.length > MAX_OPTION || /[.!?]\s/.test(option)) return null; // a sentence, not a choice
    options.push(option);
  }
  // Only the question, its options and an "or your own" line: nothing else may follow, and nothing long may precede.
  const after = lines.slice(at + 1 + options.length);
  if (after.length > 1 || (after.length === 1 && !OWN_ANSWER.test(clean(after[0])))) return null;
  if (lines.slice(0, at).join(' ').length > 200) return null;
  if (options.length < 2 || options.length > 4 || !question) return null;
  return { question, options };
}
