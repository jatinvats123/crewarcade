// Webhooks: signature accept/reject, freshness, dedupe, routing, pre-messaging gate.
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nexconnSignature } from '../src/crypto';
import { connections, messagesLog, users, webhookEvents } from '../src/db/schema';
import { verifyWebhook } from '../src/webhooks/verify';
import { APP_KEY, APP_SECRET, createHarness, signUp, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
}, 60_000);
afterAll(async () => {
  await h.close();
});

function signed(ts = h.now.t, nonce = 'n0nce123', overrides: Record<string, string> = {}) {
  return {
    appkey: APP_KEY,
    nonce,
    timestamp: String(ts),
    signature: nexconnSignature(APP_SECRET, nonce, String(ts)),
    'content-type': 'application/json',
    ...overrides,
  };
}
const send = (payload: unknown, headers: Record<string, string> = signed(), url = '/webhooks/nexconn') =>
  h.app.inject({ method: 'POST', url, headers, payload: payload as object });

let n = 0;
const event = (type: string, data: Array<Record<string, unknown>>, id = `evt-${++n}`) => ({ type, id, time: h.now.t, data });
const textMsg = (over: Record<string, unknown> = {}) => ({
  userId: 'uAAAAAAAAAAAAAAAA',
  channelId: 'crewXYZ',
  channelType: 3,
  messageType: 'RC:TxtMsg',
  content: JSON.stringify({ content: 'Hello crew', extra: '' }),
  time: h.now.t,
  messageId: `MSG-${++n}`,
  os: 'Websocket',
  ...over,
});

describe('signature verification', () => {
  const opts = () => ({ appKey: APP_KEY, appSecret: APP_SECRET, maxSkewMs: 600_000, now: h.now.t });
  it('accepts sha1(AppSecret + Nonce + Timestamp) with the AppKey header, case-insensitively for the hex', () => {
    expect(verifyWebhook(signed(), opts())).toEqual({ ok: true });
    const s = signed();
    expect(verifyWebhook({ ...s, signature: s.signature.toUpperCase() }, opts())).toEqual({ ok: true });
  });
  it('rejects missing headers, a foreign AppKey, a bad signature and stale timestamps', () => {
    const s = signed();
    expect(verifyWebhook({ ...s, appkey: undefined as unknown as string }, opts())).toEqual({ ok: false, reason: 'missing_headers' });
    expect(verifyWebhook({ ...s, appkey: 'someoneElse' }, opts())).toEqual({ ok: false, reason: 'app_key' });
    expect(verifyWebhook({ ...s, signature: 'f'.repeat(40) }, opts())).toEqual({ ok: false, reason: 'signature' });
    expect(verifyWebhook(signed(h.now.t - 11 * 60_000), opts())).toEqual({ ok: false, reason: 'stale' });
    expect(verifyWebhook({ ...s, timestamp: 'abc' }, opts())).toEqual({ ok: false, reason: 'missing_headers' });
    // "App-Key" (the API-call spelling) is not what webhooks send.
    const { appkey, ...rest } = s;
    expect(verifyWebhook({ ...rest, 'app-key': appkey }, opts()).ok).toBe(false);
  });
  it('the route answers 401 to unsigned or forged requests and stores nothing', async () => {
    const before = (await h.db.select().from(webhookEvents)).length;
    expect((await send(event('message:send', [textMsg()]), { 'content-type': 'application/json' })).statusCode).toBe(401);
    expect((await send(event('message:send', [textMsg()]), signed(h.now.t, 'abc', { signature: '0'.repeat(40) }))).statusCode).toBe(401);
    expect((await h.db.select().from(webhookEvents)).length).toBe(before);
  });
});

