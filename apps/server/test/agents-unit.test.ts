// Unit tests for the agent building blocks: stream chunking, the JSON field streamer, the queue
// rules (idempotency, concurrency, one job per room), plan normalization, live states with
// heartbeats, line limits, and the Claude wrapper against a local fake Messages API.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { LIMITS } from '@crewarcade/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { limitLines } from '../src/agents/pixel';
import { addMemory, baseSlug, detectLanguage, normalizePlan, pickSlug, PlanShapeError, PixelPlanOutput } from '../src/agents/plan';
import { createMemoryQueue, jobUuid, type AgentJobData } from '../src/agents/queue';
import { createAgentStates } from '../src/agents/states';
import { AiOutputError, AiRefusalError, costUsd, createClaudeClient, outputJsonSchema } from '../src/ai/claude';
import { createFakeAiClient, fakePlanOutput, fakeTitle } from '../src/ai/fake';
import { streamJsonStringField } from '../src/ai/json-stream';
import { NexconnClient, type FetchLike } from '../src/nexconn';
import { byteLength, streamToGroup, takeBytes } from '../src/nexconn/stream';

async function* from(pieces: string[], clock?: { t: number; step: number }) {
  for (const p of pieces) {
    if (clock) clock.t += clock.step;
    yield p;
  }
}

function fakeNexconn(failOn?: (path: string, body: Record<string, unknown>) => boolean) {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  let n = 0;
  const fetch: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(init.body) as Record<string, unknown>;
    calls.push({ path, body });
    if (failOn?.(path, body)) return { status: 200, text: async () => JSON.stringify({ code: 1002, errorMessage: 'nope' }) };
    if (path.endsWith('/stream/send'))
      return { status: 200, text: async () => JSON.stringify({ code: 0, result: (body.content as { seq: number }).seq === 1 ? { messageId: 'S-1' } : {} }) };
    return { status: 200, text: async () => JSON.stringify({ code: 0, result: { messageIds: [{ channelId: 'c', messageId: `T-${++n}` }] } }) };
  };
  // Fake clock: the rate limiter's waits advance it instantly.
  let t = 0;
  const client = new NexconnClient({
    appKey: 'k',
    appSecret: 's',
    baseUrls: ['https://a.test', 'https://b.test'],
    fetch,
    now: () => t,
    sleep: async ms => void (t += ms),
  });
  return { client, calls };
}

