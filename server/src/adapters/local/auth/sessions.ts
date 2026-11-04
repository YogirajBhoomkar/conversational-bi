import { randomBytes } from 'node:crypto';
import { AuthError } from '../../../core/errors';
import type { TokenProvider } from '../../../ports/auth';
import type { Tokens } from './oauth';


export type Session = Tokens & { user: string };
const sessions = new Map<string, Session>();
const refreshing = new Map<string, Promise<void>>();

export const COOKIE = 'bi_sid';

export const createSession = (tokens: Tokens, user: string): string => {
  const id = randomBytes(32).toString('base64url');
  sessions.set(id, { ...tokens, user });
  return id;
};
export const getSession = (id: string | undefined) => (id ? sessions.get(id) : undefined);
export const destroySession = (id: string | undefined) => void (id && sessions.delete(id));

export const readSessionId = (cookieHeader: string | undefined): string | undefined =>
  cookieHeader?.split(';').map((p) => p.trim().split('=')).find(([k]) => k === COOKIE)?.[1];

export const cookie = (value: string, maxAgeSec: number, secure: boolean) =>
  `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;

// Per-user token for Genie calls. Refreshes shortly before expiry; a dead session raises AuthError.
export class SessionTokenProvider implements TokenProvider {
  constructor(private readonly refresh: (refreshToken: string) => Promise<Tokens>) {}

  async getToken({ sessionId }: { sessionId?: string } = {}): Promise<string> {
    const s = getSession(sessionId);
    if (!sessionId || !s) throw new AuthError('Not logged in');
    if (s.expiresAt - Date.now() < 60_000) {
      if (!s.refreshToken) {
        destroySession(sessionId);
        throw new AuthError('Your session has expired. Please log in again.');
      }
      // Several in-flight Genie calls may notice expiry together; refresh once.
      let p = refreshing.get(sessionId);
      if (!p) {
        p = this.refresh(s.refreshToken)
          .then((t) => void Object.assign(s, t, { refreshToken: t.refreshToken ?? s.refreshToken }))
          .catch(() => {
            destroySession(sessionId);
            throw new AuthError('Your session has expired. Please log in again.');
          })
          .finally(() => void refreshing.delete(sessionId));
        refreshing.set(sessionId, p);
      }
      await p;
    }
    return s.accessToken;
  }
}
