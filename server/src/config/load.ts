// Turns the environment into one typed, validated configuration. Called once at startup by the composition root.
// `loadConfig` takes the environment as an argument (tests never touch process.env) and fails fast with one error that
// names every bad setting. Values are never echoed, so a secret cannot leak through a startup error.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GenieSpace } from '../contracts';
import { crossCheck, SettingsSchema, type Settings } from './schema';
import { type ConfigIO, loadSpaces } from './spaces';

// Databricks per-user login (local mode): the workspace host, the OAuth app's client id and the callback address.
export type OAuthSettings = { host: string; clientId: string; redirectUri: string };

export type ModelSettings =
  | { provider: 'anthropic'; model: string; apiKey: string }
  | { provider: 'openai-compatible'; model: string; baseUrl: string; apiKey?: string };

export type BiConfig = {
  mode: 'local' | 'gc';
  port: number;
  routePrefix: string;
  databricks: {
    host: string;
    token?: string;                                         // local mode, shared token
    oauth?: OAuthSettings;                                  // local mode, per-user login
  };
  genie: { mode: 'conversation' | 'agent'; rowCap: number; fullRowCap: number; timeoutMs: number; retryAttempts: number };
  suggestWaitMs: number;
  model: ModelSettings;
  spaces: GenieSpace[];
  domainRules: string;
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

const fileIO = (cwd: string): ConfigIO => ({ readFile: (p) => readFileSync(p, 'utf8'), resolve: (p) => resolve(cwd, p) });

export function loadConfig(env: Record<string, string | undefined>, io: ConfigIO = fileIO(process.cwd())): { config: BiConfig; warnings: string[] } {
  // An empty value means "not set", so NAME= in a .env file falls back to the default instead of becoming 0 or "".
  const given = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ''));
  const known = new Set(Object.keys(SettingsSchema.shape));
  const warnings = Object.keys(given)
    .filter((k) => k.startsWith('BI_') && !known.has(k))
    .map((k) => `${k} is not a known setting (a typo?); it is ignored`);

  const parsed = SettingsSchema.safeParse(given);
  if (!parsed.success) throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  const s = parsed.data;

  const problems = crossCheck(s).map((p) => `${p.name}: ${p.message}`);
  const spaces = loadSpaces(s, io);
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

function toConfig(s: Settings, spaces: GenieSpace[], domainRules: string): BiConfig {
  const local = s.BI_MODE === 'local';
  return {
    mode: s.BI_MODE,
    port: s.PORT,
    routePrefix: s.BI_ROUTE_PREFIX,
    databricks: {
      host: s.DATABRICKS_SERVER_HOSTNAME,
      token: local ? s.DATABRICKS_TOKEN : undefined,
      oauth: local && s.DATABRICKS_CLIENT_ID
        ? { host: s.DATABRICKS_SERVER_HOSTNAME, clientId: s.DATABRICKS_CLIENT_ID, redirectUri: s.DATABRICKS_REDIRECT_URI ?? `http://localhost:${s.PORT}/auth/callback` }
        : undefined,
    },
    genie: { mode: s.GENIE_MODE, rowCap: s.GENIE_ROW_CAP, fullRowCap: s.GENIE_FULL_ROW_CAP, timeoutMs: s.GENIE_TIMEOUT_MS, retryAttempts: s.GENIE_RETRY_ATTEMPTS },
    suggestWaitMs: s.SUGGEST_WAIT_MS,
    model: s.LLM_BASE_URL
      ? { provider: 'openai-compatible', model: s.LLM_MODEL, baseUrl: s.LLM_BASE_URL, apiKey: s.LLM_API_KEY }
      : { provider: 'anthropic', model: s.ANTHROPIC_MODEL, apiKey: s.ANTHROPIC_API_KEY ?? '' },
    spaces,
    domainRules,
    uiDist: local ? s.UI_DIST : undefined,
  };
}

// The one place that reads process.env. The composition root and offline scripts call this.
export const loadProcessConfig = () => loadConfig(process.env);
