// Phase 4 rules: Glitch's scenario validation, the automatic fix round limit, publish permissions,
// and the flow on the server (FAKE agents, fake Nexconn, PGlite, a browser-free playtester):
// FAIL -> 2 automatic fixes -> the crew decides -> [Ask for fix] -> PASS -> publish request ->
// only an owner/approver can Allow -> published version plays on the public page.
import { CARD_MESSAGE_TYPES, type PlanCardContent, type TestCardContent } from '@crewarcade/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { afterFail, failuresForForge, fixRoundOf, GlitchScenarioOutput, MAX_AUTO_FIX_ROUNDS, validateScenario, writeScenario } from '../src/agents/glitch';
import { ReproOutput } from '../src/agents/bugs';
import type { AgentServices } from '../src/agents/runtime-deps';
import { AiOutputError, type AiClient, type AiUsage } from '../src/ai/claude';
import { starterHtml, type GameSpec } from '@crewarcade/engine';
import { cards, games, gameVersions, ledger } from '../src/db/schema';
import { canDecidePublish } from '../src/services/publish';
import { createHarness, signUp, stubPlaytester, WEB, type Harness, type NexconnCall } from './harness';

const A = [
  { id: 'A1', text: 'state().score rises while playing' },
  { id: 'A2', text: 'Holding ArrowRight increases state().x' },
];
const steps = (s: GlitchScenarioOutput['steps']) => validateScenario(s, A);

describe('scenario validation', () => {
  it('accepts one labelled expect per acceptance item', () => {
    const r = steps([
      { call: 'start' },
      { mark: 'a' },
      { wait: 2000 },
      { expect: 'state.score > marks.a.score', label: 'A1 score rises' },
      { press: 'ArrowRight', ms: 400 },
      { expect: 'state.x > marks.a.x', label: 'A2 right moves' },
    ]);
    expect(r.problems).toEqual([]);
    expect(r.steps).toHaveLength(6);
  });

  it('rejects missing, duplicate and unlabelled checks, multi-action steps, no start, bad keys and long runs', () => {
    const r = steps([
      { mark: 'a', wait: 100 },
      { press: 'Mouse1' },
      { wait: 60_000 },
      { wait: 40_000 },
      { expect: 'true', label: 'A1 one' },
      { expect: 'true', label: 'A1 two' },
      { expect: 'true', label: 'looks fine' },
    ]);
    expect(r.steps).toBeNull();
    const all = r.problems.join('\n');
    expect(all).toMatch(/step 1: needs exactly one/);
    expect(all).toMatch(/unsupported key/);
    expect(all).toMatch(/never calls start/);
    expect(all).toMatch(/"looks fine": its label must start with an acceptance id/);
    expect(all).toMatch(/A1: needs exactly one labelled expect \(found 2\)/);
    expect(all).toMatch(/A2: needs exactly one labelled expect \(found 0\)/);
    expect(all).toMatch(/game time/);
  });
});

describe('scenario output from the model (the API ignores numeric and length limits)', () => {
  it('parses out-of-range numbers and long text, then reports them as fixable problems with step numbers', () => {
    const raw = {
      steps: [
        { call: 'start' as const },
        { wait: 95_000 },
        { press: 'ArrowRight', ms: 0 },
        { expect: 'state.score > 0', label: 'A1 ' + 'x'.repeat(250) },
        { expect: 'state.x > 0', label: 'A2 right moves' },
      ],
    };
    const parsed = GlitchScenarioOutput.safeParse(raw);
    expect(parsed.success).toBe(true);
    const r = validateScenario(parsed.data!.steps, A);
    expect(r.steps).toBeNull();
    const all = r.problems.join('\n');
    expect(all).toMatch(/step \d+:/);
    expect(all).toMatch(/game time/);
  });

  it('caps a scenario at 80 steps and needs at least 2', () => {
    expect(GlitchScenarioOutput.safeParse({ steps: [] }).success).toBe(true);
    expect(validateScenario([{ call: 'start' }], A).problems.join('\n')).toMatch(/2 to 80 steps/);
    const many = [{ call: 'start' as const }, ...Array.from({ length: 85 }, () => ({ wait: 10 }))];
    expect(validateScenario(many, A).problems.join('\n')).toMatch(/2 to 80 steps/);
  });

  it('a repro question of any length parses (trimmed to 300 characters)', () => {
    const r = ReproOutput.safeParse({ steps: [{ call: 'start' }], question: 'ok? ' + 'y'.repeat(400) });
    expect(r.success).toBe(true);
    expect(r.data!.question.length).toBeLessThanOrEqual(300);
  });

  it('a schema error from the model goes to the repair round instead of failing the playtest', async () => {
    const h = await createHarness();
    try {
      const usage: AiUsage = { model: 'test', tokensIn: 1, tokensOut: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, ms: 1, fellBack: false };
      const prompts: string[] = [];
      let n = 0;
      const ai = {
        model: 'test',
        structured: (call: { user: string }) => {
          prompts.push(call.user);
          n++;
          const done =
            n === 1
              ? Promise.reject(new AiOutputError('glitch.scenario output did not match the schema: Too big: expected number to be <=60000', usage))
              : Promise.resolve({
                  value: {
                    steps: [
                      { call: 'start' },
                      { mark: 'a' },
                      { wait: 2000 },
                      { expect: 'state.score > marks.a.score', label: 'A1 score rises' },
                      { press: 'ArrowRight', ms: 400 },
                      { expect: 'state.x > marks.a.x', label: 'A2 right moves' },
                    ],
                  },
                  usage,
                });
          return { done, fields: (async function* () {})() };
        },
      } as unknown as AiClient;
      const ctx = { ...h.ctx(), agents: { ai } as unknown as AgentServices };
      const spec = { title: 'Test', controls: ['ArrowRight'] } as unknown as GameSpec;
      const res = await writeScenario(ctx, { html: starterHtml(), spec, acceptance: A, probeLines: [] });
      expect(res.steps).toHaveLength(6);
      expect(n).toBe(2);
      expect(prompts[1]).toMatch(/did not match the schema/);
    } finally {
      await h.close();
    }
  });
});

