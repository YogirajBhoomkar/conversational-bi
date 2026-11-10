// The rich feedback email body, for the .eml draft. Email-safe HTML: table layout, inline styles only, no script, no
// external images or fonts, at most 640 px wide, explicit text and background colours (readable in dark-mode clients
// that keep them). The question, answer, comment and ids come from users and the model, so every one is escaped.
import { markdownToPlainText } from './markdownToPlainText';
import { chosen, type FeedbackInput, genieIdsLine, ref8, REASONS } from './types';

export const DRAFT_CAP = 8000;
const SHORTENED = ' [shortened]';

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export const capDraft = (s: string) => (s.length > DRAFT_CAP ? `${s.slice(0, DRAFT_CAP).trimEnd()}${SHORTENED}` : s);

const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "Consolas, 'Courier New', monospace";
const INK = '#1f2937';
const SOFT = '#6b7280';
const LINE = '#e1e5ec';
const ACCENT = '#7b3fe4';
const PAPER = '#ffffff';

const pill = (label: string, on: boolean) =>
  `<span style="display:inline-block;margin:0 6px 6px 0;padding:4px 12px;border-radius:999px;font-size:13px;line-height:18px;${
    on ? `background:${ACCENT};color:#ffffff;border:1px solid ${ACCENT};font-weight:600;` : `background:${PAPER};color:${SOFT};border:1px solid ${LINE};`
  }">${escapeHtml(label)}</span>`;

const cell = (html: string, style = '') => `<td style="padding:8px 12px;border-top:1px solid ${LINE};vertical-align:top;${style}">${html}</td>`;
const row = (label: string, html: string, mono = false) =>
  `<tr>${cell(escapeHtml(label), `width:120px;color:${SOFT};font-size:13px;`)}${cell(html, mono ? `font-family:${MONO};font-size:12px;` : 'font-size:14px;')}</tr>`;
const heading = (title: string) => `<tr><td style="padding:18px 0 6px;font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:${SOFT};">${escapeHtml(title)}</td></tr>`;
const box = (rows: string) => `<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${LINE};border-radius:8px;background:${PAPER};color:${INK};">${rows}</table></td></tr>`;

const textHtml = (text: string) =>
  text.split(/\n{2,}/).map((p) => `<p style="margin:0 0 8px;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');

// The answer keeps its paragraphs and line breaks; a Markdown table becomes a real table with light borders.
export function answerHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const parts: string[] = [];
  let text: string[] = [];
  const flush = () => {
    if (text.length) parts.push(textHtml(markdownToPlainText(text.join('\n'))));
    text = [];
  };
  for (let i = 0; i < lines.length; ) {
    if (/^\s*\|.*\|\s*$/.test(lines[i])) {
      flush();
      const rows: string[][] = [];
      for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) {
        if (/^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i]) && lines[i].includes('-')) continue; // the separator row
        rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => markdownToPlainText(c.trim())));
      }
      const td = (c: string, head: boolean) => `<${head ? 'th' : 'td'} style="padding:4px 8px;border:1px solid ${LINE};text-align:left;font-size:13px;${head ? 'background:#f6f7f9;' : ''}">${escapeHtml(c)}</${head ? 'th' : 'td'}>`;
      parts.push(`<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:4px 0 10px;">${rows.map((r, n) => `<tr>${r.map((c) => td(c, n === 0)).join('')}</tr>`).join('')}</table>`);
    } else {
      text.push(lines[i]);
      i++;
    }
  }
  flush();
  return parts.join('');
}

export function buildFeedbackHtml(input: FeedbackInput): string {
  const pick = chosen(input);
  const comment = input.comment?.trim();
  const question = input.content !== 'ids' && input.question?.trim() ? capDraft(input.question.trim()) : undefined;
  const answer = input.content === 'full' && input.answer?.trim() ? capDraft(input.answer.trim()) : undefined;
  const genie = genieIdsLine(input.genieIds);
  const refs = [
    row('Feedback ref', escapeHtml(input.traceId), true),
    row('User ref', escapeHtml(input.userRef), true),
    row('Chat id', escapeHtml(input.chatId), true),
    row('Turn', `${input.turn} in this chat`, true),
    row('Time', escapeHtml(input.time), true),
    row('App', `build ${escapeHtml(input.build)}, contract ${escapeHtml(input.contract)}`, true),
    ...(genie ? [row('Genie ids', escapeHtml(genie), true)] : []),
  ].join('');
  const exchange = question !== undefined || answer !== undefined
    ? heading('The exchange') + box([...(question !== undefined ? [row('Question', textHtml(question))] : []), ...(answer !== undefined ? [row('Answer', answerHtml(answer))] : [])].join(''))
    : '';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><title>Conversational BI - Feedback</title></head>
<body style="margin:0;padding:24px 12px;background:#f3f4f6;color:${INK};font-family:${FONT};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;border-collapse:collapse;background:#f3f4f6;color:${INK};">
<tr><td style="padding:16px 20px;border-radius:8px;background:${ACCENT};color:#ffffff;"><div style="font-size:18px;font-weight:600;">Conversational BI - Feedback</div><div style="font-size:13px;opacity:.9;">ref ${escapeHtml(ref8(input.traceId))}</div></td></tr>
<tr><td style="padding:16px 0 0;font-size:14px;">Hi team, I have feedback on an answer from Conversational BI.</td></tr>
${heading('Feedback')}
<tr><td style="padding:12px;border:1px solid ${LINE};border-radius:8px;background:${PAPER};color:${INK};">${REASONS.map((r) => pill(r.label, r.id === pick)).join('')}${comment ? `<div style="margin-top:6px;font-size:14px;"><span style="color:${SOFT};">Comment:</span> ${escapeHtml(comment)}</div>` : ''}</td></tr>
${exchange}
${heading('References')}
${box(refs)}
<tr><td style="padding:14px 0 0;font-size:12px;color:${SOFT};">Please keep the references so we can trace this turn.</td></tr>
</table>
</body></html>`;
}
