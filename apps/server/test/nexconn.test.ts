// Nexconn server client: signing, failover, retries, rate limiting, typed errors, input rules.
import { describe, expect, it } from 'vitest';
import { nexconnSignature } from '../src/crypto';
import {
  createGroup,
  createOpenChannel,
  issueToken,
  NexconnApiError,
  NexconnClient,
  NexconnUnavailableError,
  NotImplementedYetError,
  sendGroupMessage,
  setMessageMetadata,
  streamGroupMessage,
  tokenBucket,
  type FetchLike,
} from '../src/nexconn';

/** Fake clock: sleep() advances time instantly, so retries and buckets run in microseconds. */
function fakeTime(start = 1_700_000_000_000) {
  let t = start;
  return { now: () => t, sleep: async (ms: number) => void (t += ms), advance: (ms: number) => void (t += ms) };
}

interface Call {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  at: number;
}

function fakeFetch(responses: Array<{ status: number; body?: unknown } | 'network' | 'timeout'>, clock = fakeTime()) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body), at: clock.now() });
    const r = responses.shift() ?? { status: 200, body: { code: 0, result: { messageIds: [{ channelId: 'a', messageId: 'M1' }] } } };
    if (r === 'network') throw new Error('ECONNRESET');
    if (r === 'timeout')
      return new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    return { status: r.status, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {})) };
  };
  return { fetch, calls, clock };
}

function client(f: ReturnType<typeof fakeFetch>, extra: Partial<ConstructorParameters<typeof NexconnClient>[0]> = {}) {
  return new NexconnClient({
    appKey: 'myAppKey',
    appSecret: 'myAppSecret',
    baseUrls: ['https://api.sg-light-api.com', 'https://api-b.sg-light-api.com'],
    fetch: f.fetch,
    now: f.clock.now,
    sleep: f.clock.sleep,
    random: () => 0.5,
    timeoutMs: 20,
    ...extra,
  });
}

describe('signature', () => {
  it('is lowercase hex sha1(AppSecret + Nonce + Timestamp) (fixed vector)', () => {
    // printf 'myAppSecret143141408710653000' | sha1sum
    expect(nexconnSignature('myAppSecret', '14314', '1408710653000')).toBe('753f72b345758759cb494b295e6802adae0b490a');
  });

  it('every request carries fresh App-Key, Nonce, Timestamp, Signature and X-Request-ID', async () => {
    const f = fakeFetch([
      { status: 200, body: { code: 0, result: { userId: 'u1', accessToken: 'tok' } } },
      { status: 200, body: { code: 0, result: { userId: 'u1', accessToken: 'tok' } } },
    ]);
    const c = client(f);
    await issueToken(c, { userId: 'u1', name: 'Asha' });
    await issueToken(c, { userId: 'u1', name: 'Asha' });
    const [a, b] = f.calls as [Call, Call];
    expect(a.url).toBe('https://api.sg-light-api.com/v4/auth/access-token/issue');
    expect(a.headers['App-Key']).toBe('myAppKey');
    expect(a.headers.Timestamp).toBe(String(f.clock.now()));
    expect(a.headers.Nonce).toMatch(/^[A-Za-z0-9]{1,18}$/);
    expect(a.headers.Signature).toBe(nexconnSignature('myAppSecret', a.headers.Nonce!, a.headers.Timestamp!));
    expect(a.headers['X-Request-ID']!.length).toBeLessThanOrEqual(36);
    expect(a.headers['Content-Type']).toBe('application/json');
    expect(b.headers.Nonce).not.toBe(a.headers.Nonce);
    expect(b.headers['X-Request-ID']).not.toBe(a.headers['X-Request-ID']);
  });
});

