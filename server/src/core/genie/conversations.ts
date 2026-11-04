import type { GenieResult } from '../../contracts';

// Maps (thread, space) -> Genie conversationId so follow-ups keep Genie's context. In-memory; use Postgres/Redis in prod.
const store = new Map<string, string>();
const k = (threadId: string, spaceId: string) => `${threadId}::${spaceId}`;

export const getConversationId = (threadId: string, spaceId: string) => store.get(k(threadId, spaceId));
export const setConversationId = (threadId: string, spaceId: string, conversationId: string) =>
  void store.set(k(threadId, spaceId), conversationId);

// Latest result per (thread, space), so a later turn can load the full result of a query that was only previewed.
const lastResults = new Map<string, GenieResult>();
export const getLastResult = (threadId: string, spaceId: string) => lastResults.get(k(threadId, spaceId));
export const setLastResult = (threadId: string, spaceId: string, result: GenieResult) =>
  void lastResults.set(k(threadId, spaceId), result);
