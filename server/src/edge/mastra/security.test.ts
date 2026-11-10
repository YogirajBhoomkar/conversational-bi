import { describe, expect, it, vi } from 'vitest';
import { closeMastraApi } from './security';
import type { RouteContext } from './http';

const ctx = (path: string) => ({ req: { path } }) as unknown as RouteContext;

describe("closing Mastra's own API", () => {
  it('answers 404 for Mastra routes under /api, without calling them', async () => {
    const next = vi.fn(async () => undefined);
    const close = closeMastraApi('/bi');
    for (const path of ['/api/agents', '/api/.well-known/bi_supervisor/agent-card.json', '/api/agents/bi_supervisor/generate', '/api/tools']) {
      const res = (await close(ctx(path), next)) as Response;
      expect(res.status).toBe(404);
    }
    expect(next).not.toHaveBeenCalled();
  });

  it('lets our own routes through when a host puts the prefix under /api, but nothing next to it', async () => {
    const next = vi.fn(async () => undefined);
    const close = closeMastraApi('/api/bi/');
    expect(await close(ctx('/api/bi/chat'), next)).toBeUndefined();
    expect(await close(ctx('/api/bi'), next)).toBeUndefined();
    expect(((await close(ctx('/api/bitter'), next)) as Response).status).toBe(404);
    expect(((await close(ctx('/api/agents'), next)) as Response).status).toBe(404);
    expect(next).toHaveBeenCalledTimes(2);
  });
});
