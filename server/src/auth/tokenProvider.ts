import type { TokenProvider } from '../contracts';

// Dev: one shared PAT. Swap for an OIDC token-exchange provider (per-user, with refresh) without touching callers.
export class PatTokenProvider implements TokenProvider {
  constructor(private readonly token: string | undefined) {}
  async getToken(): Promise<string> {
    if (!this.token) throw new Error('DATABRICKS_TOKEN is not set');
    return this.token;
  }
}