describe('failover and retries', () => {
  it('switches to the backup domain on a timeout and stays there', async () => {
    const f = fakeFetch(['timeout', { status: 200, body: { code: 0 } }, { status: 200, body: { code: 0 } }]);
    const c = client(f);
    await createGroup(c, { channelId: 'crew1', name: 'Friday', owner: 'u1' });
    expect(f.calls.map(x => new URL(x.url).host)).toEqual(['api.sg-light-api.com', 'api-b.sg-light-api.com']);
    expect(c.activeBaseUrl).toBe('https://api-b.sg-light-api.com');
    await createGroup(c, { channelId: 'crew2', name: 'Saturday', owner: 'u1' });
    expect(new URL(f.calls[2]!.url).host).toBe('api-b.sg-light-api.com');
  });

  it('switches domain on 5xx and network errors, and on non-Nexconn responses', async () => {
    const f = fakeFetch([{ status: 502, body: 'Bad gateway' }, 'network', { status: 200, body: { code: 0 } }]);
    const c = client(f);
    await createGroup(c, { channelId: 'crew1', name: 'Friday', owner: 'u1' });
    expect(f.calls.map(x => new URL(x.url).host)).toEqual(['api.sg-light-api.com', 'api-b.sg-light-api.com', 'api.sg-light-api.com']);

    const g = fakeFetch([
      { status: 404, body: '<html>not found</html>' },
      { status: 200, body: { code: 0 } },
    ]);
    await createGroup(client(g), { channelId: 'crew1', name: 'Friday', owner: 'u1' });
    expect(g.calls.map(x => new URL(x.url).host)).toEqual(['api.sg-light-api.com', 'api-b.sg-light-api.com']);
  });

  it('retries rate limits (HTTP 429, code 1008) on the same domain with jittered backoff', async () => {
    const f = fakeFetch([
      { status: 429, body: {} },
      { status: 200, body: { code: 1008, errorMessage: 'too fast' } },
      { status: 200, body: { code: 0 } },
    ]);
    const c = client(f, { backoffBaseMs: 100 });
    await createGroup(c, { channelId: 'crew1', name: 'Friday', owner: 'u1' });
    expect(f.calls.map(x => new URL(x.url).host)).toEqual(['api.sg-light-api.com', 'api.sg-light-api.com', 'api.sg-light-api.com']);
    // random() = 0.5 -> 0.5 * 100, then 0.5 * 200
    expect(f.calls[1]!.at - f.calls[0]!.at).toBe(50);
    expect(f.calls[2]!.at - f.calls[1]!.at).toBe(100);
  });

  it('gives up after maxAttempts with NexconnUnavailableError', async () => {
    const f = fakeFetch([{ status: 500 }, { status: 503 }, { status: 500 }]);
    await expect(createGroup(client(f), { channelId: 'crew1', name: 'Friday', owner: 'u1' })).rejects.toBeInstanceOf(NexconnUnavailableError);
    expect(f.calls).toHaveLength(3);
  });

  it('does not retry business errors and surfaces the code', async () => {
    const f = fakeFetch([{ status: 200, body: { code: 1002, errorMessage: 'invalid parameter' } }]);
    const err = await createGroup(client(f), { channelId: 'crew1', name: 'Friday', owner: 'u1' }).catch(e => e);
    expect(err).toBeInstanceOf(NexconnApiError);
    expect(err).toMatchObject({ code: 1002, httpStatus: 200 });
    expect(f.calls).toHaveLength(1);
  });

  it('treats HTTP 401 as a signature problem (no retry)', async () => {
    const f = fakeFetch([{ status: 401, body: 'Unauthorized' }]);
    await expect(createGroup(client(f), { channelId: 'crew1', name: 'Friday', owner: 'u1' })).rejects.toMatchObject({ code: 401, httpStatus: 401 });
    expect(f.calls).toHaveLength(1);
  });

  it('validates the response shape', async () => {
    const f = fakeFetch([{ status: 200, body: { code: 0, result: { userId: 'u1' } } }]);
    await expect(issueToken(client(f), { userId: 'u1', name: 'Asha' })).rejects.toMatchObject({ code: -1 });
  });
});