describe('routing', () => {
  it('message:send -> messages_log (text for text messages, type only for others, agents mapped back)', async () => {
    const t = textMsg();
    const img = textMsg({ messageType: 'RC:ImgMsg', content: JSON.stringify({ imageUri: 'https://cdn/x.jpg', content: 'AAAA' }) });
    const agent = textMsg({ userId: 'agentpixel', content: JSON.stringify({ content: 'Hi crew!' }) });
    for (const m of [t, img, agent]) expect((await send(event('message:send', [m]))).json()).toEqual({ ok: true });
    await h.flush();
    const rows = await h.db.select().from(messagesLog);
    const byId = new Map(rows.map(r => [r.nexconnMessageId, r]));
    expect(byId.get(t.messageId as string)).toMatchObject({
      channelId: 'crewXYZ',
      channelType: 3,
      fromUserId: 'uAAAAAAAAAAAAAAAA',
      messageType: 'RC:TxtMsg',
      text: 'Hello crew',
    });
    expect(byId.get(img.messageId as string)).toMatchObject({ messageType: 'RC:ImgMsg', text: null });
    expect(byId.get(agent.messageId as string)).toMatchObject({ fromUserId: 'agent-pixel', text: 'Hi crew!' });
    expect(byId.get(t.messageId as string)!.createdAt.getTime()).toBe(t.time);
  });

  it('status messages (CA:Typing, CA:AgentState, CA:Reaction) are not logged', async () => {
    const typing = textMsg({ messageType: 'CA:Typing', content: '{"typing":"text"}' });
    await send(event('message:send', [typing]));
    await h.flush();
    expect(
      await h.db
        .select()
        .from(messagesLog)
        .where(eq(messagesLog.nexconnMessageId, typing.messageId as string)),
    ).toEqual([]);
  });

  it('user:connection_status -> connections (event id key) and users.last_seen_at', async () => {
    const { id } = await signUp(h, 'Online', '10.2.0.1');
    const at = h.now.t + 5000;
    const e = event('user:connection_status', [{ status: '0', userId: id, os: 'Websocket', time: at, clientIp: '1.2.3.4:5', sessionId: 's1' }]);
    await send(e);
    await h.flush();
    expect(await h.db.select().from(connections).where(eq(connections.eventId, e.id))).toEqual([
      { eventId: e.id, userId: id, status: '0', os: 'Websocket', at: new Date(at) },
    ]);
    const [u] = await h.db.select().from(users).where(eq(users.id, id));
    expect(u!.lastSeenAt!.getTime()).toBe(at);
    // Agent IDs map back to DB IDs.
    const ae = event('user:connection_status', [{ status: '1', userId: 'agentforge', time: at }]);
    await send(ae);
    await h.flush();
    expect((await h.db.select().from(connections).where(eq(connections.eventId, ae.id)))[0]!.userId).toBe('agent-forge');
  });

  it('other events are acknowledged and ignored', async () => {
    const before = [(await h.db.select().from(messagesLog)).length, (await h.db.select().from(connections)).length];
    const res = await send(event('group_channel:operation', [{ operation: 'join' }]));
    expect(res.statusCode).toBe(200);
    await h.flush();
    expect([(await h.db.select().from(messagesLog)).length, (await h.db.select().from(connections)).length]).toEqual(before);
  });

  it('bad items are skipped; a malformed envelope gets 200 so Nexconn does not retry it forever', async () => {
    const res = await send(event('message:send', [{ nope: true }]));
    expect(res.statusCode).toBe(200);
    await h.flush();
    expect((await send({ hello: 'world' })).json()).toEqual({ ok: false });
  });
});

describe('dedupe', () => {
  it('the same event id is processed once (Nexconn retries up to 3 times)', async () => {
    const m = textMsg({ content: JSON.stringify({ content: 'only once' }) });
    const e = event('message:send', [m], 'evt-dup-1');
    const first = await send(e);
    const second = await send(e, signed(h.now.t, 'otherNonce'));
    expect(first.json()).toEqual({ ok: true });
    expect(second.json()).toEqual({ ok: true, duplicate: true });
    await h.flush();
    expect(await h.db.select().from(webhookEvents).where(eq(webhookEvents.id, 'evt-dup-1'))).toHaveLength(1);
    expect(
      await h.db
        .select()
        .from(messagesLog)
        .where(eq(messagesLog.nexconnMessageId, m.messageId as string)),
    ).toHaveLength(1);
  });
});

describe('pre-messaging', () => {
  const pre = () =>
    event('group_channel:pre_messaging', [
      {
        appKey: APP_KEY,
        userId: 'u1',
        channelId: 'crewXYZ',
        channelType: 3,
        messageType: 'RC:TxtMsg',
        content: '{"content":"hi"}',
        time: h.now.t,
        messageId: 'P1',
        os: 'Websocket',
      },
    ]);
  it('answers {pass: 1} synchronously, fast, on the single webhook URL and on the /pre alias', async () => {
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const res = await send(pre(), signed(), i % 2 ? '/webhooks/nexconn/pre' : '/webhooks/nexconn');
      times.push(performance.now() - t0);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ pass: 1 });
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95)]!).toBeLessThan(150);
  });
  it('does not touch the dedupe table (the decision must be repeatable on retries)', async () => {
    const e = pre();
    await send(e);
    expect(await h.db.select().from(webhookEvents).where(eq(webhookEvents.id, e.id))).toEqual([]);
  });
  it('still needs a valid signature', async () => {
    expect((await send(pre(), { 'content-type': 'application/json' })).statusCode).toBe(401);
  });
});
