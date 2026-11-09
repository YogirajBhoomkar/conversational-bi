// The earlier turns sent with each question, so the server can answer a follow-up ("and by region?") without
// remembering the chat itself. Only finished answers count; the server applies its own limits again.
import type { HistoryTurn, Message } from '../types';

const configured = Number(import.meta.env.VITE_HISTORY_TURNS ?? 3);
export const HISTORY_TURNS = Number.isInteger(configured) && configured >= 0 ? Math.min(configured, 10) : 3;

export function buildHistory(messages: Message[], turns = HISTORY_TURNS): HistoryTurn[] {
  const history: HistoryTurn[] = [];
  messages.forEach((m, i) => {
    const asked = messages[i - 1];
    if (m.role !== 'assistant' || asked?.role !== 'user') return;
    if (m.pending || m.error || !m.result?.answer.trim()) return;
    const source = m.result.sources[0];
    history.push({ question: asked.text, answer: m.result.answer, ...(source?.spaceName ? { space: source.spaceName } : {}) });
  });
  return turns > 0 ? history.slice(-turns) : [];
}
