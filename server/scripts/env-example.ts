// npm run env:example: rewrites server/.env.example from the settings schema.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderEnvExample } from '../src/config/envExample';

const target = fileURLToPath(new URL('../.env.example', import.meta.url));
writeFileSync(target, renderEnvExample());
process.stdout.write(`Wrote ${target}\n`);
