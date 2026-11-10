// The answer is Markdown; an email body is plain text. Keeps the words, drops the markup: emphasis, code marks and
// fences, link targets, heading marks. A Markdown table becomes one line per row, cells separated by " | ".
const SEPARATOR_ROW = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const isTableRow = (line: string) => /^\s*\|.*\|\s*$/.test(line);

export function markdownToPlainText(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  for (const raw of lines) {
    if (/^\s*(```|~~~)/.test(raw)) continue; // code fence lines; the code inside is kept as text
    if (SEPARATOR_ROW.test(raw) && raw.includes('-')) continue;
    let line = raw;
    if (isTableRow(line)) {
      line = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()).join(' | ');
    }
    line = line
      .replace(/^\s{0,3}#{1,6}\s+/, '') // heading marks
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images keep their alt text
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links keep their text
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/^\s*>\s?/, '') // block quotes
      .replace(/\*\*/g, '')
      .replace(/\s+$/, '');
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
