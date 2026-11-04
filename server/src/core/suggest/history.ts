// What was asked and suggested earlier in a chat, so new follow-ups build on the conversation and never repeat.
// In memory like the other per-thread state (genie/conversations.ts), so it resets when the server restarts.
import type { Turn } from '../../ports/state';
export type { Turn };

const MAX_TURNS = 6;
const turns = new Map<string, Turn[]>();

export const recentTurns = (threadId: string): Turn[] => turns.get(threadId) ?? [];
export const recordTurn = (threadId: string, turn: Turn) => void turns.set(threadId, [...recentTurns(threadId), turn].slice(-MAX_TURNS));
