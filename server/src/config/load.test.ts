import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, EXAMPLE_DOMAIN_RULES_FILE, loadConfig, serverRoot } from './load';
import { EXAMPLE_SPACES_FILE, type ConfigIO } from './spaces';

const space = (key: string, spaceId: string, extra: object = {}) => ({ key, name: `Space ${key}`, description: `Covers the ${key} data in enough words to route by.`, spaceId, ...extra });

// An in-memory file system, so tests never read the real example files or server/.env.
const files = (map: Record<string, string>): ConfigIO => ({
  resolve: (p) => p,
  readFile: (p) => {
    if (!(p in map)) throw new Error(`ENOENT ${p}`);
    return map[p];
  },
});
const EXAMPLES = files({
  [EXAMPLE_SPACES_FILE]: JSON.stringify([space('placement', 'REPLACE_ME'), space('capacity', 'REPLACE_ME')]),
  [EXAMPLE_DOMAIN_RULES_FILE]: 'Year means underwriting year.\n',
});

const LOCAL = { DATABRICKS_SERVER_HOSTNAME: 'https://ws.example/', DATABRICKS_TOKEN: 'secret-pat-value', ANTHROPIC_API_KEY: 'secret-model-key', BI_SPACE_ID_PLACEMENT: 'id-a', BI_SPACE_ID_CAPACITY: 'id-b' };
const GC = { BI_MODE: 'gc', DATABRICKS_SERVER_HOSTNAME: 'ws.example', ANTHROPIC_API_KEY: 'k', BI_SPACES_JSON: JSON.stringify([space('one', 'id-1')]) };

const problemsOf = (env: Record<string, string | undefined>, io: ConfigIO = EXAMPLES): string[] => {
  try {
    loadConfig(env, io);
  } catch (e) {
    if (e instanceof ConfigError) return e.problems;
    throw e;
  }
  return [];
};

