// Errors the edge turns into HTTP statuses (edge/mastra/errors.ts). Their messages are safe to show the caller;
// anything internal goes to the logger, never into these messages.

// The request itself is wrong (400).
export class ValidationError extends Error {
  constructor(message: string, readonly issues: string[] = []) {
    super(message);
    this.name = 'ValidationError';
  }
}

// The caller must sign in again (401, relogin: true).
export class AuthError extends Error {
  constructor(message = 'Please sign in again.') {
    super(message);
    this.name = 'AuthError';
  }
}

// Genie or another upstream service failed (502).
export class UpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpstreamError';
  }
}
