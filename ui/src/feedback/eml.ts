// The feedback email as a downloadable .eml draft: a plain-text and an HTML part (multipart/alternative), UTF-8,
// base64 wrapped at 76 characters, CRLF line endings. "X-Unsent: 1" makes Outlook desktop open it as an unsent draft.
// Header values have CR and LF removed, so nothing in them can add a header (no Bcc: smuggled in).
import { buildFeedbackHtml, capDraft } from './html';
import { renderFeedbackText } from './mailto';
import { markdownToPlainText } from './markdownToPlainText';
import { type FeedbackInput, ref8, subjectOf } from './types';

const CRLF = '\r\n';

export const headerValue = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

export function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
const wrap76 = (s: string) => s.match(/.{1,76}/g)?.join(CRLF) ?? '';

// RFC 2047: a header that may hold non-ASCII text, as an encoded word.
export const encodedWord = (s: string) => `=?UTF-8?B?${base64Utf8(headerValue(s))}?=`;

export function buildFeedbackEml(input: FeedbackInput): { filename: string; content: string } {
  const question = input.content !== 'ids' && input.question?.trim() ? capDraft(input.question.trim()) : undefined;
  const answer = input.content === 'full' && input.answer?.trim() ? capDraft(markdownToPlainText(input.answer)) : undefined;
  const text = renderFeedbackText(input, { question, answer, genieIds: true, comment: true });
  const html = buildFeedbackHtml(input);
  const boundary = `----=_bi_feedback_${ref8(input.traceId).replace(/[^A-Za-z0-9]/g, '') || 'x'}_${Date.now().toString(36)}`;
  const part = (type: string, body: string) => [`--${boundary}`, `Content-Type: ${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', wrap76(base64Utf8(body))].join(CRLF);
  const content = [
    `To: ${headerValue(input.to.join(', '))}`,
    `Subject: ${encodedWord(subjectOf(input.traceId))}`,
    'X-Unsent: 1',
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    part('text/plain', text),
    part('text/html', html),
    `--${boundary}--`,
    '',
  ].join(CRLF);
  return { filename: `feedback-${ref8(input.traceId).replace(/[^A-Za-z0-9-]/g, '') || 'draft'}.eml`, content };
}

// Saves the draft through a temporary object URL, released straight after.
export function downloadEml({ filename, content }: { filename: string; content: string }, doc: Document = document) {
  const url = URL.createObjectURL(new Blob([content], { type: 'message/rfc822' }));
  const a = doc.createElement('a');
  a.href = url;
  a.download = filename;
  doc.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
