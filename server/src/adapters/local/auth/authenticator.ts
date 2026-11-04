// Local mode: with no OAuth client configured everyone is the shared "dev" user; otherwise a valid, refreshable
// Databricks login session (cookie) is required.
import { AuthError } from '../../../core/errors';
import type { Authenticator, AuthResult, TokenProvider } from '../../../ports/auth';
import type { IncomingRequestLike } from '../../../ports/context';
import { getSession, readSessionId } from './sessions';

export class LocalAuthenticator implements Authenticator {
  constructor(private readonly oauth: boolean, private readonly tokens: TokenProvider) {}

  async authenticate(req: IncomingRequestLike): Promise<AuthResult> {
    if (!this.oauth) return { ok: true, identity: { userId: 'dev' } };
    const sessionId = readSessionId(req.header('cookie'));
    const session = getSession(sessionId);
    if (!sessionId || !session) return { ok: false, status: 401, message: 'Please log in.', relogin: true };
    try {
      await this.tokens.getToken({ userId: session.user, sessionId }); // refreshes if needed
    } catch (e) {
      if (e instanceof AuthError) return { ok: false, status: 401, message: e.message, relogin: true };
      throw e;
    }
    return { ok: true, identity: { userId: session.user, sessionId } };
  }
}
