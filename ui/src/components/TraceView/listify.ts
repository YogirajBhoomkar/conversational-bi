// Scratchpad text is written by the assistant and by Genie, sometimes as one long line with its parts numbered inline:
// "For 2020-2024, provide: (1) a chart of ...; (2) a chart of ...". Turned into an intro and a numbered list, it reads
// as steps. Text without such numbering (or with only one part) is returned unchanged.
export function asList(text: string): string {
  const parts = text.split(/\s*\((\d{1,2})\)\s+/);
  if (parts.length < 5 || parts[1] !== '1') return text; // fewer than two numbered parts, or not starting at (1)
  const [intro, ...rest] = parts;
  const items: string[] = [];
  for (let i = 0; i < rest.length; i += 2) items.push(`${rest[i]}. ${rest[i + 1].trim().replace(/[;,]$/, '')}`);
  return `${intro.trim()}\n\n${items.join('\n')}`;
}
