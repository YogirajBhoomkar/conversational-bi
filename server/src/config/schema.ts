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
  DATABRICKS_GENIE_SPACE_ID: setting(z.string().optional(), 'local only: Genie space id for the space with key "placement". Needed while BI_SPACES_FILE is the example file (its ids are REPLACE_ME).', { group: 'Genie spaces', required: true }),
  DATABRICKS_GENIE_CAPACITY_SPACE_ID: setting(z.string().optional(), 'local only: Genie space id for the space with key "capacity". Needed while BI_SPACES_FILE is the example file.', { group: 'Genie spaces', required: true }),
  BI_DOMAIN_RULES_FILE: setting(z.string().optional(), 'Plain-text business rules appended to the supervisor prompt (see config/examples/domain-rules.example.md). Default in local mode: the example file.', { group: 'Genie spaces', example: 'config/domain-rules.md' }),

  // ---------------------------------------------------------------- Genie behaviour
  GENIE_MODE: setting(z.enum(['conversation', 'agent']).default('conversation'), 'conversation: the Genie Conversation API. agent: Genie Agent mode (GA), which streams the agent\'s reasoning. Do not enable its Flash option (Beta).', { group: 'Genie behaviour' }),
  GENIE_ROW_CAP: setting(int(1, 10_000).default(200), 'Rows kept per Genie result (the table preview).', { group: 'Genie behaviour' }),
  GENIE_FULL_ROW_CAP: setting(int(1, 100_000).default(5000), 'Rows kept when the user asks for the full result.', { group: 'Genie behaviour' }),
  GENIE_TIMEOUT_MS: setting(int(1000, 1_800_000).default(180_000), 'How long one Genie call may take, in milliseconds.', { group: 'Genie behaviour' }),
  GENIE_RETRY_ATTEMPTS: setting(int(1, 10).default(3), 'How many times a Genie call is tried before giving up (with backoff between tries).', { group: 'Genie behaviour' }),
  SUGGEST_WAIT_MS: setting(int(0, 60_000).default(8000), 'After the answer, how long to wait for the app\'s own follow-up questions before closing the stream, in milliseconds.', { group: 'Genie behaviour' }),

  // ---------------------------------------------------------------- AI model
  ANTHROPIC_API_KEY: setting(z.string().optional(), 'Anthropic API key. Required unless LLM_BASE_URL is set.', { group: 'AI model', required: true, secret: true }),
  ANTHROPIC_MODEL: setting(z.string().min(1).default('claude-sonnet-5-5'), 'Anthropic model id.', { group: 'AI model' }),
  LLM_BASE_URL: setting(z.url().optional(), 'An OpenAI-compatible endpoint (for example a model gateway). Setting it switches from Anthropic to this endpoint.', { group: 'AI model', example: 'https://<gateway>/v1' }),
  LLM_API_KEY: setting(z.string().optional(), 'API key for LLM_BASE_URL.', { group: 'AI model', secret: true }),
  LLM_MODEL: setting(z.string().min(1).default('gpt-5.1'), 'Model name at LLM_BASE_URL.', { group: 'AI model' }),

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
  if (!s.LLM_BASE_URL && !s.ANTHROPIC_API_KEY) problems.push({ name: 'ANTHROPIC_API_KEY', message: 'set ANTHROPIC_API_KEY, or LLM_BASE_URL for an OpenAI-compatible endpoint' });
  return problems;
}
