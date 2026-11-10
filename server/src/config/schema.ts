// Every setting the server reads, in one zod schema. Keys are environment variable names: the names that existed before
// keep working, and new settings start with BI_. `.describe()` is the help text, `.meta()` says how the setting is shown
// in server/.env.example (group, whether a local developer must fill it, whether it is a secret).
import { z } from 'zod';

export type SettingMeta = {
  group: string;
  required?: boolean; // listed without "#" in .env.example: a local developer must fill it in
  secret?: boolean;   // never echoed in errors or logs
  example?: string;   // value shown in .env.example for an optional setting, when it has no default
};

const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const flag = () => z.enum(['true', 'false']).transform((v) => v === 'true');
const setting = <T extends z.ZodType>(schema: T, description: string, meta: SettingMeta): T => schema.describe(description).meta(meta) as T;

export const SettingsSchema = z.object({
  // ---------------------------------------------------------------- Mode
  BI_MODE: setting(z.enum(['local', 'gc']).default('local'), 'local: shared token or Databricks login, serves the UI (development). gc: Okta bearer token per request, no cookie login, no UI.', { group: 'Mode' }),
  PORT: setting(int(1, 65535).default(4111), 'Port the server listens on (npm start uses 1976).', { group: 'Mode' }),
  BI_ROUTE_PREFIX: setting(
    z.string().regex(/^\/[a-z0-9_\/-]*[a-z0-9_-]$/, 'a path such as /bi, starting with / and not ending with /').refine((p) => !/^\/api(\/|$)/.test(p), '/api is reserved by Mastra').default('/bi'),
    'Path prefix of the chat and feedback routes (POST <prefix>/chat, POST <prefix>/feedback). Change it if the host API already uses /bi.',
    { group: 'Mode' },
  ),

  // ---------------------------------------------------------------- Databricks
  DATABRICKS_SERVER_HOSTNAME: setting(z.string().trim().min(1).transform((h) => h.replace(/^https?:\/\//, '').replace(/\/+$/, '')), 'Workspace host, with or without https:// (for example <workspace>.azuredatabricks.net).', { group: 'Databricks', required: true }),
  DATABRICKS_TOKEN: setting(z.string().optional(), 'local only: one shared personal access token. Everyone acts as this token. Not allowed in gc mode.', { group: 'Databricks', required: true, secret: true }),
  DATABRICKS_CLIENT_ID: setting(z.string().optional(), 'local only: the OAuth app connection client id. When set, each user logs in to Databricks and DATABRICKS_TOKEN is not used.', { group: 'Databricks' }),
  DATABRICKS_REDIRECT_URI: setting(z.url().optional(), 'local only: login callback address. Must match the redirect URL registered in Databricks. Default: http://localhost:<PORT>/auth/callback', { group: 'Databricks' }),

  // ---------------------------------------------------------------- Genie spaces and domain text
  BI_SPACES_FILE: setting(z.string().optional(), 'JSON file listing the Genie spaces (see config/examples/spaces.example.json). Relative paths start from the server folder. Default in local mode: the example file.', { group: 'Genie spaces', example: 'config/spaces.json' }),
  BI_SPACES_JSON: setting(z.string().optional(), 'The same list as BI_SPACES_FILE, inline as JSON. Wins over BI_SPACES_FILE.', { group: 'Genie spaces' }),
  BI_DOMAIN_RULES_FILE: setting(z.string().optional(), 'Plain-text business rules appended to the supervisor prompt (see config/examples/domain-rules.example.md). Default in local mode: the example file.', { group: 'Genie spaces', example: 'config/domain-rules.md' }),

  // ---------------------------------------------------------------- Scope (off-topic questions)
  BI_GUARD_SCOPE: setting(z.enum(['off', 'log', 'enforce']).default('enforce'), 'Reply check for off-topic questions: when every Genie call of a turn answered with text only (no SQL, no rows) and no question went back to the user, the answer is not data. enforce: replace it with the scope message (no table, charts, sources or follow-ups). log: only record it. off: no check. No extra model calls.', { group: 'Scope' }),
  BI_SCOPE_MESSAGE: setting(z.string().trim().min(1).max(1000).optional(), 'The reply to a question none of the Genie spaces can answer (a joke, general knowledge, coding). Default: built from the space names and descriptions ("I can help with questions about <spaces>. Ask me something about that data.").', { group: 'Scope' }),

  // ---------------------------------------------------------------- Genie behaviour
  GENIE_MODE: setting(z.enum(['conversation', 'agent']).default('conversation'), 'conversation: the Genie Conversation API. agent: Genie Agent mode (GA), which streams the agent\'s reasoning. Do not enable its Flash option (Beta).', { group: 'Genie behaviour' }),
  GENIE_ROW_CAP: setting(int(1, 10_000).default(200), 'Rows kept per Genie result (the table preview).', { group: 'Genie behaviour' }),
  GENIE_FULL_ROW_CAP: setting(int(1, 100_000).default(5000), 'Rows kept when the user asks for the full result.', { group: 'Genie behaviour' }),
  GENIE_TIMEOUT_MS: setting(int(1000, 1_800_000).default(180_000), 'How long one Genie call may take, in milliseconds.', { group: 'Genie behaviour' }),
  GENIE_RETRY_ATTEMPTS: setting(int(1, 10).default(3), 'How many times a Genie call is tried before giving up (with backoff between tries).', { group: 'Genie behaviour' }),
  BI_GENIE_MAX_PER_MINUTE: setting(int(0, 10_000).default(5), 'Most questions this instance starts at Genie per minute (only the POST that starts a question counts, not polling). Set it to the workspace quota divided by the number of pods. 0 turns the limit off.', { group: 'Genie behaviour' }),
  BI_GENIE_QUEUE_WAIT_MS: setting(int(0, 600_000).default(60_000), 'Longest a question waits for a free Genie slot, in milliseconds; past it the data source answers that it is busy.', { group: 'Genie behaviour' }),
  BI_HISTORY_TURNS: setting(int(0, 10).default(6), 'How many of the latest earlier turns sent by the UI the server passes to the model, so follow-ups work. 0 turns history off.', { group: 'Genie behaviour' }),
  BI_HISTORY_MAX_CHARS: setting(int(100, 20_000).default(1500), 'Longest question and longest answer kept per earlier turn, in characters; longer text is cut and marked with an ellipsis.', { group: 'Genie behaviour' }),
  BI_HISTORY_INCLUDE_SQL: setting(flag().default(false), 'true: pass the SQL of earlier turns, when the UI sends it, to the model. false: any SQL sent is ignored.', { group: 'Genie behaviour' }),
  SUGGEST_WAIT_MS: setting(int(0, 60_000).default(8000), 'After the answer, how long to wait for the app\'s own follow-up questions before closing the stream, in milliseconds.', { group: 'Genie behaviour' }),

  // ---------------------------------------------------------------- AI model
  ANTHROPIC_API_KEY: setting(z.string().optional(), 'Anthropic API key. Required unless LLM_BASE_URL is set.', { group: 'AI model', required: true, secret: true }),
  ANTHROPIC_MODEL: setting(z.string().min(1).default('claude-sonnet-5-5'), 'Anthropic model id.', { group: 'AI model' }),
  LLM_BASE_URL: setting(z.url().optional(), 'An OpenAI-compatible endpoint (for example a model gateway). Setting it switches from Anthropic to this endpoint.', { group: 'AI model', example: 'https://<gateway>/v1' }),
  LLM_API_KEY: setting(z.string().optional(), 'API key for LLM_BASE_URL.', { group: 'AI model', secret: true }),
  LLM_MODEL: setting(z.string().min(1).default('gpt-5.1'), 'Model name at LLM_BASE_URL.', { group: 'AI model' }),

  // ---------------------------------------------------------------- Input guards
  BI_GUARD_INJECTION: setting(z.enum(['off', 'log', 'block']).default('off'), 'Prompt-injection check on each question. off: none. log: record a hit and answer anyway. block: refuse the question. When on, it adds one call to BI_GUARD_MODEL per question, before anything streams.', { group: 'Input guards' }),
  BI_GUARD_MODEL: setting(z.string().trim().min(1).optional(), 'Model for the prompt-injection check (required unless BI_GUARD_INJECTION=off): a small, cheap model on the same provider and endpoint as the main model.', { group: 'Input guards', example: 'claude-haiku-5-5' }),
  BI_GUARD_FAIL_CLOSED: setting(flag().default(false), 'true: refuse the question when the guard model fails. false: answer anyway and log it. Has no effect on Mastra 1.32 (the version GC runs), which has no errorStrategy: there the question is always answered.', { group: 'Input guards' }),

  // ---------------------------------------------------------------- Service limits and safety
  BI_ENABLED: setting(flag().default(true), 'false switches chat and feedback off (503 with a friendly message) without taking the service down. Health checks keep answering.', { group: 'Service' }),
  BI_MAX_BODY_BYTES: setting(int(1024, 1_048_576).default(65_536), 'Largest request body accepted, in bytes (413 above it). Leave room for the chat history the UI sends with each question.', { group: 'Service' }),
  BI_MAX_CONCURRENT_PER_USER: setting(int(1, 20).default(2), 'Questions one user can have running at once (429 above it).', { group: 'Service' }),
  BI_MAX_CONCURRENT_TOTAL: setting(int(1, 10_000).default(50), 'Questions this instance runs at once, all users together (429 above it).', { group: 'Service' }),
  BI_TURN_TIMEOUT_MS: setting(int(10_000, 1_800_000).default(300_000), 'Longest one question may run, in milliseconds; then it is stopped and the user is told.', { group: 'Service' }),
  BI_SSE_HEARTBEAT_MS: setting(int(0, 120_000).default(15_000), 'While an answer streams, a keep-alive comment is sent after this many milliseconds of silence, so proxies do not close the connection. 0 turns it off.', { group: 'Service' }),
  BI_SHUTDOWN_GRACE_MS: setting(int(0, 600_000).default(25_000), 'On SIGTERM, new questions are refused at once and running ones get this long to finish. Keep it below the pod\'s terminationGracePeriodSeconds.', { group: 'Service' }),
  BI_CORS_ORIGINS: setting(z.string().optional(), 'Comma-separated browser origins allowed to call the API from another origin. Default: http://localhost:5173 locally, none in gc mode (same origin only).', { group: 'Service', example: 'https://<gc-ui-host>' }),
  BI_FRAME_ANCESTORS: setting(z.string().optional(), 'Space-separated origins allowed to show the served UI in a frame (Content-Security-Policy frame-ancestors). Default: \'self\'.', { group: 'Service', example: "'self' https://<gc-ui-host>" }),

  BI_BUILD_SHA: setting(z.string().trim().min(1).max(64).default('local'), 'The commit the image was built from; set by the image build (Dockerfile) and shown by GET <prefix>/version.', { group: 'Service' }),

  // ---------------------------------------------------------------- Logging
  BI_LOG_FORMAT: setting(z.enum(['pretty', 'json']).optional(), 'pretty: one readable line per event (default locally). json: one JSON object per line, for Datadog (default in gc mode).', { group: 'Logging' }),
  BI_LOG_LEVEL: setting(z.enum(['debug', 'info', 'warn', 'error']).default('info'), 'The lowest level written.', { group: 'Logging' }),
  BI_GROUNDING: setting(z.enum(['off', 'log']).default('log'), 'log: count the figures in each answer that match nothing the data returned (grounding in the chat.turn log; the values only with BI_LOG_CONTENT). Never changes the answer. off: no check.', { group: 'Logging' }),
  BI_LOG_CONTENT: setting(flag().default(false), 'true: also log question and answer text and SQL (for debugging only). Secrets are removed either way.', { group: 'Logging' }),

  // ---------------------------------------------------------------- Output guards
  BI_GUARD_OUTPUT: setting(z.enum(['on', 'off']).default('on'), 'on: remove images, links, raw HTML, bare URLs and internal agent or tool names from what the model writes, and replace an answer with figures when no data came back. No extra model calls.', { group: 'Output guards' }),

  // ---------------------------------------------------------------- Local UI
  UI_DIST: setting(z.string().optional(), 'local only: folder of the built UI to serve from the same port. npm start sets it; do not put it in .env.', { group: 'Local UI' }),
});

export type Settings = z.output<typeof SettingsSchema>;
export type SettingName = keyof typeof SettingsSchema.shape;

export const settingMeta = (name: SettingName): SettingMeta => SettingsSchema.shape[name].meta() as SettingMeta;

// Rules that depend on more than one setting. Each problem names the setting, never its value.
export function crossCheck(s: Settings): Array<{ name: SettingName; message: string }> {
  const problems: Array<{ name: SettingName; message: string }> = [];
  if (s.BI_MODE === 'local' && !s.DATABRICKS_TOKEN && !s.DATABRICKS_CLIENT_ID) {
    problems.push({ name: 'DATABRICKS_TOKEN', message: 'set DATABRICKS_TOKEN (shared token) or DATABRICKS_CLIENT_ID (per-user login)' });
  }
  if (s.BI_MODE === 'gc') {
    if (s.DATABRICKS_TOKEN) problems.push({ name: 'DATABRICKS_TOKEN', message: 'a shared token is not allowed in gc mode' });
    if (s.UI_DIST) problems.push({ name: 'UI_DIST', message: 'the UI is not served in gc mode' });
    if (!s.BI_SPACES_FILE && !s.BI_SPACES_JSON) problems.push({ name: 'BI_SPACES_FILE', message: 'set BI_SPACES_FILE or BI_SPACES_JSON' });
  }
  if (s.BI_GUARD_INJECTION !== 'off' && !s.BI_GUARD_MODEL) problems.push({ name: 'BI_GUARD_MODEL', message: 'set BI_GUARD_MODEL, or BI_GUARD_INJECTION=off' });
  if (!s.LLM_BASE_URL && !s.ANTHROPIC_API_KEY) problems.push({ name: 'ANTHROPIC_API_KEY', message: 'set ANTHROPIC_API_KEY, or LLM_BASE_URL for an OpenAI-compatible endpoint' });
  return problems;
}
