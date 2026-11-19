// Forge's smoke playtest (real headless Chromium) and the Gemini client's busy-retry (a local fake
// Generative Language API).
import { createServer, type Server } from 'node:http';
import { starterHtml } from '@crewarcade/engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { channel, type AiClient, type StructuredCall } from '../src/ai/claude';
import { fakeBuildOutput } from '../src/ai/fake-game';
import { createGeminiClient, isBusyError, replayGuard } from '../src/ai/gemini';
import { agentOfPurpose, busyDetail, withBusyNotify, type AiBusy } from '../src/ai/busy';
import { insertCode, runBuildLoop } from '../src/agents/forge';
import { createHeadless, smokeFindings } from '../src/agents/smoke';

const good = fakeBuildOutput({ title: 'Smoke Test', pitch: 'A small game for the smoke test.', seed: 7 });
// The bug a real build had: per-frame points round to 0, so the score never rises.
const dead = { ...good, code: good.code.replace(/addScore\((10|1)\)/g, 'addScore(Math.round(dt * 10))') };

describe('Forge smoke playtest', () => {
  const smoke = createHeadless();
  afterAll(() => smoke.close());

  it('passes a game that starts and scores; flags one whose score never rises', async () => {
    expect(await smoke.smoke(insertCode(starterHtml(), good.code))).toEqual([]);
    const problems = await smoke.smoke(insertCode(starterHtml(), dead.code));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/score did not rise.*whole numbers/s);
  }, 60_000);

  it('maps page errors and failed checks to readable problems', () => {
    expect(
      smokeFindings({ checks: [{ name: '[smoke] the game starts', pass: false, detail: 'scene title' }], logs: ['pageerror: TypeError: x is undefined'] }),
    ).toEqual(['Smoke test: the game starts failed (scene title).', 'Smoke test: the page logged an error: pageerror: TypeError: x is undefined']);
    expect(smokeFindings({ checks: [{ name: 'x', pass: false, detail: '', advisory: true }], logs: [] })).toEqual([]);
  });

  it('the build loop sends smoke problems back to Forge like static-check problems', async () => {
    const outs = [dead, good];
    const calls: string[] = [];
    const ai: AiClient = {
      model: 'm',
      structured<T>(call: StructuredCall<T>) {
        calls.push(call.user);
        const out = outs[calls.length - 1]!;
        const field = channel<string>();
        field.end();
        return {
          fieldChunks: field.iterable,
          done: Promise.resolve({
            value: call.schema.parse(out),
            usage: { model: 'm', tokensIn: 1, tokensOut: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, ms: 1, fellBack: false },
          }),
        };
      },
      streamText() {
        throw new Error('unused');
      },
    };
    const r = await runBuildLoop({
      ai,
      baseHtml: starterHtml(),
      spec: {
        title: 'Smoke Test',
        slug: 'smoke-test',
        pitch: 'A small game for the smoke test.',
        credits: [],
        approvedBy: [],
        controls: { keyboard: 'arrows', touch: 'buttons' },
        coreLoop: 'Catch good things and dodge bad ones.',
        winLose: 'Three hits end it.',
        scoring: 'Points per catch.',
        lookAndFeel: 'Emoji on a dark sky.',
        sound: 'Beeps.',
        acceptance: [
          { id: 'A1', text: 'state().score rises while playing.' },
          { id: 'A2', text: 'Holding ArrowRight increases state().playerX.' },
          { id: 'A3', text: 'state().lives drops on a hit.' },
          { id: 'A4', text: "state().scene becomes 'over' at 0 lives." },
        ],
        changes: [],
      },
      version: 1,
      language: 'en',
      smoke: smoke.smoke,
    });
    expect(r.attempts.map(a => a.problems.length)).toEqual([1, 0]);
    expect(calls[1]).toMatch(/Problems:\n1\. Smoke test: after 6 s of play the score did not rise/);
  }, 90_000);
});

