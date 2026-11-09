// The questions and Genie replies the scope rule is tested with, in one place: the prompt-level flow
// (core/agents/scope.test.ts) and the reply check (core/guards/scope.test.ts). Made-up wording, no real data.
import type { GenieResult } from '../../contracts';

// No data area can answer these: the user must get the scope message, and no data agent may be called.
export const OUT_OF_SCOPE = [
  'tell me a joke',
  'what is the capital of France',
  'write me a Python script',
  'write a poem about reinsurance',
  'who will win the election',
];

// These must go on as usual.
export const DATA_QUESTION = 'What was the total premium by year?';
export const FOLLOW_UP = { earlier: { question: DATA_QUESTION, answer: 'Total premium was **42M** in the latest year.' }, question: 'and by region?' };
export const ALLOWED_WITHOUT_DATA = ['hello', 'thanks', 'what can you do'];

// Partly in scope: the data part is answered, the rest declined in one sentence.
export const MIXED = 'top 5 by premium, and tell me a joke';

// One Genie result, as the data agent's tool records it.
export const genieResult = (over: Partial<GenieResult> = {}): GenieResult => ({
  spaceId: 'id-orders', question: 'q', summary: '', sql: null, columns: [], rows: [], totalRows: 0, thinking: [], suggestedQuestions: [],
  statementId: null, conversationId: 'conv', messageId: 'msg', error: null, ...over,
});

// What a Genie space may send back.
export const GENIE_REPLIES = {
  // A joke or a general answer: text only, no query ran. Genie may still offer follow-ups for it.
  textOnly: genieResult({ summary: 'Why did the spreadsheet blush? It saw the pivot table.', suggestedQuestions: ['Tell me another one?'] }),
  // A query ran and found nothing: a real "no data found" answer.
  zeroRows: genieResult({ summary: 'No rows matched.', sql: 'SELECT region, SUM(amount) FROM fake_table WHERE 1 = 0 GROUP BY region', columns: ['region', 'amount'] }),
  // A query with rows.
  withRows: genieResult({ summary: 'Totals by year.', sql: 'SELECT year, SUM(amount) FROM fake_table GROUP BY year', columns: ['year', 'amount'], rows: [[2024, 42]], totalRows: 1, suggestedQuestions: ['How does that split by region?'] }),
  // The call failed.
  failed: genieResult({ error: 'Genie did not answer in time.' }),
};
