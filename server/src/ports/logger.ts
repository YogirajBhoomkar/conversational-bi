// Structured logging. One event name plus fields per line.
// Local: readable console lines. GC: one JSON object per line for Datadog.
// Every implementation redacts: tokens, Authorization headers, cookies and keys never reach the output, and question or
// answer text is left out unless BI_LOG_CONTENT=true.
export type LogFields = Record<string, unknown>;

export interface BiLogger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(fields: LogFields): BiLogger; // the same logger with these fields on every line (for example traceId)
}
