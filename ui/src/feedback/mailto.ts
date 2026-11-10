// The feedback email, as a mailto: link. A mailto link carries plain text only, and mail apps and browsers cut long
// links (about 2,000 characters), so the whole link is kept within maxUrlChars, counted AFTER URL encoding: the fixed
// parts first, then the question (up to about 300 characters), then the answer with what is left, each cut on a word
// boundary.
// The layout is made for how Outlook shows plain text: in a proportional font, so nothing relies on columns lining up
// (no padded labels, no checkbox grid); short headings in capitals, a blank line between sections, one "Label: value"
// per line. ASCII only where we choose the characters: anything else costs up to 9 characters encoded, and the rule
// above the references is made of "_", which encoding leaves alone.
import { markdownToPlainText } from './markdownToPlainText';
import { chosen, type FeedbackInput, genieIdsLine, REASONS, subjectOf } from './types';

const NL = '\r\n';
const RULE = '_'.repeat(30);
const SHORTENED = ' ...[shortened]';
const QUESTION_SHARE = 300;

export type TextParts = { question?: string; answer?: string; genieIds: boolean; comment: boolean };

const reasonLabel = (input: FeedbackInput) => REASONS.find((r) => r.id === chosen(input))!.label;

export function renderFeedbackText(input: FeedbackInput, parts: TextParts): string {
  const comment = input.comment?.trim();
  const lines = ['Hi team,', '', 'I have feedback on an answer from Conversational BI.', '', 'WHAT WAS WRONG', reasonLabel(input)];
  if (parts.comment && comment) lines.push(`Comment: ${comment}`);
  if (input.content !== 'ids' && parts.question !== undefined) lines.push('', 'MY QUESTION', ...parts.question.split(/\r?\n/));
  if (input.content === 'full' && parts.answer !== undefined) lines.push('', 'THE ANSWER I GOT', ...parts.answer.split(/\r?\n/));
  const genie = parts.genieIds ? genieIdsLine(input.genieIds) : undefined;
  lines.push(
    '', 'Thanks', '', RULE,
    'REFERENCES (please keep these, so the team can trace the answer)',
    `Feedback ref: ${input.traceId}`,
    `User ref: ${input.userRef}`,
    `Chat id: ${input.chatId}`,
    `Turn: ${input.turn} in this chat`,
    `Time: ${input.time}`,
    `App: build ${input.build}, contract ${input.contract}`,
    ...(genie ? [`Genie ids: ${genie}`] : []),
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

// The same email with nothing shortened for the link (each text capped at 8,000 characters), for the Copy email text
// fallback when no email app opens: the clipboard has no 2,000-character limit.
export const COPY_CAP = 8000;
export function buildFeedbackCopy(input: FeedbackInput): { to: string[]; subject: string; body: string } {
  const question = input.content !== 'ids' && input.question?.trim() ? cutText(input.question.trim(), COPY_CAP) : undefined;
  const answer = input.content === 'full' && input.answer?.trim() ? cutText(markdownToPlainText(input.answer), COPY_CAP) : undefined;
  return { to: input.to, subject: subjectOf(input.traceId), body: renderFeedbackText(input, { question, answer, genieIds: true, comment: true }) };
}

// Puts text on the clipboard. The Clipboard API first; inside a frame that does not allow it, the older copy command.
export async function copyText(text: string, doc: Document = document): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const box = doc.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.position = 'fixed';
    box.style.opacity = '0';
    doc.body.appendChild(box);
    box.select();
    try {
      return doc.execCommand('copy');
    } catch {
      return false;
    } finally {
      box.remove();
    }
  }
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
