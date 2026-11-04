import { createHash, randomBytes } from 'node:crypto';

// Databricks OAuth (authorization code + PKCE, public client). Mirrors the External_UI_OAuth reference app. Local mode only.
export type OAuthSettings = { host: string; clientId: string; redirectUri: string };
const SCOPES = 'all-apis offline_access';
const origin = (cfg: OAuthSettings) => `https://${cfg.host}`;

export type Tokens = { accessToken: string; refreshToken?: string; expiresAt: number };

// A redirect to Databricks and back is a new request, so the PKCE verifier lives server-side, keyed by `state`.
const pending = new Map<string, { verifier: string; at: number }>();
const PENDING_TTL_MS = 10 * 60 * 1000;

const b64url = (b: Buffer) => b.toString('base64url');
export const challengeOf = (verifier: string) => b64url(createHash('sha256').update(verifier, 'ascii').digest());

export function buildLoginUrl(cfg: OAuthSettings): string {
  for (const [s, p] of pending) if (Date.now() - p.at > PENDING_TTL_MS) pending.delete(s);
  const state = b64url(randomBytes(32));
  const verifier = b64url(randomBytes(64));
  pending.set(state, { verifier, at: Date.now() });
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: cfg.redirectUri,
    scope: SCOPES,
    state,
    code_challenge: challengeOf(verifier),
    code_challenge_method: 'S256',
  });
  return `${origin(cfg)}/oidc/v1/authorize?${params}`;
}

async function tokenRequest(cfg: OAuthSettings, body: Record<string, string>, fetchFn: typeof fetch): Promise<Tokens> {
  const res = await fetchFn(`${origin(cfg)}/oidc/v1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, ...body }),
  });
  if (!res.ok) throw new Error(`Token request failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
  const t = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000 };
}

export async function exchangeCode(cfg: OAuthSettings, code: string, state: string, fetchFn: typeof fetch = fetch): Promise<Tokens> {
  const entry = pending.get(state);
  pending.delete(state); // single use
  if (!entry || Date.now() - entry.at > PENDING_TTL_MS) throw new Error('Login session not recognised or already used. Please log in again.');
  return tokenRequest(
    cfg,
    { grant_type: 'authorization_code', redirect_uri: cfg.redirectUri, code, code_verifier: entry.verifier },
    fetchFn,
  );
}

export const refreshTokens = (cfg: OAuthSettings, refreshToken: string, fetchFn: typeof fetch = fetch) =>
  tokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: refreshToken }, fetchFn);

export async function fetchUserName(cfg: OAuthSettings, accessToken: string, fetchFn: typeof fetch = fetch): Promise<string> {
  try {
    const res = await fetchFn(`${origin(cfg)}/api/2.0/preview/scim/v2/Me`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) return ((await res.json()) as { userName?: string }).userName ?? 'user';
  } catch { /* display name is optional */ }
  return 'user';
}
