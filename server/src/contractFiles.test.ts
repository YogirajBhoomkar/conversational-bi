import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChatEventSchema } from './contracts';
import { renderContractFiles } from './contractFiles';

const dir = join(import.meta.dirname, '..', 'contracts');

describe('published contract', () => {
  it('is in sync with the zod schemas (run "npm run contracts" to update it)', () => {
    const files = renderContractFiles();
    expect(readdirSync(dir).sort()).toEqual(Object.keys(files).sort());
    for (const [name, content] of Object.entries(files)) expect(readFileSync(join(dir, name), 'utf8').replace(/\r\n/g, '\n')).toBe(content);
  });

  it('describes every event the stream can send', () => {
    const schema = JSON.parse(renderContractFiles()['chat-event.schema.json']);
    const types = schema.oneOf.map((o: { properties: { type: { const: string } } }) => o.properties.type.const).sort();
    expect(types).toEqual(ChatEventSchema.options.map((o) => o.shape.type.value).sort());
  });
});
