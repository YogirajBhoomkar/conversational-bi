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
  examples: z.array(z.string().trim().min(1).max(200)).max(5).optional(), // shown to users in the scope message
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
        if (s[field] === 'REPLACE_ME') return; // already reported as a placeholder
        if (seen.has(s[field])) ctx.addIssue({ code: 'custom', path: [i, field], message: `duplicate ${field}` });
        seen.add(s[field]);
      });
    }
    if (spaces.length && !spaces.some((s) => s.enabled)) ctx.addIssue({ code: 'custom', path: [], message: 'every space is disabled' });
  });

export type ConfigIO = { readFile(path: string): string; resolve(path: string): string };

export const EXAMPLE_SPACES_FILE = 'config/examples/spaces.example.json';

// A space's id can also come from the environment, for any key: BI_SPACE_ID_<KEY in capitals>. It wins over the file,
// so one spaces file serves every environment (dev, QC, UAT) and the ids come from that environment's settings.
export const SPACE_ID_PREFIX = 'BI_SPACE_ID_';
export const spaceIdVar = (key: string) => `${SPACE_ID_PREFIX}${key.toUpperCase()}`;

type Problem = { name: string; message: string };

export function loadSpaces(s: Settings, io: ConfigIO, spaceIds: Record<string, string> = {}): { spaces: GenieSpace[]; problems: Problem[]; warnings: string[] } {
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

  if (Array.isArray(raw)) {
    const entries = raw.filter((e): e is { key: string; spaceId?: string } => typeof e === 'object' && e !== null && typeof (e as { key?: unknown }).key === 'string');
    for (const [name, id] of Object.entries(spaceIds)) {
      const entry = entries.find((e) => spaceIdVar(e.key) === name);
      if (entry) entry.spaceId = id;
      else warnings.push(`${name} is set but no space has that key; it is ignored`);
    }
  }

  const parsed = SpacesConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const keyAt = (i: PropertyKey | undefined) => (Array.isArray(raw) && typeof i === 'number' ? (raw[i] as { key?: unknown } | undefined)?.key : undefined);
    return {
      spaces: [],
      problems: parsed.error.issues.map((i) => ({ name: `${source}${i.path.length ? `[${i.path.join('.')}]` : ''}`, message: hint(i.message, keyAt(i.path[0])) })),
      warnings,
    };
  }
  return { spaces: parsed.data, problems: [], warnings };
}

// A placeholder id means the space's id has not been given: name the variable that sets it.
const hint = (message: string, key: unknown) =>
  message.includes('REPLACE_ME') && typeof key === 'string' ? `${message}: set ${spaceIdVar(key)} (in server/.env when running locally)` : message;
