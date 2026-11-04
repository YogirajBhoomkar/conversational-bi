import type { GenieSpace } from '../contracts';

// The spaces the agents can use, built from configuration (config/spaces.ts). Disabled spaces are left out entirely.
export type SpaceRegistry = {
  spaces: GenieSpace[];
  byKey(key: string): GenieSpace | undefined;
  byId(spaceId: string): GenieSpace | undefined;
};

export function createSpaceRegistry(all: GenieSpace[]): SpaceRegistry {
  const spaces = all.filter((s) => s.enabled !== false);
  return {
    spaces,
    byKey: (key) => spaces.find((s) => s.key === key),
    byId: (spaceId) => spaces.find((s) => s.spaceId === spaceId),
  };
}