describe('stream chunking', () => {
  const sender = { id: 'agentpixel', name: 'Pixel · Designer', portrait: 'https://web.test/agents/pixel.svg' };

  it('takeBytes never splits a character', () => {
    expect(takeBytes('héllo', 2)).toEqual(['h', 'éllo']);
    expect(takeBytes('चाय', 4)).toEqual(['च', 'ाय']);
    expect(takeBytes('🎮🎮', 5)).toEqual(['🎮', '🎮']);
    expect(takeBytes('abc', 10)).toEqual(['abc', '']);
  });

  it('batches deltas every ~300 ms, seq +1 from 1, first chunk carries type + user, last is complete', async () => {
    const { client, calls } = fakeNexconn();
    const clock = { t: 0, step: 100 };
    const res = await streamToGroup(client, from(['Ooh', ', I ', 'love', ' this', '! Pla', 'nning', ' *Chai', ' Dash*…'], clock), {
      channelId: 'crew1',
      sender,
      now: () => clock.t,
      mode: 'chunked',
    });
    const bodies = calls.map(c => c.body.content as { content: string; seq: number; complete: boolean; type?: string; messageId?: string; user?: object });
    expect(bodies.map(b => b.seq)).toEqual(bodies.map((_, i) => i + 1));
    expect(bodies[0]).toMatchObject({ seq: 1, type: 'markdown', user: { id: 'agentpixel', name: 'Pixel · Designer' } });
    expect(bodies[0]!.messageId).toBeUndefined();
    for (const b of bodies.slice(1)) expect(b).toMatchObject({ messageId: 'S-1' });
    for (const b of bodies.slice(1)) expect(b.type).toBeUndefined();
    expect(bodies.at(-1)!.complete).toBe(true);
    expect(bodies.slice(0, -1).every(b => !b.complete)).toBe(true);
    // 8 deltas 100 ms apart -> far fewer chunks than deltas.
    expect(bodies.length).toBeLessThanOrEqual(4);
    expect(bodies.map(b => b.content).join('')).toBe('Ooh, I love this! Planning *Chai Dash*…');
    expect(res).toMatchObject({ messageId: 'S-1', fellBack: false, text: 'Ooh, I love this! Planning *Chai Dash*…' });
    expect(calls[0]!.body).toMatchObject({ toChannelId: 'crew1', messageType: 'RC:StreamMsg', fromUserId: 'agentpixel' });
  });

  it('keeps every chunk <= 1 KB and the whole stream under 128 KB', async () => {
    const { client, calls } = fakeNexconn();
    const big = 'चाय-'.repeat(20_000); // ~200 KB of multi-byte text
    const res = await streamToGroup(client, from(big.match(/.{1,500}/gsu)!), { channelId: 'crew1', sender, now: () => 0, mode: 'chunked' });
    const contents = calls.map(c => (c.body.content as { content: string }).content);
    for (const c of contents) expect(byteLength(c)).toBeLessThanOrEqual(1024);
    expect(contents.reduce((n, c) => n + byteLength(c), 0)).toBeLessThan(LIMITS.streamTotalBytes);
    expect(res.text.endsWith('…') || res.text.endsWith('… ')).toBe(true);
    expect((calls.at(-1)!.body.content as { complete: boolean }).complete).toBe(true);
  });

  it('streams in chunks by default and reports the first messageId once', async () => {
    const { client, calls } = fakeNexconn();
    const clock = { t: 0, step: 400 };
    const started: string[] = [];
    const debug: object[] = [];
    await streamToGroup(client, from(['Hello ', 'crew, ', 'here is ', 'the plan.'], clock), {
      channelId: 'crew1',
      sender,
      now: () => clock.t,
      onStart: id => started.push(id),
      log: { debug: o => debug.push(o) },
    });
    expect(calls.length).toBeGreaterThan(1);
    expect(started).toEqual(['S-1']);
    expect(debug).toHaveLength(calls.length);
    expect(debug[1]).toMatchObject({ seq: 2, messageId: 'S-1' });
  });

  it("'single' sends the whole reply as ONE complete chunk", async () => {
    const { client, calls } = fakeNexconn();
    const res = await streamToGroup(client, from(['Ooh, I ', 'love this! ', 'Planning *Chai Dash*…']), { channelId: 'crew1', sender, mode: 'single' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.content).toMatchObject({
      seq: 1,
      complete: true,
      type: 'markdown',
      content: 'Ooh, I love this! Planning *Chai Dash*…',
      user: { id: 'agentpixel' },
    });
    expect(res).toMatchObject({ messageId: 'S-1', chunks: 1, fellBack: false });
  });

  it('an empty reply still sends one complete chunk', async () => {
    const { client, calls } = fakeNexconn();
    await streamToGroup(client, from([]), { channelId: 'crew1', sender, mode: 'single' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.content).toMatchObject({ seq: 1, complete: true, content: '…' });
  });

  it('on failure, sends the full reply once as a normal text message', async () => {
    const { client, calls } = fakeNexconn((path, body) => path.endsWith('/stream/send') && (body.content as { seq: number }).seq === 2);
    const clock = { t: 0, step: 400 };
    const res = await streamToGroup(client, from(['Hello ', 'crew, ', 'here is ', 'the plan.'], clock), {
      channelId: 'crew1',
      sender,
      now: () => clock.t,
      mode: 'chunked',
    });
    expect(res.fellBack).toBe(true);
    const text = calls.filter(c => c.path === '/v4/group-channel/message/send');
    expect(text).toHaveLength(1);
    expect(JSON.parse(String(text[0]!.body.content))).toEqual({ content: 'Hello crew, here is the plan.' });
    expect(text[0]!.body).toMatchObject({ messageType: 'RC:TxtMsg', fromUserId: 'agentpixel', toChannelIds: ['crew1'] });
  });
});

describe('JSON field streaming', () => {
  const run = (json: string, field: string, sizes: number[]) => {
    let out = '';
    const feed = streamJsonStringField(field, t => (out += t));
    let i = 0;
    for (const n of sizes.length ? sizes : [json.length]) {
      if (i >= json.length) break;
      feed(json.slice(i, i + n));
      i += n;
    }
    if (i < json.length) feed(json.slice(i));
    return out;
  };
  const doc = JSON.stringify({ title: 'Chai "Dash"', intro: 'Ooh, I love this!\nPlanning *Chai Dash*… चाय é 🎮', pitch: 'x', nested: { intro: 'not me' } });

  it('emits exactly the decoded field value, whatever the chunk sizes', () => {
    const want = 'Ooh, I love this!\nPlanning *Chai Dash*… चाय é 🎮';
    expect(run(doc, 'intro', [])).toBe(want);
    for (const size of [1, 2, 3, 7, 16]) expect(run(doc, 'intro', Array(1000).fill(size))).toBe(want);
  });
  it('handles \\u escapes split across chunks and ignores nested keys of the same name', () => {
    const escaped = '{"a":{"intro":"no"},"intro":"caf\\u00e9 \\"ok\\""}';
    expect(run(escaped, 'intro', Array(100).fill(1))).toBe('café "ok"');
  });
  it('emits nothing when the field is missing or not a string', () => {
    expect(run('{"title":"x","intro":5}', 'intro', [3, 3, 3])).toBe('');
    expect(run('{"title":"intro"}', 'intro', [])).toBe('');
  });
});

describe('job queue rules', () => {
  const job = (key: string, channelId: string): AgentJobData => ({
    key,
    crewId: 'c1',
    channelId,
    messageId: key,
    fromUserId: 'u1',
    agent: 'pixel',
    intent: 'plan',
    text: 'x',
    attachments: [],
  });

  it('is idempotent by key and derives stable UUIDs for pg-boss', async () => {
    const q = createMemoryQueue({ concurrency: 4 });
    expect(await q.enqueueAgent(job('msg:A', 'r1'))).toBe(true);
    expect(await q.enqueueAgent(job('msg:A', 'r1'))).toBe(false);
    expect(jobUuid('msg:A')).toBe(jobUuid('msg:A'));
    expect(jobUuid('msg:A')).not.toBe(jobUuid('msg:B'));
    expect(jobUuid('msg:A')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('runs at most 4 at once and never two in the same room', async () => {
    const q = createMemoryQueue({ concurrency: 4 });
    let running = 0;
    let peak = 0;
    const perRoom = new Map<string, number>();
    let roomPeak = 0;
    const order: string[] = [];
    await q.start(async j => {
      running++;
      peak = Math.max(peak, running);
      perRoom.set(j.channelId, (perRoom.get(j.channelId) ?? 0) + 1);
      roomPeak = Math.max(roomPeak, perRoom.get(j.channelId)!);
      await new Promise(r => setTimeout(r, 5));
      order.push(j.key);
      perRoom.set(j.channelId, perRoom.get(j.channelId)! - 1);
      running--;
    });
    for (let i = 0; i < 12; i++) await q.enqueueAgent(job(`k${i}`, `room${i % 6}`));
    for (let i = 0; i < 3; i++) await q.enqueueAgent(job(`same${i}`, 'busy'));
    await q.idle();
    expect(order).toHaveLength(15);
    expect(peak).toBe(4);
    expect(roomPeak).toBe(1);
    // Same-room jobs keep their order.
    expect(order.filter(k => k.startsWith('same'))).toEqual(['same0', 'same1', 'same2']);
  });
});

describe('plan normalization', () => {
  const ctx = { gameId: 'g1', planVersion: 1, slug: 'chai-dash', language: 'en' as const, credits: ['Asha'] };
  const out = fakePlanOutput({ pitch: 'a chai cup on a scooter', language: { code: 'en', hinglish: false }, pitcher: 'Asha' });

  it('builds a valid PlanCard and engine GameSpec', () => {
    const { card, spec } = normalizePlan(out, ctx);
    expect(card).toMatchObject({ v: 1, gameId: 'g1', version: 1, slug: 'chai-dash', credits: ['Asha'] });
    expect(spec).toMatchObject({ slug: 'chai-dash', approvedBy: [], changes: [] });
    expect(card.acceptance.map(a => a.id)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5']);
  });
  it('clamps long fields, renumbers and caps acceptance at 8, rejects fewer than 4', () => {
    const long = {
      ...out,
      title: `**${'Very '.repeat(20)}Long**`,
      acceptance: Array.from({ length: 11 }, (_, i) => ({ id: `X${i}`, text: `state().score check number ${i}` })),
    };
    const { card } = normalizePlan(long, ctx);
    expect(card.title.length).toBeLessThanOrEqual(40);
    expect(card.title).not.toMatch(/\*/);
    expect(card.acceptance).toHaveLength(8);
    expect(card.acceptance[7]!.id).toBe('A8');
    expect(() => normalizePlan({ ...out, acceptance: out.acceptance.slice(0, 3) }, ctx)).toThrow(PlanShapeError);
  });
  it('slugs: readable, unique, fallback for non-Latin titles', () => {
    expect(baseSlug('Chai Dash!', 'game-x')).toBe('chai-dash');
    expect(baseSlug('चाय दौड़', 'game-ab12')).toBe('game-ab12');
    expect(pickSlug('chai-dash', new Set(['chai-dash', 'chai-dash-2']))).toBe('chai-dash-3');
    expect(pickSlug('a'.repeat(26), new Set(['a'.repeat(26)])).length).toBeLessThanOrEqual(30);
  });
  it('detects the pitch language: Hindi, Hinglish, other scripts, English', () => {
    expect(detectLanguage('एक चाय का कप जो स्कूटर पर चलता है')).toEqual({ code: 'hi', hinglish: false });
    expect(detectLanguage('ek chai cup jo scooter pe potholes se bachta hai')).toEqual({ code: 'hi', hinglish: true });
    expect(detectLanguage('ஒரு டீ கப்')).toEqual({ code: 'ta', hinglish: false });
    expect(detectLanguage('a penguin on a sled')).toEqual({ code: 'en', hinglish: false });
    expect(detectLanguage('🎮🎮', 'bn')).toEqual({ code: 'bn', hinglish: false });
  });
  it('crew memory keeps 10 short bullets, newest first, no duplicates', () => {
    let m: string[] = [];
    for (let i = 0; i < 12; i++) m = addMemory(m, `likes theme ${i}`);
    expect(m).toHaveLength(10);
    expect(m[0]).toBe('likes theme 11');
    expect(addMemory(['likes cats'], 'Likes Cats')).toEqual(['Likes Cats']);
    expect(addMemory(['a b c d'], '')).toEqual(['a b c d']);
    expect(addMemory([], 'x'.repeat(200))[0]!.length).toBeLessThanOrEqual(80);
  });
  it('the fake plan is deterministic and parses as Claude output', () => {
    expect(fakeTitle('a chai cup')).toBe(fakeTitle('chai on a scooter'));
    expect(PixelPlanOutput.parse(out)).toEqual(out);
    expect(fakePlanOutput({ pitch: 'ek chai cup', language: { code: 'hi', hinglish: true }, pitcher: 'A' }).intro).toMatch(/plan kar raha hoon/);
  });
});

describe('agent states', () => {
  it('sends each change, beats every 5 s while busy, stops when idle or waiting', async () => {
    const sent: Array<{ state: string; startedAt: number }> = [];
    let t = 1000;
    const timers = new Map<number, () => void>();
    let id = 0;
    const states = createAgentStates({
      send: async (_c, s) => void sent.push(s),
      now: () => t,
      setInterval: fn => {
        timers.set(++id, fn);
        return id;
      },
      clearInterval: x => void timers.delete(x as number),
    });
    await states.set('r1', 'pixel', 'thinking', { detail: 'reading' });
    expect(timers.size).toBe(1);
    t = 6000;
    for (const fn of timers.values()) fn(); // heartbeat
    await states.set('r1', 'pixel', 'designing');
    expect(timers.size).toBe(1); // same agent+room keeps one heartbeat
    await states.set('r1', 'pixel', 'waiting_approval', { detail: 'Chai Dash' });
    expect(timers.size).toBe(0);
    expect(sent.map(s => s.state)).toEqual(['thinking', 'thinking', 'designing', 'waiting_approval']);
    expect(sent[1]!.startedAt).toBe(1000); // the heartbeat keeps the original start
    expect(states.snapshot('r1')).toEqual([expect.objectContaining({ agentId: 'pixel', state: 'waiting_approval', detail: 'Chai Dash' })]);
    await states.set('r1', 'pixel', 'idle');
    expect(states.snapshot('r1')).toEqual([]);
  });
});

describe('limitLines', () => {
  it('passes at most 8 lines through', async () => {
    const out: string[] = [];
    for await (const p of limitLines(from(['1\n2\n3\n', '4\n5\n6\n7\n8', '\n9\n10']))) out.push(p);
    expect(out.join('')).toBe('1\n2\n3\n4\n5\n6\n7\n8');
  });
});

// ---- the Claude wrapper against a local fake Messages API --------------------------------------

interface Captured {
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}
let server: http.Server;
let base = '';
const captured: Captured[] = [];
let nextReply: { text: string; stop: string; model?: string; iterations?: unknown[] } = { text: '', stop: 'end_turn' };

function sse(res: http.ServerResponse, reply: typeof nextReply) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const ev = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  const model = reply.model ?? 'claude-opus-5-5';
  ev('message_start', {
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0 },
    },
  });
  ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
  for (const piece of reply.text.match(/.{1,9}/gsu) ?? []) ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: piece } });
  ev('content_block_stop', { index: 0 });
  ev('message_delta', {
    delta: {
      stop_reason: reply.stop,
      stop_sequence: null,
      ...(reply.stop === 'refusal' && { stop_details: { type: 'refusal', category: 'cyber', explanation: 'no' } }),
    },
    usage: { output_tokens: 800, ...(reply.iterations && { iterations: reply.iterations }) },
  });
  ev('message_stop', {});
  res.end();
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', d => (raw += d));
    req.on('end', () => {
      captured.push({ headers: req.headers, body: JSON.parse(raw) as Record<string, unknown> });
      sse(res, nextReply);
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

describe('Claude wrapper', () => {
  const client = () => createClaudeClient({ apiKey: 'test-key', model: 'claude-opus-5-5', baseURL: base, timeoutMs: 10_000 });
  const Schema = z.object({ title: z.string(), intro: z.string(), n: z.number() });

  it('sends model, explicit effort, cached system prompt, refusal fallbacks and the output schema; streams one field', async () => {
    nextReply = { text: JSON.stringify({ title: 'Chai Dash', intro: 'Ooh, *Chai Dash*!', n: 3 }), stop: 'end_turn' };
    const run = client().structured({
      purpose: 'pixel.plan',
      system: 'SYSTEM',
      user: 'USER',
      schema: Schema,
      streamField: 'intro',
      effort: 'medium',
      maxTokens: 16000,
    });
    let streamed = '';
    for await (const p of run.fieldChunks) streamed += p;
    const { value, usage } = await run.done;
    expect(streamed).toBe('Ooh, *Chai Dash*!');
    expect(value).toEqual({ title: 'Chai Dash', intro: 'Ooh, *Chai Dash*!', n: 3 });
    const req = captured.at(-1)!;
    expect(String(req.headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01');
    expect(req.body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      stream: true,
      fallbacks: 'default',
      system: [{ type: 'text', text: 'SYSTEM', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'USER' }],
      output_config: { effort: 'medium', format: { type: 'json_schema' } },
    });
    expect(req.body).not.toHaveProperty('thinking'); // Opus 5.5 always thinks; no prefill either
    expect((req.body.messages as unknown[]).length).toBe(1);
    // input 1200 + cache read 3000 @ $0.20/M + output 800 @ $20/M
    expect(usage).toMatchObject({ model: 'claude-opus-5-5', tokensIn: 4200, tokensOut: 800, cacheReadTokens: 3000, fellBack: false });
    expect(usage.costUsd).toBeCloseTo((1200 * 4 + 3000 * 0.2 + 800 * 20) / 1e6, 8);
  });

  it('checks stop_reason first: refusal -> AiRefusalError with the category', async () => {
    nextReply = { text: '', stop: 'refusal' };
    const run = client().structured({ purpose: 'pixel.plan', system: 'S', user: 'U', schema: Schema, effort: 'medium', maxTokens: 100 });
    const err = await run.done.catch(e => e);
    expect(err).toBeInstanceOf(AiRefusalError);
    expect(err.category).toBe('cyber');
    expect(err.usage.tokensOut).toBe(800);
  });

  it('max_tokens and schema mismatches are AiOutputError', async () => {
    nextReply = { text: '{"title":"x"', stop: 'max_tokens' };
    await expect(
      client().structured({ purpose: 'pixel.plan', system: 'S', user: 'U', schema: Schema, effort: 'low', maxTokens: 10 }).done,
    ).rejects.toBeInstanceOf(AiOutputError);
    nextReply = { text: '{"title":"x"}', stop: 'end_turn' };
    await expect(client().structured({ purpose: 'pixel.plan', system: 'S', user: 'U', schema: Schema, effort: 'low', maxTokens: 10 }).done).rejects.toThrow(
      /did not match/,
    );
  });

  it('streams text and reports a fallback rescue', async () => {
    nextReply = {
      text: 'Line one\nLine two',
      stop: 'end_turn',
      model: 'claude-opus-4-8',
      iterations: [{ type: 'fallback_message', input_tokens: 1, output_tokens: 1 }],
    };
    const run = client().streamText({ purpose: 'pixel.explain', system: 'S', user: 'U', effort: 'low', maxTokens: 4000 });
    let text = '';
    for await (const p of run.chunks) text += p;
    const done = await run.done;
    expect(text).toBe('Line one\nLine two');
    expect(done.usage).toMatchObject({ model: 'claude-opus-4-8', fellBack: true });
    expect(captured.at(-1)!.body.output_config).toEqual({ effort: 'low' });
  });

  it('output schemas drop keywords structured outputs do not take; objects are closed', () => {
    const js = outputJsonSchema(
      z.object({ a: z.string().min(2).max(9), b: z.array(z.string()).min(4).max(8), c: z.object({ d: z.number().int().min(0) }) }),
    ) as {
      properties: Record<string, Record<string, unknown>>;
      additionalProperties: boolean;
    };
    expect(js.additionalProperties).toBe(false);
    expect(js.properties.a).toEqual({ type: 'string' });
    expect(js.properties.b).toEqual({ type: 'array', items: { type: 'string' } });
    expect(js.properties.c).toMatchObject({ additionalProperties: false });
    expect(JSON.stringify(js)).not.toMatch(/maxLength|minLength|maxItems|\$schema/);
  });

  it('prices every model we may be served by', () => {
    expect(costUsd('claude-opus-5-5', { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 })).toBe(4);
    expect(costUsd('claude-opus-5-5', { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0 })).toBe(20);
    expect(costUsd('claude-opus-4-8', { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0 })).toBe(25);
    expect(costUsd('unknown-model', { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 })).toBe(4);
  });

  it('the fake client is instant at speed 0 and fails loudly for purposes it does not know', async () => {
    const fake = createFakeAiClient({ speed: 0 });
    const run = fake.structured({ purpose: 'pixel.reply', system: '', user: '', schema: z.object({}), effort: 'low', maxTokens: 1 });
    await expect(run.done).rejects.toThrow(/no structured output/);
  });
});
