// Authentication and Databricks tokens.
// Local: cookie session or shared token (adapters/local). GC: Okta bearer token, exchanged per user for a Databricks token (adapters/gc).
// What must never cross these ports into logs or errors: the identity token, the Databricks token, cookies.
import type { BiRequestContext, IncomingRequestLike } from './context';

export type Identity = Pick<BiRequestContext, 'userId' | 'userToken' | 'sessionId'>;

// `message` is safe to show the caller. `relogin` tells the UI to send the user through sign-in again.
export type AuthFailure = { status: 401 | 403; message: string; relogin: boolean };

export type AuthResult = { ok: true; identity: Identity } | ({ ok: false } & AuthFailure);

export interface Authenticator {
  authenticate(req: IncomingRequestLike): Promise<AuthResult>;
}

// The Databricks token to call Genie with, for this caller. Implementations cache and refresh as needed.
// Throws AuthError (core/errors) when the caller must sign in again.
export interface TokenProvider {
  getToken(ctx: Pick<BiRequestContext, 'userId' | 'userToken' | 'sessionId'>): Promise<string>;
}
