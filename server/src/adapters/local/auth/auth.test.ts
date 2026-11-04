import { describe, expect, it, vi } from 'vitest';
import { buildLoginUrl, challengeOf, exchangeCode } from './oauth';
import { AuthError } from '../../../core/errors';
import { SessionTokenProvider, createSession, getSession, readSessionId } from './sessions';

const cfg = { host: 'adb-1.azuredatabricks.net', clientId: 'client-123', redirectUri: 'http://localhost:1976/auth/callback' };

const tokenResponse = (body: object, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('PKCE login', () => {
  it('computes the S256 challenge per RFC 7636 appendix B', () => {
    expect(challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('builds an authorize URL with state, challenge and scopes', () => {
    const u = new URL(buildLoginUrl(cfg));
    expect(u.origin + u.pathname).toBe('https://adb-1.azuredatabricks.net/oidc/v1/authorize');
    expect(u.searchParams.get('client_id')).toBe('client-123');
    expect(u.searchParams.get('redirect_uri')).toBe('http://localhost:1976/auth/callback');
    expect(u.searchParams.get('scope')).toBe('all-apis offline_access');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('state')!.length).toBeGreaterThan(20);
  });

  it('exchanges the code with the stored verifier, and state is single-use', async () => {
    const u = new URL(buildLoginUrl(cfg));
    const state = u.searchParams.get('state')!;
    const fetchFn = tokenResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 });
    const t = await exchangeCode(cfg, 'the-code', state, fetchFn);
    expect(t.accessToken).toBe('at');
    expect(t.refreshToken).toBe('rt');
    const sent = new URLSearchParams(((fetchFn as any).mock.calls[0][1] as RequestInit).body as string);
    expect(sent.get('grant_type')).toBe('authorization_code');
    expect(sent.get('code')).toBe('the-code');
    expect(challengeOf(sent.get('code_verifier')!)).toBe(u.searchParams.get('code_challenge'));
    await expect(exchangeCode(cfg, 'the-code', state, fetchFn)).rejects.toThrow(/not recognised/);
  });

  it('rejects an unknown state and surfaces token endpoint failures', async () => {
    await expect(exchangeCode(cfg, 'c', 'nope', tokenResponse({}))).rejects.toThrow(/not recognised/);
    const state = new URL(buildLoginUrl(cfg)).searchParams.get('state')!;
    await expect(exchangeCode(cfg, 'c', state, tokenResponse({ error: 'bad' }, 400))).rejects.toThrow(/HTTP 400/);
  });
});

describe('sessions', () => {
  it('parses the session cookie', () => {
    expect(readSessionId('a=1; bi_sid=abc; b=2')).toBe('abc');
    expect(readSessionId(undefined)).toBeUndefined();
  });

  it('returns a valid access token without refreshing', async () => {
    const id = createSession({ accessToken: 'at', expiresAt: Date.now() + 3_600_000 }, 'u@x.com');
    const refresh = vi.fn();
    expect(await new SessionTokenProvider(refresh as never).getToken({ sessionId: id })).toBe('at');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes once for concurrent callers near expiry', async () => {
    const id = createSession({ accessToken: 'old', refreshToken: 'rt', expiresAt: Date.now() + 10_000 }, 'u');
    const refresh = vi.fn(async () => ({ accessToken: 'new', expiresAt: Date.now() + 3_600_000 }));
    const p = new SessionTokenProvider(refresh as never);
    const [a, b] = await Promise.all([p.getToken({ sessionId: id }), p.getToken({ sessionId: id })]);
    expect([a, b]).toEqual(['new', 'new']);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(getSession(id)!.refreshToken).toBe('rt'); // kept when the response has none
  });

  it('ends the session when it cannot be refreshed, and rejects unknown sessions', async () => {
    const id = createSession({ accessToken: 'old', refreshToken: 'rt', expiresAt: Date.now() - 1 }, 'u');
    const p = new SessionTokenProvider((async () => { throw new Error('revoked'); }) as never);
    await expect(p.getToken({ sessionId: id })).rejects.toBeInstanceOf(AuthError);
    expect(getSession(id)).toBeUndefined();
    await expect(p.getToken({ sessionId: 'missing' })).rejects.toBeInstanceOf(AuthError);
    await expect(p.getToken()).rejects.toBeInstanceOf(AuthError);
  });
});
