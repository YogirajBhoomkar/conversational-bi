#!/usr/bin/env node
// Checks the server against a set of Mastra versions, in a throw-away copy: the repository's own node_modules, build
// output and .env files are never touched or read. Usage, from server/:
//   node scripts/compat-check.mjs --profile mastra-1.32           (a file in server/compat/, or a path)
//   node scripts/compat-check.mjs --profile current --node 20     (also boots the build on Node 20, informational)
//   add --keep to leave the temp copy for inspection.
// Steps: copy, apply the profile's versions, npm install, typecheck, tests, mastra build, boot the build with dummy
// settings, GET /health/live, GET <prefix>/version, POST <prefix>/chat (the first event must be the model trace; the
// model call fails with the dummy endpoint and must come back as a friendly `error` event), then SIGTERM must end the
// process within the grace period + 2 s. Prints PASS / FAIL / SKIP per step; exits 1 when a step failed.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PREFIX = '/bi';
const GRACE_MS = 3000;
const SKIP_IN_COPY = new Set(['node_modules', '.mastra', 'coverage']);
const isSecretOrState = (name) => name.startsWith('.env') && name !== '.env.example' || /\.db(-shm|-wal)?$/.test(name);

// ------------------------------------------------------------------ arguments
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const profileArg = option('profile');
if (!profileArg) {
  console.error('usage: node scripts/compat-check.mjs --profile <name|path> [--node 20] [--keep]');
  process.exit(2);
}
const profilePath = existsSync(profileArg) ? resolve(profileArg) : join(SERVER, 'compat', `${profileArg.replace(/\.json$/, '')}.json`);
const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
const nodeMajor = option('node');
const keep = args.includes('--keep');

// ------------------------------------------------------------------ helpers
const results = [];
const record = (step, outcome, note = '') => {
  results.push({ step, outcome, note });
  console.log(`${outcome.padEnd(4)} ${step}${note ? `: ${note}` : ''}`);
};
const tail = (text, lines = 25) => String(text ?? '').trim().split('\n').slice(-lines).join('\n');

function sh(command, cwd, env = {}) {
  const r = spawnSync(command, { cwd, shell: true, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
}

// Runs a step; a failing step is recorded with the end of its output, and the remaining steps that depend on it skip.
function step(name, fn) {
  try {
    const note = fn();
    record(name, 'PASS', note);
    return true;
  } catch (e) {
    record(name, 'FAIL', e instanceof Error ? e.message : String(e));
    return false;
  }
}
async function stepAsync(name, fn) {
  try {
    const note = await fn();
    record(name, note === 'SKIP' ? 'SKIP' : 'PASS', note === 'SKIP' ? '' : note);
    return true;
  } catch (e) {
    record(name, 'FAIL', e instanceof Error ? e.message : String(e));
    return false;
  }
}
const must = (r, what) => {
  if (!r.ok) throw new Error(`${what} failed\n${tail(r.out)}`);
  return r;
};

const freePort = () =>
  new Promise((resolvePort, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolvePort(port));
    });
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url, ms) {
  const until = Date.now() + ms;
  for (;;) {
    try {
      const res = await fetch(url);
      return res;
    } catch {
      if (Date.now() > until) throw new Error(`no answer from ${url} within ${ms} ms`);
      await sleep(500);
    }
  }
}

// ------------------------------------------------------------------ the copy and its versions
const root = mkdtempSync(join(tmpdir(), `bi-compat-${profile.name}-`));
const work = join(root, 'server');
console.log(`Profile ${profile.name} (${basename(profilePath)}); working in ${work}\n`);

const copied = step('copy server/ without node_modules, build output, .env files and local databases', () => {
  cpSync(SERVER, work, {
    recursive: true,
    filter: (src) => {
      const name = basename(src);
      return !(statSync(src).isDirectory() ? SKIP_IN_COPY.has(name) : isSecretOrState(name));
    },
  });
});

