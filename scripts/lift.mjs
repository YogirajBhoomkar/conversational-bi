#!/usr/bin/env node
// Copies Conversational BI into GC's monorepo, as listed in lift/LIFT_MANIFEST.txt.
//
//   node scripts/lift.mjs --target <path to gc-bridge-v2> [--app apps/conversational-bi] [--apply]
//
// Without --apply it only prints what it would copy (a dry run). It refuses to run when the target repository has
// uncommitted changes, or when any file it would write already exists, so nothing of GC's is ever overwritten.
// It never commits or pushes; review the result with git in the target repository.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = /(^|[/\\])(node_modules|\.mastra|\.git)([/\\]|$)|\.db(-shm|-wal)?$|(^|[/\\])\.env(?!\.example)(\.[^/\\]*)?$/;

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const target = option('--target');
const app = option('--app', 'apps/conversational-bi');
const apply = args.includes('--apply');
const fail = (message) => {
  console.error(`lift: ${message}`);
  process.exit(1);
};

if (!target) fail('usage: node scripts/lift.mjs --target <path to the GC repository> [--app apps/conversational-bi] [--apply]');
if (!existsSync(join(target, '.git'))) fail(`${target} is not the root of a git repository`);
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: target, encoding: 'utf8' }).trim();
if (dirty) fail(`${target} has uncommitted changes; commit or stash them first, so the lift can be reviewed on its own`);

// Every file to copy, from the manifest.
const files = [];
const walk = (from, to) => {
  if (SKIP.test(from)) return;
  if (statSync(from).isDirectory()) for (const name of readdirSync(from)) walk(join(from, name), join(to, name));
  else files.push({ from, to });
};
for (const line of readFileSync(join(root, 'lift', 'LIFT_MANIFEST.txt'), 'utf8').split(/\r?\n/)) {
  const entry = line.trim();
  if (!entry || entry.startsWith('#')) continue;
  const [from, to] = entry.split('->').map((s) => s.trim());
  if (!from || !to) fail(`bad manifest line: ${entry}`);
  const source = join(root, from);
  if (!existsSync(source)) fail(`${from} (in the manifest) does not exist`);
  walk(source, join(target, to.replace('<app>', app)));
}

const collisions = files.filter((f) => existsSync(f.to));
if (collisions.length) fail(`these files already exist in the target; nothing was copied:\n${collisions.map((f) => `  ${relative(target, f.to)}`).join('\n')}`);

for (const f of files) console.log(`${apply ? 'copy' : 'would copy'}  ${relative(root, f.from)}  ->  ${relative(target, f.to)}`);
if (!apply) {
  console.log(`\n${files.length} files. Dry run: nothing was copied. Run again with --apply to copy.`);
  process.exit(0);
}
for (const f of files) {
  mkdirSync(dirname(f.to), { recursive: true });
  copyFileSync(f.from, f.to);
}
console.log(`\nCopied ${files.length} files into ${join(target, app)}. Next steps: LIFT_AND_SHIFT.md.`);
