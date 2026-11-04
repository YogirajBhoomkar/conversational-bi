// Renders server/.env.example from the settings schema, so the template can never drift from what the server reads.
// Written by `npm run env:example`; envExample.test.ts fails when the committed file is out of date.
import { z } from 'zod';
import { type SettingName, SettingsSchema, settingMeta } from './schema';

const HEADER = `# Generated from server/src/config/schema.ts by "npm run env:example". Do not edit by hand.
# Copy this file to server/.env for local development and fill in the values. Never commit server/.env.
#
# REQUIRED settings are listed without a "#". Fill every one of them.
# OPTIONAL settings start with "#". Leave them commented out to use the default.
# An empty value (NAME=) counts as not set, so the default applies.
# The full list for a deployment, with who provides each value, is in docs/lift/GC-CONFIG.md.`;

const defaultOf = (name: SettingName): string | undefined => {
  const r = SettingsSchema.shape[name].safeParse(undefined);
  return r.success && r.data !== undefined ? String(r.data) : undefined;
};

const optionsOf = (name: SettingName): readonly string[] | undefined => {
  let s: z.ZodType = SettingsSchema.shape[name];
  while (s instanceof z.ZodDefault || s instanceof z.ZodOptional) s = s.unwrap() as z.ZodType;
  return s instanceof z.ZodEnum ? (s.options as string[]) : undefined;
};

export function renderEnvExample(): string {
  const out = [HEADER];
  let group = '';
  for (const name of Object.keys(SettingsSchema.shape) as SettingName[]) {
    const meta = settingMeta(name);
    if (meta.group !== group) {
      group = meta.group;
      out.push('', `# ---------------------------------------------------------------- ${group}`);
    }
    const options = optionsOf(name);
    const notes = [meta.secret ? 'SECRET.' : '', options ? `One of: ${options.join(', ')}.` : ''].filter(Boolean).join(' ');
    out.push(`# ${SettingsSchema.shape[name].description}${notes ? ` ${notes}` : ''}`);
    out.push(meta.required ? `${name}=` : `# ${name}=${defaultOf(name) ?? meta.example ?? ''}`);
  }
  return `${out.join('\n')}\n`;
}
