// Proposed: the "Send feedback" email (docs/lift/FEEDBACK.md). Everything the builders need about one turn.
export const REASONS = [
  { id: 'wrong_numbers', label: 'Wrong numbers' },
  { id: 'wrong_source', label: 'Wrong data source' },
  { id: 'chart_or_table', label: 'Chart or table issue' },
  { id: 'too_slow', label: 'Too slow' },
  { id: 'should_refuse', label: 'Should have been refused' },
  { id: 'other', label: 'Other' },
] as const;
export type Reason = (typeof REASONS)[number]['id'];

export type FeedbackContent = 'full' | 'question' | 'ids';
export type FeedbackFormat = 'text' | 'eml';

// What the server's GET <prefix>/client-config returns (contract 1.4.0).
export type ClientConfig = {
  feedback: { to: string[] | null; content: FeedbackContent; format: FeedbackFormat; maxUrlChars: number };
  userRef: string;
  build: string;
  contract: string;
};

export type FeedbackInput = {
  to: string[];
  reason: Reason | null; // none chosen counts as "other"
  comment?: string;
  question?: string;
  answer?: string;       // Markdown, as the model wrote it
  content: FeedbackContent;
  traceId: string;
  userRef: string;
  chatId: string;
  turn: number;
  time: string;          // ISO 8601 with the local offset
  build: string;
  contract: string;
  genieIds: string[];    // "<conversation id>/<message id>", one per source
};

export const ref8 = (traceId: string) => traceId.slice(0, 8);
export const subjectOf = (traceId: string) => `[Conversational BI] Feedback - ref ${ref8(traceId)}`;
export const chosen = (input: Pick<FeedbackInput, 'reason'>): Reason => input.reason ?? 'other';

// "2026-11-10T14:05:00+05:30": local time with its offset, so a reader in another zone can still place it.
export function isoWithOffset(date: Date): string {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
}

// The Genie ids shown: the first three, then how many more.
export function genieIdsLine(ids: string[]): string | undefined {
  if (!ids.length) return undefined;
  const shown = ids.slice(0, 3).join(', ');
  return ids.length > 3 ? `${shown} [+${ids.length - 3} more]` : shown;
}