describe('loadConfig', () => {
  it('keeps today\'s local behaviour: defaults, example spaces with ids from BI_SPACE_ID_<KEY>, example domain rules', () => {
    const { config, warnings } = loadConfig(LOCAL, EXAMPLES);
    expect(warnings).toEqual([]);
    expect(config).toMatchObject({
      mode: 'local',
      port: 4111,
      databricks: { host: 'ws.example', token: 'secret-pat-value', oauth: undefined },
      genie: { mode: 'conversation', rowCap: 200, fullRowCap: 5000, timeoutMs: 180_000, retryAttempts: 3 },
      suggestWaitMs: 8000,
      model: { provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: 'secret-model-key' },
      domainRules: 'Year means underwriting year.',
    });
    expect(config.spaces.map((s) => [s.key, s.spaceId])).toEqual([['placement', 'id-a'], ['capacity', 'id-b']]);
  });

  it('treats an empty value as not set, so the default applies', () => {
    expect(loadConfig({ ...LOCAL, GENIE_ROW_CAP: '', PORT: '  ' }, EXAMPLES).config).toMatchObject({ port: 4111, genie: { rowCap: 200 } });
  });

  it('switches to per-user login and the OpenAI-compatible model when those are set', () => {
    const { config } = loadConfig({ ...LOCAL, DATABRICKS_CLIENT_ID: 'client', PORT: '1976', LLM_BASE_URL: 'https://gw.example/v1', LLM_API_KEY: 'k' }, EXAMPLES);
    expect(config.databricks.oauth).toEqual({ host: 'ws.example', clientId: 'client', redirectUri: 'http://localhost:1976/auth/callback' });
    expect(config.model).toEqual({ provider: 'openai-compatible', model: 'gpt-5.1', baseUrl: 'https://gw.example/v1', apiKey: 'k' });
  });

  it('lists every bad setting by name in one error and never echoes a value', () => {
    let error: unknown;
    try {
      loadConfig({ DATABRICKS_TOKEN: 'secret-pat-value', GENIE_ROW_CAP: 'lots', GENIE_MODE: 'turbo', LLM_BASE_URL: 'not a url' }, EXAMPLES);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as Error).message;
    for (const name of ['DATABRICKS_SERVER_HOSTNAME', 'GENIE_ROW_CAP', 'GENIE_MODE', 'LLM_BASE_URL']) expect(message).toContain(name);
    for (const value of ['secret-pat-value', 'lots', 'turbo', 'not a url']) expect(message).not.toContain(value);
  });

  it('checks settings that depend on each other', () => {
    expect(problemsOf({ ...LOCAL, DATABRICKS_TOKEN: undefined })).toEqual([expect.stringMatching(/^DATABRICKS_TOKEN: .*DATABRICKS_CLIENT_ID/)]);
    expect(problemsOf({ ...LOCAL, ANTHROPIC_API_KEY: undefined })).toEqual([expect.stringMatching(/^ANTHROPIC_API_KEY: /)]);
  });

  it('warns about unknown BI_ settings (typos) without failing', () => {
    expect(loadConfig({ ...LOCAL, BI_MODEE: 'gc' }, EXAMPLES).warnings).toEqual(['BI_MODEE is not a known setting (a typo?); it is ignored']);
  });

  it('gc mode: needs a spaces list, refuses a shared token and UI serving, does not fall back to the example files', () => {
    const { config } = loadConfig(GC, files({}));
    expect(config).toMatchObject({ mode: 'gc', domainRules: '', uiDist: undefined, databricks: { token: undefined, oauth: undefined } });
    expect(config.spaces.map((s) => s.spaceId)).toEqual(['id-1']);

    const problems = problemsOf({ ...GC, BI_SPACES_JSON: undefined, DATABRICKS_TOKEN: 't', UI_DIST: '/ui' }, files({}));
    expect(problems).toEqual(expect.arrayContaining([expect.stringMatching(/^BI_SPACES_FILE: /), expect.stringMatching(/^DATABRICKS_TOKEN: /), expect.stringMatching(/^UI_DIST: /)]));
  });

  it('reads spaces from a file and domain rules from a file', () => {
    const io = files({ 'spaces.json': JSON.stringify([space('one', 'id-1'), space('two', 'id-2', { enabled: false, routing: 'Two questions.' })]), 'rules.md': 'Rule.' });
    const { config } = loadConfig({ ...GC, BI_SPACES_JSON: undefined, BI_SPACES_FILE: 'spaces.json', BI_DOMAIN_RULES_FILE: 'rules.md' }, io);
    expect(config.spaces).toEqual([
      { ...space('one', 'id-1'), enabled: true },
      { ...space('two', 'id-2'), enabled: false, routing: 'Two questions.' },
    ]);
    expect(config.domainRules).toBe('Rule.');
  });

  it('rejects bad space lists with the position and field', () => {
    const bad = (list: unknown) => problemsOf({ ...GC, BI_SPACES_JSON: JSON.stringify(list) }, files({}));
    expect(bad([])).toEqual(['BI_SPACES_JSON: at least one space is needed']);
    expect(bad([space('one', 'id-1'), space('one', 'id-2')])).toEqual(['BI_SPACES_JSON[1.key]: duplicate key']);
    expect(bad([space('one', 'id-1'), space('two', 'id-1')])).toEqual(['BI_SPACES_JSON[1.spaceId]: duplicate spaceId']);
    expect(bad([space('Bad-Key', 'id-1')])).toEqual(['BI_SPACES_JSON[0.key]: lowercase letters, digits and _ only']);
    expect(bad([space('one', 'id-1', { enabled: false })])).toEqual(['BI_SPACES_JSON: every space is disabled']);
    expect(problemsOf({ ...GC, BI_SPACES_JSON: '[{' }, files({}))).toEqual(['BI_SPACES_JSON: is not valid JSON']);
    expect(problemsOf({ ...GC, BI_SPACES_JSON: undefined, BI_SPACES_FILE: 'missing.json' }, files({}))).toEqual(['BI_SPACES_FILE: could not be read']);
  });

  it('a space id left as REPLACE_ME names the variable for that space key', () => {
    const problems = problemsOf({ ...LOCAL, BI_SPACE_ID_CAPACITY: undefined });
    expect(problems).toEqual(['BI_SPACES_FILE[1.spaceId]: still the placeholder REPLACE_ME: set BI_SPACE_ID_CAPACITY (in server/.env when running locally)']);
  });

  it('takes the id of any space from BI_SPACE_ID_<KEY>, in every mode, and warns about one with no matching space', () => {
    const { config, warnings } = loadConfig({ ...GC, BI_SPACE_ID_ONE: 'from-env', BI_SPACE_ID_NOPE: 'x' }, files({}));
    expect(config.spaces[0].spaceId).toBe('from-env');
    expect(warnings).toEqual(['BI_SPACE_ID_NOPE is set but no space has that key; it is ignored']);
  });

  it('resolves relative files from the server folder, also when Mastra runs the build from .mastra/output', () => {
    expect(serverRoot({ MASTRA_PROJECT_ROOT: '/srv/server' }, '/srv/server/.mastra/output')).toBe('/srv/server');
    expect(serverRoot({}, resolve('/srv/server/.mastra/output'))).toBe(resolve('/srv/server'));
    expect(serverRoot({}, '/srv/server')).toBe('/srv/server');
  });
});
