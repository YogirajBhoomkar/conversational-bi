// The earlier turns sent with each question, so the server can answer a follow-up ("and by region?") without
// remembering the chat itself. Only finished answers count; the server applies its own limits again.
import type { HistoryTurn, Message } from '../types';

const DEFAULT_TURNS = 6;
const configured = Number(import.meta.env.VITE_HISTORY_TURNS ?? DEFAULT_TURNS);
export const HISTORY_TURNS = Number.isInteger(configured) && configured >= 0 ? Math.min(configured, 10) : DEFAULT_TURNS;

// Each turn is cut so the request stays well under the body limit (BI_MAX_BODY_BYTES, 64 KB by default) and inside the
// contract (question up to 4000 characters, answer up to 20000). The server keeps far less of each turn anyway
// (BI_HISTORY_MAX_CHARS), so nothing it would use is lost.
export const MAX_QUESTION_CHARS = 2000;
export const MAX_ANSWER_CHARS = 4000;
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 4)} […]` : text);

export function buildHistory(messages: Message[], turns = HISTORY_TURNS): HistoryTurn[] {
  const history: HistoryTurn[] = [];
  messages.forEach((m, i) => {
    const asked = messages[i - 1];
    if (m.role !== 'assistant' || asked?.role !== 'user') return;
    if (m.pending || m.error || !m.result?.answer.trim()) return;
    const source = m.result.sources[0];
    history.push({ question: cut(asked.text, MAX_QUESTION_CHARS), answer: cut(m.result.answer, MAX_ANSWER_CHARS), ...(source?.spaceName ? { space: source.spaceName } : {}) });
  });
  return turns > 0 ? history.slice(-turns) : [];
}
