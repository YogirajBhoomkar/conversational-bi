// Turns the environment into one typed, validated configuration. Called once at startup by the composition root.
// `loadConfig` takes the environment as an argument (tests never touch process.env) and fails fast with one error that
// names every bad setting. Values are never echoed, so a secret cannot leak through a startup error.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GenieSpace } from '../contracts';
import { crossCheck, SettingsSchema, type Settings } from './schema';
import { type ConfigIO, loadSpaces, SPACE_ID_PREFIX } from './spaces';

// Databricks per-user login (local mode): the workspace host, the OAuth app's client id and the callback address.
export type OAuthSettings = { host: string; clientId: string; redirectUri: string };

export type ModelSettings =
  | { provider: 'anthropic'; model: string; apiKey: string }
  | { provider: 'openai-compatible'; model: string; baseUrl: string; apiKey?: string };

export type ServiceSettings = {
  enabled: boolean;
  maxBodyBytes: number;
  maxConcurrentPerUser: number;
  maxConcurrentTotal: number;
  turnTimeoutMs: number;
  sseHeartbeatMs: number;
  shutdownGraceMs: number;
  corsOrigins: string[];
  frameAncestors: string;
  build: string;
};

// The earlier turns the UI sends: how many are used, how long each may be, whether their SQL is passed on.
export type HistorySettings = { turns: number; maxChars: number; includeSql: boolean };

export type LogSettings = { format: 'pretty' | 'json'; level: 'debug' | 'info' | 'warn' | 'error'; content: boolean };

export type BiConfig = {
  mode: 'local' | 'gc';
  port: number;
  routePrefix: string;
  databricks: {
    host: string;
    token?: string;                                         // local mode, shared token
    oauth?: OAuthSettings;                                  // local mode, per-user login
  };
  genie: { mode: 'conversation' | 'agent'; rowCap: number; fullRowCap: number; timeoutMs: number; retryAttempts: number; maxPerMinute: number; queueWaitMs: number };
  suggestWaitMs: number;
  history: HistorySettings;
  model: ModelSettings;
  guards: { injection: 'off' | 'log' | 'block'; model?: ModelSettings; failClosed: boolean }; // the guard model shares the main model's provider
  logging: LogSettings;
  grounding: boolean; // log-only check that the answer's figures come from the data
  service: ServiceSettings;
  outputGuard: boolean; // clean what the model writes (core/guards/output.ts)
  spaces: GenieSpace[];
  domainRules: string;
  scope: { message?: string }; // BI_SCOPE_MESSAGE; absent: built from the spaces (core/agents/prompts.ts scopeMessage)
  uiDist?: string;
};

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

export const EXAMPLE_DOMAIN_RULES_FILE = 'config/examples/domain-rules.example.md';
const MAX_DOMAIN_RULES = 20_000;

const fileIO = (root: string): ConfigIO => ({ readFile: (p) => readFileSync(p, 'utf8'), resolve: (p) => resolve(root, p) });

// Relative file settings mean "from the server folder". `mastra start` and `mastra dev` run the build from
// server/.mastra/output; `mastra start` passes the server folder as MASTRA_PROJECT_ROOT.
export const serverRoot = (env: Record<string, string | undefined>, cwd: string) =>
  env.MASTRA_PROJECT_ROOT || (/[\\/]\.mastra[\\/]output[\\/]?$/.test(cwd) ? resolve(cwd, '..', '..') : cwd);

export function loadConfig(env: Record<string, string | undefined>, io: ConfigIO = fileIO(serverRoot(env, process.cwd()))): { config: BiConfig; warnings: string[] } {
  // An empty value means "not set", so NAME= in a .env file falls back to the default instead of becoming 0 or "".
  const given = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ''));
  const known = new Set(Object.keys(SettingsSchema.shape));
  const warnings = Object.keys(given)
    .filter((k) => k.startsWith('BI_') && !known.has(k) && !k.startsWith(SPACE_ID_PREFIX))
    .map((k) => `${k} is not a known setting (a typo?); it is ignored`);

  const parsed = SettingsSchema.safeParse(given);
  if (!parsed.success) throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  const s = parsed.data;

  const problems = crossCheck(s).map((p) => `${p.name}: ${p.message}`);
  const spaceIds = Object.fromEntries(Object.entries(given).filter(([k]) => k.startsWith(SPACE_ID_PREFIX))) as Record<string, string>;
  const spaces = loadSpaces(s, io, spaceIds);
  problems.push(...spaces.problems.map((p) => `${p.name}: ${p.message}`));
  warnings.push(...spaces.warnings);
  const domainRules = readDomainRules(s, io, problems);
  if (problems.length) throw new ConfigError(problems);

  return { config: toConfig(s, spaces.spaces, domainRules), warnings };
}

