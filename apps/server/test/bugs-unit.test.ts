// Phase 5 rules: repro result mapping (FAIL = reproduced, PASS = not), the repro format, the hotfix
// "all old repros must pass" rule, screenshot checks, the per-user translation cap, and the voice
// pitch fallback (Sarvam fails or no key -> "type it instead"; a transcript routes like text).
import { CARD_MESSAGE_TYPES, LIMITS, type PlanCardContent } from '@crewarcade/shared';
import { and, eq } from 'drizzle-orm';
import { cards, games, gameVersions } from '../src/db/schema';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { hotfixNote, reproOutcome, runGlitchJob, validateRepro } from '../src/agents/bugs';
import { hotfixPasses } from '../src/agents/glitch';
import { voiceToText } from '../src/agents/runtime';
import { SttError, voiceFallbackText, type SpeechToText } from '../src/ai/sarvam';
import { canTranslate } from '../src/repo/bugs';
import { decodeScreenshot } from '../src/services/bugs';
import { createHarness, signUp, WEB, type Harness, type NexconnCall } from './harness';

const check = (name: string, pass: boolean, detail = 'ok', kind: 'only' | 'repro' | 'generic' = 'only') => ({ name, pass, detail, kind });

describe('repro result mapping', () => {
  const label = 'BUG 1: hugging the right wall should end the run';
  it('FAIL of the BUG check = reproduced', () => {
    const r = reproOutcome({
      checks: [check(`[repro-1] ${label}`, false, "state.scene === 'over' -> state {...}")],
      expects: [{ label, pass: false, scenario: '[repro-1]' }],
    });
    expect(r.outcome).toBe('reproduced');
  });
  it('PASS = not reproduced', () => {
    expect(reproOutcome({ checks: [check(`[repro-1] ${label}`, true)], expects: [{ label, pass: true, scenario: '[repro-1]' }] }).outcome).toBe(
      'not_reproduced',
    );
  });
  it('a check that threw, a bad step or no check is a broken repro, never the bug', () => {
    expect(
      reproOutcome({ checks: [check(`[repro-1] ${label}`, false, 'error in "state.nope.x": TypeError')], expects: [{ label, pass: false, scenario: 'r' }] })
        .outcome,
    ).toBe('broken');
    expect(reproOutcome({ checks: [check('[repro-1] step 2: unknown key', false)], expects: [] }).outcome).toBe('broken');
    expect(reproOutcome({ checks: [], expects: [] }).outcome).toBe('broken');
  });
});

describe('repro format', () => {
  it('keeps one expect as the last step, labelled BUG <n>', () => {
    const r = validateRepro([{ call: 'start' }, { press: 'ArrowRight', ms: 30000 }, { expect: "state.scene === 'over'", label: 'run should end' }], 3);
    expect(r.problems).toEqual([]);
    expect(r.steps?.at(-1)).toEqual({ expect: "state.scene === 'over'", label: 'BUG 3: run should end' });
  });
  it('rejects zero or several expects, no start and long runs', () => {
    expect(validateRepro([{ call: 'start' }, { wait: 100 }], 1).problems.join()).toMatch(/exactly one expect/);
    const many = validateRepro([{ wait: 60_000 }, { wait: 40_000 }, { expect: 'true' }, { expect: 'true' }], 1).problems.join('\n');
    expect(many).toMatch(/exactly one expect.*\(found 2\)/);
    expect(many).toMatch(/never calls start/);
    expect(many).toMatch(/game time/);
  });
  it('hotfix notes credit the bug hunter (readHotfix format)', () => {
    expect(hotfixNote({ description: 'the  cat\nwalks through walls' }, 'Riya')).toBe('hotfix: the cat walks through walls (bug hunter: Riya)');
  });
});

describe('hotfix rule: every old repro must pass', () => {
  const r = (pass: boolean) => ({ kind: 'repro' as const, pass });
  it('passes only when every repro ran and passed', () => {
    expect(hotfixPasses([r(true), r(true), { kind: 'generic', pass: true }])).toBe(true);
    expect(hotfixPasses([r(true), r(false)])).toBe(false); // an older fixed bug came back
    expect(hotfixPasses([{ kind: 'generic', pass: true }])).toBe(false); // its own repro never ran
    expect(hotfixPasses([r(true), { kind: 'regression', pass: false, advisory: true }])).toBe(true); // old scenarios are advisory
  });
});

