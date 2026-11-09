// Checks on what the model writes, before it reaches the user. Deterministic, no model calls; BI_GUARD_OUTPUT=off
// switches them off.
// - sanitizeMarkdown: text hidden in the data could make the model write an image or link whose URL carries data out
//   when the browser renders it. Images, raw HTML, links and bare URLs are removed (a link keeps its text). The UI
//   renders without images, HTML or clickable links as well, since streamed text is shown before the server corrects it.
// - redactInternalNames: agent and tool names are internals. A name tied to a space becomes the space's name (the user
//   sees data sources by name); the others are removed. The names come from the registry, so new spaces are covered.
// - noDataOverride: when every Genie call failed or came back empty, figures in the answer cannot come from the data.
import type { Clarification, GenieResult } from '../../contracts';
import { agentName, askToolName, clarifyToolName, fetchFullToolName } from '../agents/prompts';
import type { SpaceRegistry } from '../genie/registry';

export const NO_DATA_MESSAGE = "I couldn't get data for that question just now. Please try again or rephrase.";

const IMAGE = /!\[([^\]]*)\](\([^)]*\)|\[[^\]]*\])/g; // ![alt](url) and ![alt][ref]
const REFERENCE_DEFINITION = /^[ \t]{0,3}\[[^\]]+\]:[ \t]*\S+.*$/gm; // [ref]: https://...
const LINK = /\[([^\]]*)\](\([^)]*\)|\[[^\]]*\])/g; // [text](url) and [text][ref], after images are gone
const AUTOLINK = /<(?:https?|ftp|mailto):[^>\s]*>/gi;
const HTML_TAG = /<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>|<!--[\s\S]*?-->/gi;
const BARE_URL = /\b(?:https?|ftp):\/\/[^\s<>()\]]+/gi;

export function sanitizeMarkdown(text: string): string {
  return text
    .replace(IMAGE, '')
    .replace(REFERENCE_DEFINITION, '')
    .replace(LINK, '$1')
    .replace(AUTOLINK, '')
    .replace(HTML_TAG, '')
    .replace(BARE_URL, '');
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every internal name, longest first so `agent-genie_x` is matched before `genie_x`, with what replaces it.
function internalNames(registry: SpaceRegistry): Array<[RegExp, string]> {
  const named = registry.spaces.flatMap((s) => [`agent-${agentName(s.key)}`, agentName(s.key), askToolName(s.key), fetchFullToolName(s.key)].map((n) => [n, s.name] as const));
  const hidden = [clarifyToolName, 'bi_supervisor', 'suggest_agent'].map((n) => [n, ''] as const);
  return [...named, ...hidden]
    .sort((a, b) => b[0].length - a[0].length)
    // A removed name takes one space before it along, so no double space is left; a replaced one keeps its spacing.
    .map(([name, by]) => [new RegExp(`${by ? '' : '[ \\t]?'}(?<![\\w-])\`?${escape(name)}\`?(?![\\w-])`, 'g'), by]);
}

export function redactInternalNames(text: string, registry: SpaceRegistry): { text: string; count: number } {
  let count = 0;
  let out = text;
  for (const [pattern, by] of internalNames(registry)) {
    out = out.replace(pattern, () => {
      count++;
      return by;
    });
  }
  return { text: out, count };
}

const usable = (r: GenieResult) => !r.error && (r.totalRows > 0 || /\d/.test(r.summary));
const hasFigures = (text: string) => /\d/.test(text);

// The fixed message replaces the answer only when data was asked for and none came back, and the answer has numbers
// anyway. Not for small talk (no Genie call) or a question back to the user.
export function noDataOverride(answer: string, results: GenieResult[], clarification?: Clarification): string {
  if (clarification || !results.length || results.some(usable) || !hasFigures(answer)) return answer;
  return NO_DATA_MESSAGE;
}

export type OutputGuard = { text(text: string): { text: string; leaks: number }; answer(answer: string, results: GenieResult[], clarification?: Clarification): { text: string; leaks: number } };

export function createOutputGuard(enabled: boolean, registry: SpaceRegistry): OutputGuard {
  if (!enabled) return { text: (text) => ({ text, leaks: 0 }), answer: (text) => ({ text, leaks: 0 }) };
  const clean = (text: string) => {
    const { text: named, count } = redactInternalNames(sanitizeMarkdown(text), registry);
    return { text: named, leaks: count };
  };
  return {
    text: clean,
    answer(answer, results, clarification) {
      const { text, leaks } = clean(answer);
      return { text: noDataOverride(text, results, clarification), leaks };
    },
  };
}
