// Typed errors for Platform Chat API calls.

/** Nexconn answered with `code != 0` (or HTTP 401/4xx with a business code). Not retried. */
export class NexconnApiError extends Error {
  constructor(
    readonly path: string,
    /** Business code from the body (e.g. 1002 invalid parameter, 1004 bad signature), or the HTTP status. */
    readonly code: number,
    readonly httpStatus: number,
    message: string,
  ) {
    super(`Nexconn ${path} failed: code ${code}${message ? ` (${message})` : ''}`);
    this.name = 'NexconnApiError';
  }
}

/** Every attempt on both domains failed (network errors, timeouts, 5xx, rate limits). */
export class NexconnUnavailableError extends Error {
  constructor(
    readonly path: string,
    readonly attempts: number,
    readonly lastProblem: string,
  ) {
    super(`Nexconn ${path} unavailable after ${attempts} attempts: ${lastProblem}`);
    this.name = 'NexconnUnavailableError';
  }
}

/** The server has no NEXCONN_APP_KEY / NEXCONN_APP_SECRET. */
export class NexconnNotConfiguredError extends Error {
  constructor() {
    super('Nexconn is not configured (NEXCONN_APP_KEY / NEXCONN_APP_SECRET missing)');
    this.name = 'NexconnNotConfiguredError';
  }
}

/** A Phase 2+ endpoint that is documented but not implemented yet. */
export class NotImplementedYetError extends Error {
  constructor(what: string, docs: string) {
    super(`${what} is not implemented yet (see ${docs})`);
    this.name = 'NotImplementedYetError';
  }
}
