// The rich feedback email body, for the .eml draft. Laid out like a branded notification email: a header band with
// the app's mark, a greeting, short bold sections, the exchange in a soft panel, references in a small table, a sign-off
// and a footer band. Email-safe: table layout, inline styles plus bgcolor attributes (Outlook desktop ignores much of
// CSS), no script, no images or external fonts (the mark is a coloured cell with text), 600 px wide, explicit text and
// background colours. The question, answer, comment and ids come from users and the model: every one is escaped.
import { markdownToPlainText } from './markdownToPlainText';
import { chosen, type FeedbackInput, genieIdsLine, ref8, REASONS } from './types';

export const DRAFT_CAP = 8000;
const SHORTENED = ' [shortened]';

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
export const capDraft = (s: string) => (s.length > DRAFT_CAP ? `${s.slice(0, DRAFT_CAP).trimEnd()}${SHORTENED}` : s);

// The palette: deep indigo bands, a violet accent (the app's own), quiet greys.
export const COLORS = { band: '#1e1b4b', bandText: '#c7c9e6', accent: '#7b3fe4', accentSoft: '#f1ebfd', ink: '#1f2937', soft: '#6b7280', line: '#e5e7eb', panel: '#f8f9fc', page: '#eef0f6', white: '#ffffff' };
const C = COLORS;
const FONT = "'Segoe UI', -apple-system, Roboto, Helvetica, Arial, sans-serif";
const MONO = "Consolas, 'Courier New', monospace";

const pill = (label: string, on: boolean) =>
  `<span style="display:inline-block;margin:0 6px 8px 0;padding:6px 14px;border-radius:999px;font-size:13px;line-height:18px;${
    on ? `background:${C.accent};color:#ffffff;border:1px solid ${C.accent};font-weight:600;` : `background:${C.white};color:${C.soft};border:1px solid ${C.line};`
  }">${on ? '&#10003;&nbsp;' : ''}${escapeHtml(label)}</span>`;

const heading = (title: string) => `<p style="margin:26px 0 10px;font-size:15px;font-weight:700;color:${C.ink};">${escapeHtml(title)}</p>`;
const paragraphs = (text: string, style = '') =>
  text.split(/\n{2,}/).map((p) => `<p style="margin:0 0 10px;${style}">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
const panel = (html: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr><td bgcolor="${C.panel}" style="padding:14px 16px;border-left:3px solid ${C.accent};background:${C.panel};color:${C.ink};font-size:14px;line-height:21px;">${html}</td></tr></table>`;

// The answer keeps its paragraphs and line breaks; a Markdown table becomes a real table with light borders.
export function answerHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const parts: string[] = [];
  let text: string[] = [];
  const flush = () => {
    if (text.length) parts.push(paragraphs(markdownToPlainText(text.join('\n'))));
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
      const cell = (c: string, head: boolean) =>
        `<${head ? 'th' : 'td'} style="padding:6px 10px;border:1px solid ${C.line};text-align:left;font-size:13px;color:${C.ink};${head ? `background:${C.accentSoft};font-weight:600;` : `background:${C.white};`}">${escapeHtml(c)}</${head ? 'th' : 'td'}>`;
      parts.push(`<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:6px 0 12px;">${rows.map((r, n) => `<tr>${r.map((c) => cell(c, n === 0)).join('')}</tr>`).join('')}</table>`);
    } else {
      text.push(lines[i]);
      i++;
    }
  }
  flush();
  return parts.join('');
}

const refRow = (label: string, value: string) =>
  `<tr><td style="padding:7px 12px 7px 0;border-bottom:1px solid ${C.line};font-size:13px;color:${C.soft};white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:7px 0;border-bottom:1px solid ${C.line};font-family:${MONO};font-size:12px;color:${C.ink};word-break:break-all;">${value}</td></tr>`;

export function buildFeedbackHtml(input: FeedbackInput): string {
  const pick = chosen(input);
  const comment = input.comment?.trim();
  const question = input.content !== 'ids' && input.question?.trim() ? capDraft(input.question.trim()) : undefined;
  const answer = input.content === 'full' && input.answer?.trim() ? capDraft(input.answer.trim()) : undefined;
  const genie = genieIdsLine(input.genieIds);
  const refs = [
    refRow('Feedback ref', escapeHtml(input.traceId)),
    refRow('User ref', escapeHtml(input.userRef)),
    refRow('Chat id', escapeHtml(input.chatId)),
    refRow('Turn', `${input.turn} in this chat`),
    refRow('Time', escapeHtml(input.time)),
    refRow('App', `build ${escapeHtml(input.build)}, contract ${escapeHtml(input.contract)}`),
    ...(genie ? [refRow('Genie ids', escapeHtml(genie))] : []),
  ].join('');

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>Conversational BI - Feedback</title></head>
<body style="margin:0;padding:0;background:${C.page};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.page}" style="background:${C.page};"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;border-collapse:collapse;font-family:${FONT};color:${C.ink};">

<!-- Header band -->
<tr><td bgcolor="${C.band}" style="background:${C.band};padding:26px 32px;border-top:4px solid ${C.accent};">
  <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>
    <td width="40" height="40" bgcolor="${C.accent}" align="center" valign="middle" style="width:40px;height:40px;background:${C.accent};border-radius:10px;color:#ffffff;font-size:15px;font-weight:800;letter-spacing:.5px;">BI</td>
    <td style="padding-left:14px;">
      <div style="font-size:20px;font-weight:700;color:#ffffff;line-height:24px;">Conversational BI</div>
      <div style="font-size:13px;color:${C.bandText};line-height:18px;">Feedback on an answer &middot; ref ${escapeHtml(ref8(input.traceId))}</div>
    </td>
  </tr></table>
</td></tr>

<!-- Body -->
<tr><td bgcolor="${C.white}" style="background:${C.white};padding:30px 32px 32px;font-size:15px;line-height:23px;color:${C.ink};">
  <p style="margin:0 0 14px;">Hello team,</p>
  <p style="margin:0;">I have feedback on an answer from Conversational BI. The details are below, with the references you need to trace it.</p>

  ${heading('What was wrong')}
  <div>${REASONS.map((r) => pill(r.label, r.id === pick)).join('')}</div>
  ${comment ? panel(`<span style="color:${C.soft};font-size:13px;">My comment</span><br>${escapeHtml(comment)}`) : ''}

  ${question !== undefined ? `${heading('The question')}${panel(paragraphs(question, 'margin:0;'))}` : ''}
  ${answer !== undefined ? `${heading('The answer')}${panel(answerHtml(answer))}` : ''}

  ${heading('References')}
  <p style="margin:-4px 0 8px;font-size:13px;color:${C.soft};">Please keep these so the team can trace this answer.</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${refs}</table>

  <p style="margin:28px 0 2px;">Regards,</p>
  <p style="margin:0;font-weight:700;color:${C.accent};">Sent from Conversational BI</p>
</td></tr>

<!-- Footer band -->
<tr><td bgcolor="${C.band}" align="center" style="background:${C.band};padding:20px 32px;font-size:12px;line-height:19px;color:${C.bandText};">
  This message was prepared by Conversational BI and sent by you from your own mailbox.<br>
  Feedback ref ${escapeHtml(input.traceId)} &middot; build ${escapeHtml(input.build)} &middot; contract ${escapeHtml(input.contract)}
</td></tr>

</table>
</td></tr></table>
</body></html>`;
}
