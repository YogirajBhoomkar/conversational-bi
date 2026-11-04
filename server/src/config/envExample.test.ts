import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderEnvExample } from './envExample';
import { SettingsSchema } from './schema';

describe('.env.example', () => {
  it('is in sync with the settings schema (run "npm run env:example" to update it)', () => {
    const committed = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    expect(committed).toBe(renderEnvExample());
  });

  it('lists every setting, each with help text', () => {
    const text = renderEnvExample();
    for (const [name, schema] of Object.entries(SettingsSchema.shape)) {
      expect(text).toMatch(new RegExp(`^(# )?${name}=`, 'm'));
      expect(schema.description).toBeTruthy();
    }
  });
});