const applied = copied && step('apply the profile versions', () => {
  const pkgPath = join(work, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  for (const section of ['dependencies', 'devDependencies']) {
    for (const [name, version] of Object.entries(profile[section] ?? {})) {
      delete pkg.dependencies?.[name];
      delete pkg.devDependencies?.[name];
      (pkg[section] ??= {})[name] = version;
    }
  }
  for (const name of profile.remove ?? []) {
    delete pkg.dependencies?.[name];
    delete pkg.devDependencies?.[name];
  }
  if (profile.overrides) pkg.overrides = { ...pkg.overrides, ...profile.overrides };
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  if (!profile.useLockfile) rmSync(join(work, 'package-lock.json'), { force: true });
  return profile.useLockfile ? 'the lockfile decides' : 'lockfile removed, versions pinned';
});

const installed = applied && step('npm install', () => {
  must(sh(profile.useLockfile ? 'npm ci --no-audit --no-fund' : 'npm install --no-audit --no-fund', work), 'npm install');
  const core = JSON.parse(readFileSync(join(work, 'node_modules', '@mastra', 'core', 'package.json'), 'utf8')).version;
  const cli = JSON.parse(readFileSync(join(work, 'node_modules', 'mastra', 'package.json'), 'utf8')).version;
  return `@mastra/core ${core}, mastra CLI ${cli}`;
});

const typed = installed && step('typecheck (tsc --noEmit)', () => void must(sh('npx tsc --noEmit', work), 'tsc'));
const tested = installed && step('tests (vitest run)', () => {
  const r = must(sh('npx vitest run', work), 'vitest');
  return (r.out.match(/Tests\s+[^\n]*passed[^\n]*/) ?? [''])[0].replace(/\x1b\[[0-9;]*m/g, '').trim();
});
const built = installed && step('mastra build', () => void must(sh('npx mastra build', work, { MASTRA_TELEMETRY_DISABLED: '1' }), 'mastra build'));

// ------------------------------------------------------------------ boot checks, on this Node or on Node <major>
function nodeBinary(major) {
  const dir = join(root, `node${major}`);
  must(sh(`npm install --no-save --no-audit --no-fund --prefix "${dir}" node@${major}`, root), `install node@${major}`);
  const bin = join(dir, 'node_modules', 'node', 'bin');
  const found = readdirSync(bin).find((f) => f === 'node' || f === 'node.exe');
  if (!found) throw new Error(`no node binary in ${bin}`);
  return join(bin, found);
}

async function bootChecks(label, nodeBin) {
  const port = await freePort();
  const out = join(work, '.mastra', 'output');
  const env = {
    ...process.env,
    PORT: String(port),
    MASTRA_PROJECT_ROOT: work,
    MASTRA_TELEMETRY_DISABLED: '1',
    BI_MODE: 'local',
    DATABRICKS_SERVER_HOSTNAME: 'example.invalid',
    DATABRICKS_TOKEN: 'dummy-token',
    DATABRICKS_CLIENT_ID: '',
    BI_SPACES_JSON: JSON.stringify([{ key: 'placement', name: 'Placement', description: 'Dummy space for the compatibility check.', spaceId: 'dummy-space' }]),
    LLM_BASE_URL: 'http://127.0.0.1:9/v1', // nothing listens here: the model call fails fast, as intended
    LLM_API_KEY: 'dummy-key',
    LLM_MODEL: 'dummy-model',
    ANTHROPIC_API_KEY: '',
    BI_SHUTDOWN_GRACE_MS: String(GRACE_MS),
    BI_LOG_FORMAT: 'json',
  };
  const child = spawn(nodeBin, ['index.mjs'], { cwd: out, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const exited = new Promise((r) => child.once('exit', (code, signal) => r({ code, signal, at: Date.now() })));
  const base = `http://127.0.0.1:${port}`;
  const p = (s) => `${label}: ${s}`;
  try {
    const booted = await stepAsync(p('boot the build with dummy settings'), async () => {
      await Promise.race([waitFor(`${base}/health/live`, 60_000), exited.then(() => { throw new Error(`the process exited\n${tail(log)}`); })]);
    });
    if (!booted) return;
    await stepAsync(p('GET /health/live is 200'), async () => {
      const res = await fetch(`${base}/health/live`);
      if (res.status !== 200) throw new Error(`status ${res.status}`);
    });
    await stepAsync(p(`GET ${PREFIX}/version is 200`), async () => {
      const res = await fetch(`${base}${PREFIX}/version`);
      if (res.status !== 200) throw new Error(`status ${res.status}`);
      return JSON.stringify(await res.json());
    });
    // Mastra's own API (agent instructions, agent cards, routes that run an agent) must not answer: it bypasses our
    // sign-in, limits and guards (edge/mastra/security.ts, closeMastraApi).
    await stepAsync(p("Mastra's built-in /api routes answer 404 (no agent list, no agent card, no direct agent run)"), async () => {
      const probes = [['GET', '/api/agents'], ['GET', '/api/.well-known/bi_supervisor/agent-card.json'], ['GET', '/api/tools'], ['GET', '/api/workflows'], ['POST', '/api/agents/bi_supervisor/generate']];
      const open = [];
      for (const [method, path] of probes) {
        const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) });
        if (res.status !== 404) open.push(`${method} ${path}: ${res.status}`);
      }
      if (open.length) throw new Error(`still open: ${open.join('; ')}`);
      return `${probes.length} routes closed`;
    });
    await stepAsync(p(`POST ${PREFIX}/chat streams the model trace first, and a friendly error for the failing model`), async () => {
      const res = await fetch(`${base}${PREFIX}/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threadId: 'compat', message: 'compatibility check' }), signal: AbortSignal.timeout(120_000) });
      if (res.status !== 200 || !res.headers.get('content-type')?.includes('text/event-stream')) throw new Error(`status ${res.status}, ${res.headers.get('content-type')}`);
      const events = (await res.text()).split('\n\n').map((b) => b.split('\n').find((l) => l.startsWith('data:'))).filter(Boolean).map((l) => JSON.parse(l.slice(5)));
      const first = events[0];
      if (first?.type !== 'trace' || first.item?.id !== 'model') throw new Error(`first event ${JSON.stringify(first)}`);
      const last = events.at(-1);
      // The dummy model endpoint cannot be reached, so the error is `unavailable` (contract 1.3.0); `failed` on a setup
      // where the address resolves but refuses differently. Either way: our words and a reference, never a stack trace.
      if (last?.type !== 'error' || !['unavailable', 'failed'].includes(last.kind) || !last.reference || /\bat .*\(|Error:/.test(last.message)) throw new Error(`last event ${JSON.stringify(last)}`);
      return `${events.length} events, ends with: ${last.message}`;
    });
    await stepAsync(p(`SIGTERM ends the process within ${GRACE_MS + 2000} ms`), async () => {
      if (process.platform === 'win32') return 'SKIP'; // Windows cannot deliver SIGTERM to a handler: kill() terminates at once
      const sent = Date.now();
      child.kill('SIGTERM');
      const { code, signal, at } = await Promise.race([exited, sleep(GRACE_MS + 2000).then(() => ({ code: null, signal: 'timeout', at: Date.now() }))]);
      if (signal === 'timeout') throw new Error('still running');
      return `exit code ${code ?? signal} after ${at - sent} ms`;
    });
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await Promise.race([exited, sleep(5000)]); // let Windows release the build's files before the copy is removed
    }
  }
}

if (built) {
  await bootChecks(`Node ${process.versions.node}`, process.execPath);
  if (nodeMajor) {
    let bin;
    const got = step(`install node@${nodeMajor} into the temp folder`, () => {
      bin = nodeBinary(nodeMajor);
      return sh(`"${bin}" --version`, root).out.trim();
    });
    if (got) await bootChecks(`Node ${nodeMajor} (informational: Mastra's engines field requires 22.13+)`, bin);
  }
}
void typed;
void tested;

// ------------------------------------------------------------------ summary
const failed = results.filter((r) => r.outcome === 'FAIL');
const informational = (r) => r.step.includes('informational') || r.step.startsWith(`install node@`);
const blocking = failed.filter((r) => !informational(r));
console.log(`\nSummary for ${profile.name}: ${results.filter((r) => r.outcome === 'PASS').length} passed, ${failed.length} failed, ${results.filter((r) => r.outcome === 'SKIP').length} skipped`);
if (keep) console.log(`Kept ${root}`);
else {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 });
  } catch (e) {
    console.log(`Could not remove ${root} (${e.code ?? e}); delete it by hand.`);
  }
}
process.exit(blocking.length ? 1 : 0);
