// What the server remembers between turns of one chat thread.
// Phase 1: in memory with a TTL and a size cap (adapters/local/state), so a second pod or a restart starts a thread over.
// Phase 2: a shared store (for example MongoDB) implements the same async API without changing callers.
// Thread ids are already per user (<user>::<thread>). Never store tokens here.
import type { GenieResult } from '../contracts';

// One earlier turn, used to write follow-up questions that build on the chat.
export type Turn = { question: string; answer: string; suggested: string[] };

export interface StateStore {
  readonly ttlMs: number; // a thread untouched for this long is forgotten

  // Genie's conversation id per (thread, space), so a follow-up keeps Genie's context.
  getConversationId(threadId: string, spaceId: string): Promise<string | undefined>;
  setConversationId(threadId: string, spaceId: string, conversationId: string): Promise<void>;

  // The latest Genie result per (thread, space), so a later turn can load its full result.
  getLastResult(threadId: string, spaceId: string): Promise<GenieResult | undefined>;
  setLastResult(threadId: string, spaceId: string, result: GenieResult): Promise<void>;

  // The most recent turns of a thread, oldest first.
  getTurns(threadId: string): Promise<Turn[]>;
  setTurns(threadId: string, turns: Turn[]): Promise<void>;

  deleteThread(threadId: string): Promise<void>;
  size(): Promise<number>; // threads held, for metrics and readiness
}
