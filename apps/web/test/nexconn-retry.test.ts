// A token Nexconn keeps rejecting must not loop forever: one immediate retry, one after a pause, then stop.
import { describe, expect, it } from 'vitest';
import { afterTokenRejected, MAX_TOKEN_RETRIES } from '../src/lib/nexconn/retry';

describe('after a rejected Nexconn token', () => {
  it('retries at once, then after a pause, then gives up', () => {
    expect(afterTokenRejected(1)).toEqual({ retry: true, delayMs: 0 });
    expect(afterTokenRejected(2)).toEqual({ retry: true, delayMs: 3000 });
    expect(afterTokenRejected(3)).toEqual({ retry: false });
    expect(afterTokenRejected(50)).toEqual({ retry: false });
  });

  it('allows exactly MAX_TOKEN_RETRIES fresh-token retries in a row', () => {
    let retries = 0;
    for (let n = 1; afterTokenRejected(n).retry; n++) retries++;
    expect(retries).toBe(MAX_TOKEN_RETRIES);
  });
});