describe('auto-fix round limit', () => {
  it(`fixes automatically ${MAX_AUTO_FIX_ROUNDS} times, then asks the crew`, () => {
    expect([0, 1, 2, 3].map(afterFail)).toEqual(['autofix', 'autofix', 'ask_crew', 'ask_crew']);
    expect(fixRoundOf({ meta: { reason: 'fix', fixRound: 2 } })).toBe(2);
    expect(fixRoundOf({ meta: { reason: 'change', fixRound: 2 } })).toBe(0);
    expect(fixRoundOf({ meta: {} })).toBe(0);
  });
});

describe('frame rate is advisory in the worker', () => {
  it('a low frame rate alone never fails a version, but goes to Forge with real failures', () => {
    const slow = { name: 'frame rate >= 30 fps', pass: false, detail: '22 fps', kind: 'generic' as const, advisory: true };
    const dead = { name: 'key Space has an effect', pass: false, detail: 'no change', kind: 'generic' as const };
    expect(failuresForForge({ failed: [dead], checks: [slow, dead] })).toEqual(['key Space has an effect: no change', 'frame rate >= 30 fps: 22 fps']);
  });
});

describe('publish permissions', () => {
  it('owner and approver may Allow/Block; members and agents never', () => {
    const human = { isAgent: false };
    expect(canDecidePublish(human, 'owner')).toBe(true);
    expect(canDecidePublish(human, 'approver')).toBe(true);
    expect(canDecidePublish(human, 'member')).toBe(false);
    expect(canDecidePublish(human, null)).toBe(false);
    expect(canDecidePublish({ isAgent: true }, 'owner')).toBe(false);
  });
});

