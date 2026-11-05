// lift/deps.manifest.json tells GC what this app needs. It must list exactly the dependencies of package.json.
// Only in the source repository: once lifted, the manifest sits next to package.json and is no longer kept in sync.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const server = join(import.meta.dirname, '..', '..');
const manifestFile = join(server, '..', 'lift', 'deps.manifest.json');
const versions = (deps: Record<string, { version: string } | string>) =>
  Object.fromEntries(Object.entries(deps).map(([name, d]) => [name, typeof d === 'string' ? d : d.version]));

describe.skipIf(!existsSync(manifestFile))('lift/deps.manifest.json', () => {
  it('lists exactly the dependencies of package.json, with the same versions', () => {
    const pkg = JSON.parse(readFileSync(join(server, 'package.json'), 'utf8'));
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    expect(versions(manifest.dependencies)).toEqual(pkg.dependencies);
    expect(versions(manifest.devDependencies)).toEqual(pkg.devDependencies);
    expect(manifest.node).toBe(pkg.engines.node);
  });
});