describe('Gemini busy-retry', () => {
  let server: Server;
  let base = '';
  let answers: Array<'busy' | 'ok' | 'bad' | 'partial' | 'intro'> = [];
  let hits = 0;
  beforeAll(async () => {
    server = createServer((req, res) => {
      hits++;
      req.resume();
      // A model that is always busy (the fallback test): answers without using up `answers`.
      const a = req.url?.includes('gemini-busy') ? 'busy' : (answers.shift() ?? 'ok');
      if (a === 'busy')
        return res
          .writeHead(503, { 'content-type': 'application/json' })
          .end(JSON.stringify({ error: { code: 503, message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' } }));
      if (a === 'bad')
        return res
          .writeHead(400, { 'content-type': 'application/json' })
          .end(JSON.stringify({ error: { code: 400, message: 'invalid argument', status: 'INVALID_ARGUMENT' } }));
      const sse = (text: string, finish?: string) =>
        `data: ${JSON.stringify({
          candidates: [{ content: { role: 'model', parts: [{ text }] }, ...(finish && { finishReason: finish }) }],
          usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 },
          modelVersion: 'gemini-test',
        })}

`;
      // Mid-stream "high demand": some text, then the error (what the free tier did live, 2026-11-18).
      if (a === 'partial')
        return res.writeHead(200, { 'content-type': 'text/event-stream' }).end(
          sse('{"intro":"Planning Chai Pou') +
            `data: ${JSON.stringify({ error: { code: 503, message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' } })}

`,
        );
      if (a === 'intro')
        return res.writeHead(200, { 'content-type': 'text/event-stream' }).end(sse('{"intro":"Planning Chai Po') + sse('unce now!","ok":true}', 'STOP'));
      const chunk = {
        candidates: [{ content: { role: 'model', parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 },
        modelVersion: 'gemini-test',
      };
      res.writeHead(200, { 'content-type': 'text/event-stream' }).end(`data: ${JSON.stringify(chunk)}\r\n\r\n`);
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>(r => server.close(() => r())));

  const call = { purpose: 'pixel.plan' as const, system: 's', user: 'u', effort: 'low' as const, maxTokens: 100, schema: z.object({ ok: z.boolean() }) };

  it('retries a 503 "high demand" answer and then succeeds', async () => {
    answers = ['busy', 'busy', 'ok'];
    hits = 0;
    const waits: number[] = [];
    const ai = createGeminiClient({ apiKey: 'k', model: 'gemini-test', baseUrl: base, sleep: async ms => void waits.push(ms), retryDelayMs: n => n * 10 });
    const r = await ai.structured(call).done;
    expect(r.value).toEqual({ ok: true });
    expect(hits).toBe(3);
    expect(waits).toEqual([10, 20]);
  });

  it('gives up after the retries, and never retries a non-busy error', async () => {
    answers = ['busy', 'busy', 'busy'];
    hits = 0;
    const ai = createGeminiClient({ apiKey: 'k', model: 'gemini-test', baseUrl: base, sleep: async () => {}, retries: 2 });
    await expect(ai.structured(call).done).rejects.toThrow(/high demand|503|UNAVAILABLE/);
    expect(hits).toBe(3);
    answers = ['bad'];
    hits = 0;
    await expect(ai.structured(call).done).rejects.toThrow();
    expect(hits).toBe(1);
  });

  it('retries a busy answer that cuts the stream mid-reply, without repeating the shown text', async () => {
    answers = ['partial', 'intro'];
    hits = 0;
    const ai = createGeminiClient({ apiKey: 'k', model: 'gemini-test', baseUrl: base, sleep: async () => {}, retryDelayMs: () => 1 });
    const run = ai.structured({ ...call, schema: z.object({ intro: z.string(), ok: z.boolean() }), streamField: 'intro' });
    const pieces: string[] = [];
    for await (const p of run.fieldChunks) pieces.push(p);
    expect((await run.done).value).toEqual({ intro: 'Planning Chai Pounce now!', ok: true });
    expect(hits).toBe(2);
    expect(pieces.join('')).toBe('Planning Chai Pounce now!');
  });

  it('falls back to the other model when one stays busy, and marks the usage as a fallback', async () => {
    answers = ['ok'];
    hits = 0;
    const ai = createGeminiClient({ apiKey: 'k', model: 'gemini-busy', fallbackModels: ['gemini-test'], baseUrl: base, sleep: async () => {}, retries: 1 });
    const r = await ai.structured(call).done;
    expect(r.value).toEqual({ ok: true });
    expect(hits).toBe(3); // busy, busy (1 retry), then the fallback model
    expect(r.usage.fellBack).toBe(true);
    // Without a fallback the busy error still surfaces.
    const lone = createGeminiClient({ apiKey: 'k', model: 'gemini-busy', baseUrl: base, sleep: async () => {}, retries: 1 });
    await expect(lone.structured(call).done).rejects.toThrow(/high demand|503|UNAVAILABLE/);
  });

  it('reports each busy retry and the model switch to the running job (live agent state)', async () => {
    answers = ['ok'];
    const seen: Array<{ purpose: string; b: AiBusy }> = [];
    const ai = createGeminiClient({ apiKey: 'k', model: 'gemini-busy', fallbackModels: ['gemini-test'], baseUrl: base, sleep: async () => {}, retries: 2 });
    await withBusyNotify(
      (purpose, b) => void seen.push({ purpose, b }),
      () => ai.structured(call).done,
    );
    expect(seen.map(x => busyDetail(x.b))).toEqual([
      'AI model busy, retrying (1/2)…',
      'AI model busy, retrying (2/2)…',
      'AI model busy, switching to gemini-test…',
    ]);
    expect(seen.every(x => x.purpose === 'pixel.plan')).toBe(true);
    // Outside a job scope nothing is reported, and a throwing notifier never breaks the call.
    answers = ['ok'];
    await expect(ai.structured(call).done).resolves.toBeTruthy();
    answers = ['ok'];
    await expect(
      withBusyNotify(
        () => {
          throw new Error('boom');
        },
        () => ai.structured(call).done,
      ),
    ).resolves.toBeTruthy();
  });

  it('maps AI purposes to agents', () => {
    expect(agentOfPurpose('forge.build')).toBe('forge');
    expect(agentOfPurpose('glitch.repro')).toBe('glitch');
    expect(agentOfPurpose('pixel.delta')).toBe('pixel');
    expect(agentOfPurpose('stt.voice')).toBeNull();
  });

  it('the replay guard passes on only what is new', () => {
    const out: string[] = [];
    const g = replayGuard(t => out.push(t));
    const a = g.attempt();
    a('Planning ');
    a('Chai');
    const b = g.attempt();
    b('Planning Ch');
    b('ai Pounce');
    b('!');
    expect(out.join('')).toBe('Planning Chai Pounce!');
  });

  it('knows a busy answer when it sees one', () => {
    expect(isBusyError('got status: UNAVAILABLE. {"error":{"code":503}}')).toBe(true);
    expect(isBusyError('RESOURCE_EXHAUSTED: quota')).toBe(true);
    expect(isBusyError('invalid argument (400)')).toBe(false);
  });
});
