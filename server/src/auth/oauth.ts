import { createHash, randomBytes } from 'node:crypto';

// Databricks OAuth (authorization code + PKCE, public client). Mirrors the External_UI_OAuth reference app.
export const oauthConfig = () => {
  const port = process.env.PORT ?? '4111';
  return {
    host: `https://${(process.env.DATABRICKS_SERVER_HOSTNAME ?? '').replace(/^https?:\/\//, '')}`,
    clientId: process.env.DATABRICKS_CLIENT_ID ?? '',
    redirectUri: process.env.DATABRICKS_REDIRECT_URI ?? `http://localhost:${port}/auth/callback`,
    scopes: 'all-apis offline_access',
  };
};
export const oauthEnabled = () => Boolean(process.env.DATABRICKS_CLIENT_ID);

export type Tokens = { accessToken: string; refreshToken?: string; expiresAt: number };

// A redirect to Databricks and back is a new request, so the PKCE verifier lives server-side, keyed by `state`.
const pending = new Map<string, { verifier: string; at: number }>();
const PENDING_TTL_MS = 10 * 60 * 1000;

const b64url = (b: Buffer) => b.toString('base64url');
export const challengeOf = (verifier: string) => b64url(createHash('sha256').update(verifier, 'ascii').digest());

export function buildLoginUrl(): string {
  const cfg = oauthConfig();
  for (const [s, p] of pending) if (Date.now() - p.at > PENDING_TTL_MS) pending.delete(s);
  const state = b64url(randomBytes(32));
  const verifier = b64url(randomBytes(64));
  pending.set(state, { verifier, at: Date.now() });
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: cfg.redirectUri,
    scope: cfg.scopes,
    state,
    code_challenge: challengeOf(verifier),
    code_challenge_method: 'S256',
  });
  return `${cfg.host}/oidc/v1/authorize?${params}`;
}

async function tokenRequest(body: Record<string, string>, fetchFn: typeof fetch): Promise<Tokens> {
  const cfg = oauthConfig();
  const res = await fetchFn(`${cfg.host}/oidc/v1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, ...body }),
  });
  if (!res.ok) throw new Error(`Token request failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
  const t = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000 };
}

export async function exchangeCode(code: string, state: string, fetchFn: typeof fetch = fetch): Promise<Tokens> {
  const entry = pending.get(state);
  pending.delete(state); // single use
  if (!entry || Date.now() - entry.at > PENDING_TTL_MS) throw new Error('Login session not recognised or already used. Please log in again.');
  return tokenRequest(
    { grant_type: 'authorization_code', redirect_uri: oauthConfig().redirectUri, code, code_verifier: entry.verifier },
    fetchFn,
  );
}

export const refreshTokens = (refreshToken: string, fetchFn: typeof fetch = fetch) =>
  tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken }, fetchFn);

export async function fetchUserName(accessToken: string, fetchFn: typeof fetch = fetch): Promise<string> {
  try {
    const res = await fetchFn(`${oauthConfig().host}/api/2.0/preview/scim/v2/Me`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) return ((await res.json()) as { userName?: string }).userName ?? 'user';
  } catch { /* display name is optional */ }
  return 'user';
}
