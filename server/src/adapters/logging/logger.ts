// The BiLogger port, written to stdout. pretty: one readable line per event (local). json: one JSON object per line
// (GC, read by the Datadog agent; see docs/lift/DATADOG.md). Both remove secrets before anything is written:
// - fields whose name says secret (token, authorization, cookie, key, password, session...) are replaced;
// - values shaped like a secret (Databricks or API keys, "Bearer ...", JWTs) are replaced wherever they appear;
// - question, answer, SQL and row content is left out unless content logging is switched on (BI_LOG_CONTENT).
import type { LogSettings } from '../../config/load';
import type { BiLogger, LogFields } from '../../ports/logger';

type Level = LogSettings['level'];
const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// Whole field names that hold secrets ("inputTokens", a count, is not one of them).
const SECRET_NAME = /^(.*(secret|password|passwd|credential).*|authorization|cookie|set-cookie|api[-_]?key|key|session(id)?|((user|access|refresh|id|bearer)[-_]?)?token)$/i;
const CONTENT_NAME = /^(question|answer|prompt|message|text|sql|rows|summary|content)$/i;
const SECRET_VALUE = [
  /\bdapi[0-9a-f]{32}\b/g,                                             // Databricks personal access token
  /\bsk-[A-Za-z0-9_-]{16,}/g,                                           // Anthropic / OpenAI style keys
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,                                  // Authorization header values
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,      // JWTs (Okta and Databricks tokens)
];
const REDACTED = '[redacted]';
const OMITTED = '[omitted]';

export const scrub = (text: string) => SECRET_VALUE.reduce((t, re) => t.replace(re, REDACTED), text);

// A copy of `value` that is safe to write. Depth-limited so a large or circular object cannot blow up a log line.
export function redact(value: unknown, content: boolean, depth = 0): unknown {
  if (typeof value === 'string') return scrub(value);
  if (value instanceof Error) return { name: value.name, message: scrub(value.message) };
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 4) return '[…]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, content, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_NAME.test(k)) out[k] = REDACTED;
    else if (!content && CONTENT_NAME.test(k)) out[k] = OMITTED;
    else out[k] = redact(v, content, depth + 1);
  }
  return out;
}

const pretty = (time: Date, level: Level, event: string, fields: Record<string, unknown>) => {
  const kv = Object.entries(fields).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ');
  return `${time.toISOString().slice(11, 19)} ${level.toUpperCase().padEnd(5)} ${event}${kv ? ` ${kv}` : ''}`;
};

export function createLogger(settings: LogSettings, base: LogFields = {}, write: (line: string) => void = (l) => process.stdout.write(`${l}\n`)): BiLogger {
  const at = (level: Level) => (event: string, fields: LogFields = {}) => {
    if (RANK[level] < RANK[settings.level]) return;
    const safe = redact({ ...base, ...fields }, settings.content) as Record<string, unknown>;
    const time = new Date();
    write(settings.format === 'json' ? JSON.stringify({ timestamp: time.toISOString(), level, message: event, event, service: 'conversational-bi', ...safe }) : pretty(time, level, event, safe));
  };
  return {
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    child: (fields) => createLogger(settings, { ...base, ...fields }, write),
  };
}
