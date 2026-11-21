// What to do when Nexconn rejects our token (31004) or gives up reconnecting (33007). Pure; tested
// (test/nexconn-retry.test.ts). Before this rule the client fetched a new token and reconnected
// forever with no pause, so a token Nexconn never accepts (a local fake Nexconn, a wrong App Key)
// flapped "connecting / disconnected" until our token endpoint rate-limited it.

/** Fresh-token retries after a rejection before we stop and show "Couldn't connect · Try again". */
export const MAX_TOKEN_RETRIES = 2;

export type RejectPlan = { retry: true; delayMs: number } | { retry: false };

/**
 * `rejects` counts rejections in a row (1 = the first), reset by a successful connect or Try again.
 * The first retry is immediate (a token can expire between tabs), the second waits, then we stop.
 */
export function afterTokenRejected(rejects: number): RejectPlan {
  if (rejects <= 0) return { retry: true, delayMs: 0 };
  if (rejects > MAX_TOKEN_RETRIES) return { retry: false };
  return { retry: true, delayMs: rejects === 1 ? 0 : 3000 };
}
