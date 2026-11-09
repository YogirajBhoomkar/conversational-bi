// The repository is public. This fails the build if a tracked file looks like it holds a secret, a real workspace host
// or a real Genie space id. It is a safety net, not a guarantee: keep the repository private for client work.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PATTERNS: Array<[string, RegExp]> = [
  ['Databricks token', /\bdapi[0-9a-f]{32}/],
  ['Anthropic key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI-style key', /\bsk-(proj-)?[A-Za-z0-9_-]{32,}/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['Genie space or workspace id (32 hex)', /\b[0-9a-f]{32}\b/],
  ['Azure Databricks workspace host', /\badb-\d{5,}\.\d+\.azuredatabricks\.net/],
  ['Azure Container Apps host', /[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+\.azurecontainerapps\.io/],
  ['secret value in an env file', /^(DATABRICKS_TOKEN|ANTHROPIC_API_KEY|LLM_API_KEY|LANGSMITH_API_KEY)=\S+/m],
];

const SKIP = [/(^|\/)package-lock\.json$/, /\.(png|jpe?g|gif|ico|woff2?|ttf|pdf)$/i];

const findSecrets = (text: string): string[] => PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name);

// In this (public) source repository the whole repository is scanned. Lifted into a host monorepo, only this app's
// folder is: the host's own files are not ours to judge.
const repoRoot = (() => {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    return existsSync(join(top, 'lift', 'LIFT_MANIFEST.txt')) ? top : join(import.meta.dirname, '..', '..');
  } catch {
    return null; // not a git checkout (for example inside a container build)
  }
})();

describe('secret scan', () => {
  it('recognises the shapes it looks for', () => {
    const hex = (n: number) => 'a1'.repeat(n / 2);
    expect(findSecrets(`token = "dapi${hex(32)}"`)).toEqual(['Databricks token']);
    expect(findSecrets(`"spaceId": "${hex(32)}"`)).toEqual(['Genie space or workspace id (32 hex)']);
    expect(findSecrets(`ANTHROPIC_API_KEY=${'sk-'}ant-${'x'.repeat(30)}`)).toContain('secret value in an env file');
    expect(findSecrets(`host: adb-${'1'.repeat(12)}.4.azuredatabricks.net`)).toEqual(['Azure Databricks workspace host']);
    expect(findSecrets('DATABRICKS_TOKEN=\nhost: <workspace>.azuredatabricks.net\nspaceId: "REPLACE_ME"')).toEqual([]);
  });

  it.skipIf(!repoRoot)('finds nothing in tracked or new (not ignored) files', () => {
    const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: repoRoot!, encoding: 'utf8' }).split('\n').filter(Boolean);
    const hits = tracked
      .filter((f) => !SKIP.some((re) => re.test(f)))
      .flatMap((f) => {
        let text: string;
        try {
          text = readFileSync(join(repoRoot!, f), 'utf8');
        } catch {
          return []; // deleted in the working tree
        }
        return findSecrets(text).map((what) => `${f}: ${what}`);
      });
    expect(hits).toEqual([]);
  }, 60_000); // reads every file of the repository: slow when the machine is busy (a build running alongside)
});
