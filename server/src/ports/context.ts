// Who is asking, for one request. Built at the edge (after authentication) and passed to everything the request touches,
// instead of reading globals.
// Local: built by edge/mastra from the cookie session or the shared dev user. GC: built from the verified Okta token.
// Never log `userToken`; never put it in an error message or a ChatEvent.
export type BiRequestContext = {
  userId: string;       // stable id of the caller (Okta `sub` in GC mode, the Databricks user name or "dev" locally)
  userToken?: string;   // the caller's identity token (Okta access token in GC mode). Exchanged for a Databricks token, never forwarded
  sessionId?: string;   // local cookie session, when there is one
  traceId: string;      // one id per request, on every log line
  signal: AbortSignal;  // aborted when the caller goes away or the turn times out
};

// The few parts of an HTTP request authentication needs, so it works under Mastra/Hono, NestJS or a test.
export type IncomingRequestLike = {
  method: string;
  path: string;
  header(name: string): string | undefined;
  signal: AbortSignal;
};
