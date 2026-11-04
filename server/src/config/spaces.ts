// The Genie spaces the supervisor can route to. They come from configuration only (a JSON file or inline JSON), never
// from code, so adding the fifth space is a config change. The key is used in agent and tool names (genie_<key>, ask-<key>).
import { z } from 'zod';
import type { GenieSpace } from '../contracts';
import type { Settings } from './schema';

export const SpaceConfigSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]+$/, 'lowercase letters, digits and _ only').max(40),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(20, 'too short to route by: say what data the space covers').max(2000),
  routing: z.string().trim().min(1).max(1000).optional(),
  spaceId: z.string().trim().min(1).refine((id) => id !== 'REPLACE_ME', 'still the placeholder REPLACE_ME'),
  enabled: z.boolean().default(true),
});

export const SpacesConfigSchema = z
  .array(SpaceConfigSchema)
  .min(1, 'at least one space is needed')
  .superRefine((spaces, ctx) => {
    for (const field of ['key', 'spaceId'] as const) {
      const seen = new Set<string>();
      spaces.forEach((s, i) => {
        if (seen.has(s[field])) ctx.addIssue({ code: 'custom', path: [i, field], message: `duplicate ${field}` });
        seen.add(s[field]);
      });
    }
    if (spaces.length && !spaces.some((s) => s.enabled)) ctx.addIssue({ code: 'custom', path: [], message: 'every space is disabled' });
  });

export type ConfigIO = { readFile(path: string): string; resolve(path: string): string };

export const EXAMPLE_SPACES_FILE = 'config/examples/spaces.example.json';

// Older .env files name these two spaces' ids directly. Honoured in local mode only, never with a built-in id.
const LEGACY_SPACE_IDS = { placement: 'DATABRICKS_GENIE_SPACE_ID', capacity: 'DATABRICKS_GENIE_CAPACITY_SPACE_ID' } as const;

type Problem = { name: string; message: string };

export function loadSpaces(s: Settings, io: ConfigIO): { spaces: GenieSpace[]; problems: Problem[]; warnings: string[] } {
  const source = s.BI_SPACES_JSON ? 'BI_SPACES_JSON' : 'BI_SPACES_FILE';
  const warnings: string[] = [];
  let raw: unknown;
  try {
    if (s.BI_SPACES_JSON) raw = JSON.parse(s.BI_SPACES_JSON);
    else {
      const file = s.BI_SPACES_FILE ?? (s.BI_MODE === 'local' ? EXAMPLE_SPACES_FILE : undefined);
      if (!file) return { spaces: [], problems: [], warnings }; // reported by crossCheck
      raw = JSON.parse(io.readFile(io.resolve(file)));
    }
  } catch (e) {
    const why = e instanceof SyntaxError ? 'is not valid JSON' : 'could not be read';
    return { spaces: [], problems: [{ name: source, message: why }], warnings };
  }

  if (s.BI_MODE === 'local' && Array.isArray(raw)) {
    for (const [key, name] of Object.entries(LEGACY_SPACE_IDS)) {
      const id = s[name];
      if (!id) continue;
      const entry = raw.find((e): e is { key: string; spaceId?: string } => typeof e === 'object' && e !== null && (e as { key?: unknown }).key === key);
      if (entry) entry.spaceId = id;
      else warnings.push(`${name} is set but there is no space with key "${key}"; it is ignored`);
    }
  }

  const parsed = SpacesConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return { spaces: [], problems: parsed.error.issues.map((i) => ({ name: `${source}${i.path.length ? `[${i.path.join('.')}]` : ''}`, message: hint(s, i.message) })), warnings };
  }
  return { spaces: parsed.data, problems: [], warnings };
}

// In local mode a placeholder id usually means the space id is missing from .env.
const hint = (s: Settings, message: string) =>
  s.BI_MODE === 'local' && message.includes('REPLACE_ME') ? `${message}: set it in the spaces file, or set ${Object.values(LEGACY_SPACE_IDS).join(' / ')}` : message;