describe('screenshots', () => {
  const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString('base64')}`;
  it('accepts real images and rejects a mislabelled file', () => {
    expect(decodeScreenshot(png).ext).toBe('png');
    expect(() => decodeScreenshot(`data:image/jpeg;base64,${Buffer.from('<svg/>').toString('base64')}`)).toThrow(/not the image/);
  });
});

describe('translation cap', () => {
  it('a tap fits only while the day total stays within the cap', () => {
    expect(canTranslate(0, 400, 1000)).toBe(true);
    expect(canTranslate(800, 200, 1000)).toBe(true);
    expect(canTranslate(800, 201, 1000)).toBe(false);
    expect(canTranslate(0, 0, 1000)).toBe(false);
  });
});

describe('voice pitch fallback', () => {
  const voice = { url: 'https://files.example/v.aac', durationS: 6, relayed: false };
  const audio = async () => ({ data: Buffer.from('aac'), mimeType: 'audio/aac', filename: 'voice.aac' });
  it('no key, Sarvam failing, a bad download or a long note -> a reason (never a throw)', async () => {
    expect(await voiceToText(voice, { stt: undefined, download: audio, allowedHosts: [] })).toMatchObject({ ok: false, reason: 'not_configured' });
    const failing: SpeechToText = {
      transcribe: async () => {
        throw new SttError('sarvam answered 503', 'unavailable');
      },
    };
    expect(await voiceToText(voice, { stt: failing, download: audio, allowedHosts: [] })).toMatchObject({ ok: false, reason: 'unavailable' });
    const badDownload = async () => {
      throw new SttError('voice host not allowed', 'download');
    };
    const ok: SpeechToText = { transcribe: async () => ({ text: 'hi', language: 'hi-IN', ms: 5 }) };
    expect(await voiceToText({ ...voice, relayed: true }, { stt: ok, download: badDownload, allowedHosts: [] })).toMatchObject({
      ok: false,
      reason: 'download',
    });
    expect(await voiceToText({ ...voice, durationS: LIMITS.voiceSeconds + 1 }, { stt: ok, download: audio, allowedHosts: [] })).toMatchObject({
      reason: 'too_long',
    });
    expect(await voiceToText(voice, { stt: ok, download: audio, allowedHosts: [] })).toMatchObject({ ok: true, text: 'hi' });
  });
  it('the fallback line asks to type instead, in Hindi for Hindi users', () => {
    expect(voiceFallbackText('unavailable', false)).toMatch(/type it instead/);
    expect(voiceFallbackText('not_configured', true)).toMatch(/टाइप/);
  });
});

describe('voice + translation on the server', () => {
  let h: Harness;
  let asha: { cookie: string; id: string };
  let channelId: string;
  const heard: string[] = [];
  const stt: SpeechToText = {
    transcribe: async a => {
      heard.push(a.filename);
      return { text: 'ek billi jo chai ke cups se bachti hai', language: 'hi-IN', ms: 300 };
    },
  };
  const post = (url: string, cookie: string, payload?: object) =>
    h.app.inject({ method: 'POST', url, headers: { cookie, origin: WEB }, ...(payload && { payload }) });
  const sends = (type: string) => h.calls.filter((c: NexconnCall) => c.path === '/v4/group-channel/message/send' && c.body.messageType === type);

  beforeAll(async () => {
    h = await createHarness({ agents: true, stt, env: { FAKE_AGENTS: '1' } });
    asha = await signUp(h, 'Asha', '10.5.0.1');
    channelId = (await post('/api/crews', asha.cookie, { name: 'Voice Crew' })).json().crew.groupChannelId;
  }, 60_000);
  afterAll(() => h.close());
  afterEach(() => vi.restoreAllMocks());

  it('a Hinglish voice note to Pixel is transcribed and routed like the text (a plan card)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(Buffer.from('aacdata'), { headers: { 'content-type': 'audio/aac' } }));
    await h.webhook('message:send', [
      {
        userId: asha.id,
        channelId,
        channelType: 3,
        messageType: 'RC:HQVCMsg',
        content: JSON.stringify({ remoteUrl: 'https://files.nexconn.test/v1.aac', duration: 7, mentionedInfo: { type: 2, userIdList: ['agentpixel'] } }),
        time: (h.now.t += 1000),
        messageId: 'VOICE-1',
        os: 'Websocket',
      },
    ]);
    await h.settle();
    expect(heard).toEqual(['voice.aac']);
    expect(sends(CARD_MESSAGE_TYPES.plan)).toHaveLength(1);
  }, 60_000);

  it('a failed download gets the friendly "type it instead" line, no plan', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('nope', { status: 403 }));
    const before = sends('RC:TxtMsg').length;
    await h.webhook('message:send', [
      {
        userId: asha.id,
        channelId,
        channelType: 3,
        messageType: 'RC:HQVCMsg',
        content: JSON.stringify({ remoteUrl: 'https://files.nexconn.test/v2.aac', duration: 5, mentionedInfo: { type: 2, userIdList: ['agentpixel'] } }),
        time: (h.now.t += 1000),
        messageId: 'VOICE-2',
        os: 'Websocket',
      },
    ]);
    await h.settle();
    const texts = sends('RC:TxtMsg')
      .slice(before)
      .map(c => String(JSON.parse(String(c.body.content)).content));
    expect(texts.some(t => /type it instead/.test(t))).toBe(true);
    expect(sends(CARD_MESSAGE_TYPES.plan)).toHaveLength(1);
  }, 60_000);

  it('tap-to-translate reserves the daily cap; over the cap is refused', async () => {
    const a = await post('/api/translate/quota', asha.cookie, { chars: 600 });
    expect(a.json()).toMatchObject({ ok: true, used: 600, limit: LIMITS.dailyTranslationChars });
    const b = await post('/api/translate/quota', asha.cookie, { chars: LIMITS.dailyTranslationChars - 600 + 1 });
    expect(b.json()).toMatchObject({ ok: false, used: 600 });
    expect((await post('/api/translate/quota', asha.cookie, { chars: LIMITS.dailyTranslationChars - 600 })).json()).toMatchObject({ ok: true });
    h.now.t += 24 * 3600_000; // a new day, a fresh allowance
    expect((await post('/api/translate/quota', asha.cookie, { chars: 600 })).json()).toMatchObject({ ok: true, used: 600 });
  });
});

describe('playtests switched off (Render free plan)', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness({ agents: true, builds: true, env: { FAKE_AGENTS: '1', PLAYTESTS: 'false' } });
    // What startAgentWorker does without a playtester: jobs are consumed, never left waiting.
    await h.agents!.queue.startPlaytests(job => runGlitchJob({ ...h.ctx(), agents: h.agents! }, job));
  }, 60_000);
  afterAll(() => h.close());

  it('a build is playable, Glitch says testing is off, and nothing is marked passed', async () => {
    const asha = await signUp(h, 'Asha', '10.7.0.1');
    const post = (url: string, payload?: object) =>
      h.app.inject({ method: 'POST', url, headers: { cookie: asha.cookie, origin: WEB }, ...(payload && { payload }) });
    const channelId = (await post('/api/crews', { name: 'Free Crew' })).json().crew.groupChannelId;
    await h.webhook('message:send', [
      {
        userId: asha.id,
        channelId,
        channelType: 3,
        messageType: 'RC:TxtMsg',
        content: JSON.stringify({ content: '@pixel a frog hopping over logs', mentionedInfo: { type: 2, userIdList: ['agentpixel'] } }),
        time: (h.now.t += 1000),
        messageId: 'FREE-1',
        os: 'Websocket',
      },
    ]);
    await h.settle();
    const sends = (type: string) => h.calls.filter(c => c.path === '/v4/group-channel/message/send' && c.body.messageType === type);
    const plan = JSON.parse(String(sends(CARD_MESSAGE_TYPES.plan).at(-1)!.body.content)) as PlanCardContent;
    const [pc] = await h.db
      .select()
      .from(cards)
      .where(and(eq(cards.gameId, plan.gameId), eq(cards.cardType, 'plan')));
    expect((await post(`/api/cards/${pc!.nexconnMessageId}/approve`)).statusCode).toBe(200);
    await h.settle();
    const texts = sends('RC:TxtMsg').map(c => String(JSON.parse(String(c.body.content)).content));
    expect(texts.some(t => /Playtests are switched off/.test(t))).toBe(true);
    const [v1] = await h.db.select().from(gameVersions).where(eq(gameVersions.gameId, plan.gameId));
    expect(v1!.status).toBe('testing');
    // The game shows "Ready to play" (built, untested) and the Forge -> Glitch handoff is closed.
    expect((await h.db.select().from(games).where(eq(games.id, plan.gameId)))[0]!.status).toBe('built');
    const [handoff] = await h.db
      .select()
      .from(cards)
      .where(and(eq(cards.gameId, plan.gameId), eq(cards.cardType, 'handoff'), eq(cards.version, 1)));
    const handoffMeta = h.calls.filter(c => c.path === '/v4/channel-type/message/metadata/set' && c.body.messageId === handoff?.nexconnMessageId);
    expect(handoffMeta.at(-1)?.body.metadata).toMatchObject({ status: 'done' });
    expect(sends(CARD_MESSAGE_TYPES.publish)).toHaveLength(0);
  }, 60_000);
});
