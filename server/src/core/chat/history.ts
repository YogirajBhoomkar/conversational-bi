// Turns the chat history the UI sends into the earlier messages of the supervisor's prompt. The history is untrusted
// text from the browser, so this is the one place it is shaped: only the latest turns, each part capped, control
// characters removed, and only user and assistant roles (one pair per turn). It can never add a system or tool message.
import type { HistoryTurn } from '../../contracts';
import type { HistorySettings } from '../../config/load';

export type PriorMessage = { role: 'user'; content: string } | { role: 'assistant'; content: string };

// Keeps tab and newline; drops the other C0/C1 control characters and the Unicode bidi overrides that can hide text.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F‪-‮⁦-⁩]/g;
const ELLIPSIS = ' […]';

export const cleanText = (text: string) => text.replace(CONTROL, '').trim();

export const capText = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - ELLIPSIS.length).trimEnd()}${ELLIPSIS}` : text);

// The turns used: the latest `turns`, cleaned and capped, without empty ones. Shared by the supervisor and the suggester.
export function recentHistory(history: HistoryTurn[] | undefined, settings: HistorySettings): HistoryTurn[] {
  if (!history?.length || settings.turns === 0) return [];
  return history
    .map((t) => ({
      question: capText(cleanText(t.question), settings.maxChars),
      answer: capText(cleanText(t.answer), settings.maxChars),
      space: t.space ? cleanText(t.space).slice(0, 100) : undefined,
      sql: settings.includeSql && t.sql ? capText(cleanText(t.sql), settings.maxChars) : undefined,
    }))
    .filter((t) => t.question && t.answer)
    .slice(-settings.turns);
}

// The supervisor's earlier messages for the turns `recentHistory` kept.
export function priorMessages(turns: HistoryTurn[]): PriorMessage[] {
  return turns.flatMap((t): PriorMessage[] => [
    { role: 'user', content: t.question },
    { role: 'assistant', content: [t.answer, t.space ? `(Source: ${t.space})` : '', t.sql ? `SQL used: ${t.sql}` : ''].filter(Boolean).join('\n') },
  ]);
}
