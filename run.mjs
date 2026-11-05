// Convenience launcher: node run.mjs <setup|build|start|all>
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const server = join(root, 'server');
const ui = join(root, 'ui');

const run = (cmd, cwd, env = {}) => {
  console.log(`\n> ${cmd}  (${cwd})`);
  const r = spawnSync(cmd, { cwd, stdio: 'inherit', shell: true, env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const setup = () => {
  const envFile = join(server, '.env');
  if (!existsSync(envFile)) {
    copyFileSync(join(server, '.env.example'), envFile);
    console.log('Created server/.env from .env.example. Fill in the values before starting.');
  }
  run('npm install', server);
  run('npm install', ui);
};

const build = () => {
  run('npm run build', ui);
  run('npx mastra build', server);
};

const start = () => {
  if (!existsSync(join(server, '.env'))) {
    console.error('server/.env is missing. Run: node run.mjs setup');
    process.exit(1);
  }
  if (!existsSync(join(ui, 'dist', 'index.html')) || !existsSync(join(server, '.mastra', 'output'))) {
    console.error('Not built yet. Run: node run.mjs build');
    process.exit(1);
  }
  const port = process.env.PORT ?? '1976';
  console.log(`\nStarting on http://localhost:${port}`);
  const demo = join(root, 'demo-ui', 'serve.mjs'); // DEMO-UI (temporary): remove with the demo-ui folder
  if (existsSync(demo)) spawn(process.execPath, [demo], { stdio: 'inherit', env: { ...process.env, API_PORT: port } }); // DEMO-UI
  run('npx mastra start --env .env', server, { PORT: port, UI_DIST: join(ui, 'dist') });
};

const cmd = process.argv[2];
if (cmd === 'setup') setup();
else if (cmd === 'build') build();
else if (cmd === 'start') start();
else if (cmd === 'all') { setup(); build(); start(); }
else console.log('Usage: node run.mjs <setup|build|start|all>');
