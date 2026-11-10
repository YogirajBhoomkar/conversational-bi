// Renders the published contract from the zod schemas in contracts.ts, so it can never drift from what the server
// checks and sends: one JSON Schema per message, and an OpenAPI description of the routes. Written to server/contracts
// by `npm run contracts`; contractFiles.test.ts fails when the committed files are out of date.
import { z } from 'zod';
import { ChartSpecSchema, ChatEventSchema, ChatRequestSchema, ClientConfigSchema, CONTRACT_VERSION, FeedbackOpenedSchema, FeedbackRequestSchema, FinalAnswerSchema } from './contracts';

const SCHEMAS = {
  ChatRequest: ChatRequestSchema,
  FeedbackRequest: FeedbackRequestSchema,
  ChatEvent: ChatEventSchema,
  FinalAnswer: FinalAnswerSchema,
  ChartSpec: ChartSpecSchema,
  ClientConfig: ClientConfigSchema,
  FeedbackOpened: FeedbackOpenedSchema,
} as const;

const fileName = (name: string) => `${name.replace(/[A-Z]/g, (c, i) => (i ? '-' : '') + c.toLowerCase())}.schema.json`;
const jsonSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>;

const ErrorBody = {
  type: 'object',
  required: ['error'],
  properties: {
    error: { type: 'string', description: 'A message that can be shown to the user' },
    issues: { type: 'array', items: { type: 'string' }, description: '400 only: what is wrong with the request' },
    reason: { type: 'string', enum: ['disabled', 'draining', 'user-busy', 'busy'], description: '429 and 503 only' },
    relogin: { type: 'boolean', description: '401 only: the user must sign in again' },
    traceId: { type: 'string', description: 'Reference to quote; finds the log lines of the request' },
  },
};

const errors = (...codes: number[]) => {
  const why: Record<number, string> = {
    400: 'The body does not match the schema', 401: 'No valid identity', 413: 'The body is larger than BI_MAX_BODY_BYTES',
    429: 'Too many questions running (Retry-After says when to try again)', 500: 'A bug; the body holds the trace id',
    502: 'Genie refused', 503: 'Switched off (BI_ENABLED=false) or restarting (Retry-After says when to try again)',
  };
  return Object.fromEntries(codes.map((c) => [String(c), { description: why[c], content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }]));
};

function openApi() {
  const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
  const json = (schema: unknown) => ({ 'application/json': { schema } });
  return {
    openapi: '3.1.0',
    info: {
      title: 'Conversational BI',
      version: CONTRACT_VERSION,
      description: 'Ask questions about data in plain language. The path prefix is BI_ROUTE_PREFIX (default /bi). Every response carries X-Trace-Id; a caller may send traceparent or X-Trace-Id to join its own trace. The caller is identified by the host (an Okta bearer token in GC).',
    },
    paths: {
      '/bi/chat': {
        post: {
          summary: 'Ask a question; the answer streams back as Server-Sent Events',
          description: 'Each `data:` line is one ChatEvent (JSON). Lines starting with `:` are keep-alive comments. The stream ends after `final` (and any `suggestions`), or after `error`.',
          requestBody: { required: true, content: json(ref('ChatRequest')) },
          responses: { '200': { description: 'The answer stream', content: { 'text/event-stream': { schema: ref('ChatEvent') } } }, ...errors(400, 401, 413, 429, 500, 503) },
        },
      },
      '/bi/feedback': {
        post: {
          summary: 'Rate an answer; passed on to Genie',
          requestBody: { required: true, content: json(ref('FeedbackRequest')) },
          responses: { '200': { description: 'Recorded', content: json({ type: 'object', properties: { ok: { const: true } } }) }, ...errors(400, 401, 413, 429, 500, 502, 503) },
        },
      },
      '/bi/client-config': {
        get: {
          summary: 'Proposed: settings the UI needs (where feedback emails go, the user ref of the caller, versions)',
          responses: { '200': { description: 'Client settings', content: json(ref('ClientConfig')) }, ...errors(401, 500) },
        },
      },
      '/bi/feedback/opened': {
        post: {
          summary: 'Proposed: count that a feedback email was opened (type only, no chat text)',
          requestBody: { required: true, content: json(ref('FeedbackOpened')) },
          responses: { '204': { description: 'Counted' }, ...errors(400, 401, 413, 500) },
        },
      },
      '/bi/version': {
        get: {
          summary: 'Contract and build version',
          responses: { '200': { description: 'Versions', content: json({ type: 'object', required: ['service', 'contract', 'build'], properties: { service: { type: 'string' }, contract: { type: 'string' }, build: { type: 'string' } } }) } },
        },
      },
      '/health/live': { get: { summary: 'Liveness: the process answers', responses: { '200': { description: 'Alive' } } } },
      '/health/ready': { get: { summary: 'Readiness: takes new questions (no Databricks call)', responses: { '200': { description: 'Ready' }, '503': { description: 'Shutting down' } } } },
    },
    components: {
      schemas: {
        ...Object.fromEntries(Object.entries(SCHEMAS).map(([name, schema]) => {
          const { $schema: _, ...rest } = jsonSchema(schema);
          return [name, rest];
        })),
        Error: ErrorBody,
      },
    },
  };
}

// A small YAML writer for the OpenAPI file: every string and key is double-quoted (valid YAML), so nothing is ambiguous.
function yaml(value: unknown, indent = ''): string {
  const next = `${indent}  `;
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return value.map((v) => `\n${indent}- ${typeof v === 'object' && v !== null ? yaml(v, next).trimStart() : yaml(v, next)}`).join('');
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value);
    if (!entries.length) return '{}';
    return entries.map(([k, v]) => {
      const key = /^[A-Za-z_][A-Za-z0-9_-]*$/.test(k) ? k : JSON.stringify(k);
      const inner = yaml(v, next);
      return `\n${indent}${key}:${inner.startsWith('\n') ? inner : ` ${inner}`}`;
    }).join('');
  }
  return JSON.stringify(value);
}

export function renderContractFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    files[fileName(name)] = `${JSON.stringify({ title: name, ...jsonSchema(schema), $comment: `Conversational BI contract ${CONTRACT_VERSION}. Generated by npm run contracts; do not edit.` }, null, 2)}\n`;
  }
  files['bi.openapi.yaml'] = `# Conversational BI API, contract ${CONTRACT_VERSION}. Generated by npm run contracts; do not edit.${yaml(openApi())}\n`;
  return files;
}