describe('playtest -> auto-fix -> publish gate (server flow)', () => {
  let h: Harness;
  const pt = stubPlaytester(false);
  let asha: { cookie: string; id: string };
  let riya: { cookie: string; id: string };
  let channelId: string;
  const post = (url: string, cookie: string, payload?: object) =>
    h.app.inject({ method: 'POST', url, headers: { cookie, origin: WEB }, ...(payload && { payload }) });
  const sends = (type: string) => h.calls.filter((c: NexconnCall) => c.path === '/v4/group-channel/message/send' && c.body.messageType === type);
  const cardOf = async (gameId: string, kind: string, version: number) =>
    (
      await h.db
        .select()
        .from(cards)
        .where(and(eq(cards.gameId, gameId), eq(cards.cardType, kind), eq(cards.version, version)))
    )[0]!;

  beforeAll(async () => {
    h = await createHarness({ agents: true, builds: true, playtester: pt, env: { FAKE_AGENTS: '1', PUBLIC_API_ORIGIN: 'https://api.test' } });
    asha = await signUp(h, 'Asha', '10.4.0.1');
    riya = await signUp(h, 'Riya', '10.4.0.2');
    const created = await post('/api/crews', asha.cookie, { name: 'Glitch Crew' });
    channelId = created.json().crew.groupChannelId;
    expect((await post(`/api/invites/${created.json().crew.inviteCode}/join`, riya.cookie)).statusCode).toBe(200);
  }, 60_000);
  afterAll(() => h.close());

  it('runs end to end', async () => {
    await h.webhook('message:send', [
      {
        userId: asha.id,
        channelId,
        channelType: 3,
        messageType: 'RC:TxtMsg',
        content: JSON.stringify({ content: '@pixel a chai cup dodging potholes', mentionedInfo: { type: 2, userIdList: ['agentpixel'] } }),
        time: (h.now.t += 1000),
        messageId: 'GLITCH-1',
        os: 'Websocket',
      },
    ]);
    await h.settle();
    const plan = JSON.parse(String(sends(CARD_MESSAGE_TYPES.plan).at(-1)!.body.content)) as PlanCardContent;
    const [pc] = await h.db
      .select()
      .from(cards)
      .where(and(eq(cards.gameId, plan.gameId), eq(cards.cardType, 'plan')));
    expect((await post(`/api/cards/${pc!.nexconnMessageId}/approve`, asha.cookie)).statusCode).toBe(200);
    await h.settle();

    // v1 FAILs, Glitch hands it to Forge twice (v2, v3), then stops and asks the crew.
    const gameId = plan.gameId;
    const tests = sends(CARD_MESSAGE_TYPES.test).map(c => JSON.parse(String(c.body.content)) as TestCardContent);
    expect(tests.map(t => [t.version, t.pass, t.round])).toEqual([
      [1, false, 0],
      [2, false, 1],
      [3, false, 2],
    ]);
    expect(tests[0]!.items.map(i => i.id)).toEqual(expect.arrayContaining(['A1']));
    expect(sends(CARD_MESSAGE_TYPES.test).map(c => (c.body.metadata as Record<string, string>).next)).toEqual(['autofix', 'autofix', 'ask_crew']);
    const [g] = await h.db.select().from(games).where(eq(games.id, gameId));
    expect(g!.status).toBe('failed');
    const v3 = await h.db
      .select()
      .from(gameVersions)
      .where(and(eq(gameVersions.gameId, gameId), eq(gameVersions.version, 3)));
    expect(v3[0]).toMatchObject({
      status: 'failed',
      gifPath: expect.stringContaining('/v3/play.gif'),
      screenshotPath: expect.stringContaining('/v3/shot.png'),
    });
    expect(sends(CARD_MESSAGE_TYPES.publish)).toHaveLength(0);

    // A member asks for a fix: v4 (round 0) passes and Glitch requests publishing.
    pt.pass = true;
    const t3 = await cardOf(gameId, 'test', 3);
    const fix = await post(`/api/cards/${t3.nexconnMessageId}/fix`, riya.cookie);
    expect(fix.statusCode).toBe(200);
    expect(fix.json().version).toBe(4);
    await h.settle();
    expect((await post(`/api/cards/${t3.nexconnMessageId}/fix`, riya.cookie)).statusCode).toBe(409);
    const pub = await cardOf(gameId, 'publish', 4);
    expect((await h.db.select().from(games).where(eq(games.id, gameId)))[0]!.status).toBe('awaiting_approval');

    // Publish gate: a member cannot Allow; the owner can, once.
    expect((await post(`/api/cards/${pub.nexconnMessageId}/publish`, riya.cookie, { decision: 'allow' })).statusCode).toBe(403);
    const ok = await post(`/api/cards/${pub.nexconnMessageId}/publish`, asha.cookie, { decision: 'allow' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().metadata).toMatchObject({ status: 'approved', decidedBy: 'Asha' });
    expect((await post(`/api/cards/${pub.nexconnMessageId}/publish`, asha.cookie, { decision: 'block' })).statusCode).toBe(409);
    const [after] = await h.db.select().from(games).where(eq(games.id, gameId));
    expect(after).toMatchObject({ status: 'published', publishedVersion: 4 });

    // The public page plays v4 with the screenshot; the clip is served publicly.
    const page = (await h.app.inject({ method: 'GET', url: `/api/public/games/${after!.slug}` })).json();
    expect(page.playUrl).toContain(`/play/${after!.slug}/v/4`);
    expect(page.screenshotUrl).toBe(`https://api.test/clips/${after!.slug}/v4/shot.png`);
    const shot = await h.app.inject({ method: 'GET', url: `/clips/${after!.slug}/v4/shot.png` });
    expect(shot.statusCode).toBe(200);
    expect(shot.headers['content-type']).toBe('image/png');

    const acts = (await h.db.select({ a: ledger.action }).from(ledger).where(eq(ledger.gameId, gameId))).map(r => r.a);
    expect(acts.filter(a => a === 'test.failed')).toHaveLength(3);
    expect(acts).toEqual(expect.arrayContaining(['test.passed', 'publish.requested', 'publish.approved']));
  }, 120_000);
});