function readDomainRules(s: Settings, io: ConfigIO, problems: string[]): string {
  const file = s.BI_DOMAIN_RULES_FILE ?? (s.BI_MODE === 'local' ? EXAMPLE_DOMAIN_RULES_FILE : undefined);
  if (!file) return '';
  try {
    const text = io.readFile(io.resolve(file)).trim();
    if (text.length > MAX_DOMAIN_RULES) problems.push(`BI_DOMAIN_RULES_FILE: longer than ${MAX_DOMAIN_RULES} characters`);
    return text;
  } catch {
    problems.push('BI_DOMAIN_RULES_FILE: could not be read');
    return '';
  }
}

const mainModel = (s: Settings): ModelSettings =>
  s.LLM_BASE_URL
    ? { provider: 'openai-compatible', model: s.LLM_MODEL, baseUrl: s.LLM_BASE_URL, apiKey: s.LLM_API_KEY }
    : { provider: 'anthropic', model: s.ANTHROPIC_MODEL, apiKey: s.ANTHROPIC_API_KEY ?? '' };
const withModel = (m: ModelSettings, model: string): ModelSettings => ({ ...m, model });

function toConfig(s: Settings, spaces: GenieSpace[], domainRules: string): BiConfig {
  const local = s.BI_MODE === 'local';
  return {
    mode: s.BI_MODE,
    port: s.PORT,
    routePrefix: s.BI_ROUTE_PREFIX,
    outputGuard: s.BI_GUARD_OUTPUT === 'on',
    databricks: {
      host: s.DATABRICKS_SERVER_HOSTNAME,
      token: local ? s.DATABRICKS_TOKEN : undefined,
      oauth: local && s.DATABRICKS_CLIENT_ID
        ? { host: s.DATABRICKS_SERVER_HOSTNAME, clientId: s.DATABRICKS_CLIENT_ID, redirectUri: s.DATABRICKS_REDIRECT_URI ?? `http://localhost:${s.PORT}/auth/callback` }
        : undefined,
    },
    genie: { mode: s.GENIE_MODE, rowCap: s.GENIE_ROW_CAP, fullRowCap: s.GENIE_FULL_ROW_CAP, timeoutMs: s.GENIE_TIMEOUT_MS, retryAttempts: s.GENIE_RETRY_ATTEMPTS, maxPerMinute: s.BI_GENIE_MAX_PER_MINUTE, queueWaitMs: s.BI_GENIE_QUEUE_WAIT_MS },
    suggestWaitMs: s.SUGGEST_WAIT_MS,
    history: { turns: s.BI_HISTORY_TURNS, maxChars: s.BI_HISTORY_MAX_CHARS, includeSql: s.BI_HISTORY_INCLUDE_SQL },
    model: mainModel(s),
    service: {
      enabled: s.BI_ENABLED,
      maxBodyBytes: s.BI_MAX_BODY_BYTES,
      maxConcurrentPerUser: s.BI_MAX_CONCURRENT_PER_USER,
      maxConcurrentTotal: s.BI_MAX_CONCURRENT_TOTAL,
      turnTimeoutMs: s.BI_TURN_TIMEOUT_MS,
      sseHeartbeatMs: s.BI_SSE_HEARTBEAT_MS,
      shutdownGraceMs: s.BI_SHUTDOWN_GRACE_MS,
      corsOrigins: s.BI_CORS_ORIGINS ? s.BI_CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean) : local ? ['http://localhost:5173'] : [],
      frameAncestors: s.BI_FRAME_ANCESTORS?.trim() || "'self'",
      build: s.BI_BUILD_SHA,
    },
    guards: { injection: s.BI_GUARD_INJECTION, model: s.BI_GUARD_MODEL ? withModel(mainModel(s), s.BI_GUARD_MODEL) : undefined, failClosed: s.BI_GUARD_FAIL_CLOSED },
    logging: { format: s.BI_LOG_FORMAT ?? (local ? 'pretty' : 'json'), level: s.BI_LOG_LEVEL, content: s.BI_LOG_CONTENT },
    grounding: s.BI_GROUNDING === 'log',
    spaces,
    domainRules,
    scope: { message: s.BI_SCOPE_MESSAGE },
    uiDist: local ? s.UI_DIST : undefined,
  };
}

// The one place that reads process.env. The composition root and offline scripts call this.
export const loadProcessConfig = () => loadConfig(process.env);
