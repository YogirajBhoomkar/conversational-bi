// Writes server/contracts (JSON Schemas and the OpenAPI file) from the zod schemas. Run: npm run contracts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderContractFiles } from '../src/contractFiles';

const dir = join(import.meta.dirname, '..', 'contracts');
mkdirSync(dir, { recursive: true });
for (const [name, content] of Object.entries(renderContractFiles())) writeFileSync(join(dir, name), content);
console.log(`Wrote ${dir}`);