describe('rate limiting', () => {
  it('token bucket: a burst of 25 group sends at 20/s takes ~250 ms of (fake) time', async () => {
    const clock = fakeTime();
    const bucket = tokenBucket({ ratePerSec: 20, now: clock.now, sleep: clock.sleep });
    const t0 = clock.now();
    const done: number[] = [];
    await Promise.all(Array.from({ length: 25 }, () => bucket.acquire().then(() => done.push(clock.now() - t0))));
    expect(done.slice(0, 20).every(t => t === 0)).toBe(true);
    expect(Math.max(...done)).toBeGreaterThanOrEqual(250);
    expect(Math.max(...done)).toBeLessThan(300);
  });

  it('group sends and group metadata share one 20/s bucket; a 3-channel send costs 3', async () => {
    const clock = fakeTime();
    const f = fakeFetch([], clock);
    const c = client(f);
    const sends = Array.from({ length: 6 }, (_, i) =>
      sendGroupMessage(c, { fromUserId: 'agentpixel', toChannelIds: ['a', 'b', 'c'], messageType: 'RC:TxtMsg', content: `{"content":"${i}"}` }),
    );
    const meta = setMessageMetadata(c, { messageId: 'M1', userId: 'u1', channelType: 3, channelId: 'a', metadata: { status: 'voting' } });
    f.calls.length = 0;
    await Promise.all([...sends, meta]);
    // 6 sends x 3 + 1 metadata = 19 tokens: all fit in the first second's burst of 20.
    expect(f.calls.every(x => x.at === f.calls[0]!.at)).toBe(true);
    await Promise.all(
      Array.from({ length: 3 }, () =>
        sendGroupMessage(c, { fromUserId: 'agentpixel', toChannelIds: ['a', 'b', 'c'], messageType: 'RC:TxtMsg', content: '{"content":"x"}' }),
      ),
    );
    const last = f.calls[f.calls.length - 1]!.at - f.calls[0]!.at;
    expect(last).toBeGreaterThanOrEqual(350); // 9 more tokens, 1 left over: wait 8/20 s
  });
});

describe('input rules (checked before anything is sent)', () => {
  const f = fakeFetch([]);
  const c = client(f);
  it('rejects non-alphanumeric ids, too many channels and metadata on multi-channel sends', async () => {
    await expect(issueToken(c, { userId: 'agent-pixel', name: 'Pixel' })).rejects.toThrow();
    await expect(sendGroupMessage(c, { fromUserId: 'u1', toChannelIds: ['a', 'b', 'c', 'd'], messageType: 'RC:TxtMsg', content: '{}' })).rejects.toThrow();
    await expect(sendGroupMessage(c, { fromUserId: 'u1', toChannelIds: ['a', 'b'], messageType: 'CA:Card', content: '{}', hasMetadata: true })).rejects.toThrow(
      /metadata/,
    );
    await expect(sendGroupMessage(c, { fromUserId: 'u1', toChannelIds: ['a'], messageType: 'CA:Card', content: `"${'x'.repeat(11_000)}"` })).rejects.toThrow(
      /10 KB/,
    );
    await expect(setMessageMetadata(c, { messageId: 'M', userId: 'u1', channelType: 3, channelId: 'a', metadata: { 'bad key!': 'x' } })).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  });
  it('stubs point at the docs for later phases', async () => {
    await expect(createOpenChannel(c, {})).rejects.toBeInstanceOf(NotImplementedYetError);
    await expect(createOpenChannel(c, {})).rejects.toThrow(/open-channel\/create\.md/);
  });
  it('validates stream chunks before they leave (seq, messageId, first-chunk fields)', async () => {
    const base = { fromUserId: 'agentpixel', toChannelId: 'crew1', messageType: 'RC:StreamMsg' as const };
    await expect(streamGroupMessage(c, { ...base, content: { content: 'x', seq: 0, complete: false } })).rejects.toThrow();
    await expect(streamGroupMessage(c, { ...base, content: { content: 'x', seq: 1, complete: false, messageId: 'M1' } })).rejects.toThrow(/first chunk/);
    await expect(streamGroupMessage(c, { ...base, content: { content: 'x', seq: 2, complete: false } })).rejects.toThrow(/messageId/);
    await expect(streamGroupMessage(c, { ...base, content: { content: 'x', seq: 2, complete: false, messageId: 'M1', type: 'markdown' } })).rejects.toThrow(
      /first chunk only/,
    );
    expect(f.calls).toHaveLength(0);
  });
});
