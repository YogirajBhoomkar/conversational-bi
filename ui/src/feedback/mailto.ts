// The plain-text feedback email, as a mailto: link. A mailto link carries plain text only, and mail apps and browsers
// cut long links (about 2,000 characters), so the whole link is kept within maxUrlChars, counted AFTER URL encoding:
// the fixed parts first, then the question (up to about 300 characters), then the answer with what is left, each cut
// on a word boundary. The layout uses ASCII only ([x], -): any other character costs up to 9 characters encoded, and
// even "=" costs 3 (%3D), so the dividers are made of "-", which encoding leaves alone.
import { markdownToPlainText } from './markdownToPlainText';
import { chosen, type FeedbackInput, genieIdsLine, REASONS, subjectOf } from './types';

const NL = '\r\n';
const RULE = '-'.repeat(40);
const SHORTENED = ' ...[shortened]';
const QUESTION_SHARE = 300;

export type TextParts = { question?: string; answer?: string; genieIds: boolean; comment: boolean };

const section = (title: string) => [RULE, ` ${title}`, RULE];
const indent = (text: string) => text.split(/\r?\n/).map((l) => (l ? `   ${l}` : ''));

// Two choices per line, padded to line up in a monospace font.
function choices(input: FeedbackInput): string[] {
  const pick = chosen(input);
  const cells = REASONS.map((r) => `[${r.id === pick ? 'x' : ' '}] ${r.label}`);
  const lines: string[] = [];
  for (let i = 0; i < cells.length; i += 2) lines.push(` ${cells[i].padEnd(28)} ${cells[i + 1] ?? ''}`.trimEnd());
  return lines;
}

export function renderFeedbackText(input: FeedbackInput, parts: TextParts): string {
  const comment = input.comment?.trim();
  const lines = ['Hi team,', '', 'I have feedback on an answer from Conversational BI.', '', ...section('MY FEEDBACK'), ...choices(input)];
  if (parts.comment) lines.push(` Comment: ${comment || '-'}`);
  if (input.content !== 'ids' && (parts.question !== undefined || parts.answer !== undefined)) {
    lines.push('', ...section('THE EXCHANGE'));
    if (parts.question !== undefined) lines.push(' Question:', ...indent(parts.question));
    if (input.content === 'full' && parts.answer !== undefined) lines.push('', ' Answer:', ...indent(parts.answer));
  }
  const genie = parts.genieIds ? genieIdsLine(input.genieIds) : undefined;
  lines.push(
    '', ...section('REFERENCES (please keep this part)'),
    ` Feedback ref : ${input.traceId}`,
    ` User ref     : ${input.userRef}`,
    ` Chat id      : ${input.chatId}`,
    ` Turn         : ${input.turn} in this chat`,
    ` Time         : ${input.time}`,
    ` App          : build ${input.build}, contract ${input.contract}`,
    ...(genie ? [` Genie ids    : ${genie}`] : []),
  );
  return lines.join(NL);
}

// The first n characters, cut back to a word boundary, marked as shortened. The whole text when it fits.
// Counted in characters (code points), so an emoji or other astral character is never split in half.
export function cutText(text: string, n: number): string {
  const chars = Array.from(text);
  if (n >= chars.length) return text;
  const head = chars.slice(0, Math.max(0, n)).join('');
  const atSpace = head.search(/\s\S*$/);
  return `${(atSpace > 0 ? head.slice(0, atSpace) : head).trimEnd()}${SHORTENED}`.trimStart();
}

const mailtoUrl = (to: string[], subject: string, body: string) => `mailto:${to.join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

// The longest prefix (in characters) of `text` for which `fits` still holds. `fits` grows with the length.
function longestFitting(text: string, fits: (part: string) => boolean): string | undefined {
  if (fits(text)) return text;
  let lo = 0;
  let hi = Array.from(text).length;
  let best: string | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const part = cutText(text, mid);
    if (fits(part)) {
      best = part;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

export type Mailto = { to: string[]; subject: string; body: string; url: string };

export function buildFeedbackMailto(input: FeedbackInput, maxUrlChars: number): Mailto {
  const subject = subjectOf(input.traceId);
  const question = input.content !== 'ids' && input.question?.trim() ? input.question.trim() : undefined;
  const answer = input.content === 'full' && input.answer?.trim() ? markdownToPlainText(input.answer) : undefined;
  const make = (parts: TextParts) => {
    const body = renderFeedbackText(input, parts);
    return { to: input.to, subject, body, url: mailtoUrl(input.to, subject, body) };
  };
  const fits = (parts: TextParts) => make(parts).url.length <= maxUrlChars;

  // Leave out the optional lines only if even the fixed parts do not fit: first the Genie ids, then the comment.
  // The trace id and the user ref always stay.
  let base: TextParts = { genieIds: true, comment: true };
  if (!fits(base)) base = { ...base, genieIds: false };
  if (!fits(base)) base = { ...base, comment: false };
  if (!fits(base)) return make(base);

  // The question first, up to about 300 characters (more when the answer does not need the room), then the answer.
  let q = question;
  if (q !== undefined) {
    const firstShare = Array.from(q).length > QUESTION_SHARE && answer !== undefined ? cutText(q, QUESTION_SHARE) : q;
    q = longestFitting(firstShare, (part) => fits({ ...base, question: part }));
  }
  let a = answer;
  if (a !== undefined) a = longestFitting(a, (part) => fits({ ...base, question: q, answer: part }));
  return make({ ...base, question: q, answer: a });
}

// Opens the link as a click on a real anchor: this works better than window.location inside a frame.
export function openMailto(url: string, doc: Document = document) {
  const a = doc.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  doc.body.appendChild(a);
  a.click();
  a.remove();
}
