// What the user is told when a turn fails, by kind of failure. The details stay in the log, found by the reference
// (the trace id). The error event carries the parts separately (title, detail, reference, whether trying again may
// help) so a UI can show a friendly notice; `message` is the whole text, for clients that show only that.
import type { ChatErrorEvent } from '../../contracts';

export type FailureKind = ChatErrorEvent['kind'];

// Network failures reaching the model service: undici and Node error codes.
const UNREACHABLE_CODES = new Set(['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EPIPE']);
const UNREACHABLE_TEXT = /cannot connect to api|fetch failed|connect timeout|socket hang up|overloaded/i;

type Errorish = { statusCode?: unknown; status?: unknown; code?: unknown; message?: unknown; cause?: unknown };

// The error, its cause, the cause's cause…: the AI SDK wraps the network error, and we wrap the SDK's.
function chain(err: unknown): Errorish[] {
  const out: Errorish[] = [];
  for (let e = err, depth = 0; e && typeof e === 'object' && depth < 5; depth++) {
    out.push(e as Errorish);
    e = (e as Errorish).cause;
  }
  return out;
}

export function failureKind(err: unknown, timedOut: boolean): FailureKind {
  if (timedOut) return 'timeout';
  const links = chain(err);
  const status = links.map((e) => Number(e.statusCode ?? e.status)).find((s) => Number.isFinite(s) && s > 0);
  if (status === 429) return 'busy';
  if (status === 502 || status === 503 || status === 504 || status === 529) return 'unavailable';
  if (links.some((e) => typeof e.code === 'string' && UNREACHABLE_CODES.has(e.code))) return 'unavailable';
  if (links.some((e) => typeof e.message === 'string' && UNREACHABLE_TEXT.test(e.message))) return 'unavailable';
  return 'failed';
}

const WORDING: Record<FailureKind, { title: string; detail: (turnTimeoutMs: number) => string; retryable: boolean }> = {
  unavailable: { title: "Couldn't reach the AI service", detail: () => "The AI service isn't reachable right now. This is usually brief, so please try again in a minute.", retryable: true },
  busy: { title: 'Busy right now', detail: () => 'The assistant is handling a lot of questions right now. Please try again in a minute.', retryable: true },
  timeout: { title: 'This took too long', detail: (ms) => `This question took longer than ${Math.round(ms / 60_000)} minutes and was stopped. Try asking for less at once.`, retryable: true },
  failed: { title: 'Something went wrong', detail: () => 'Something went wrong while answering.', retryable: true },
  refused: { title: "Can't help with that", detail: () => "I can't help with that request. Please rephrase your question about the data.", retryable: false },
};

export function failureEvent(kind: FailureKind, reference: string, turnTimeoutMs: number): ChatErrorEvent {
  const { title, detail, retryable } = WORDING[kind];
  const text = detail(turnTimeoutMs);
  // `message` as before for each kind: a timeout or refusal never carried the reference, the others do.
  const message = kind === 'timeout' || kind === 'refused' ? text : `${text} If it happens again, quote reference ${reference}.`;
  return { type: 'error', message, kind, title, detail: text, retryable, reference };
}
