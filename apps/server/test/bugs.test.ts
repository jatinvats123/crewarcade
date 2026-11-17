// Integration (Phase 5): one planted bug, end to end, with real headless Chromium. The game is the
// penguin-slide fixture with the eval's `collision-disabled` mutant as v1 (no new Forge build for the
// original: Forge's v1 output is the mutated code, and its hotfix output is the clean fixture).
// A player reports the bug with a screenshot -> Glitch's repro FAILS on v1 (reproduced, repro GIF)
// -> Forge's hotfix v2 -> Glitch replays every repro: it passes -> hotfix publish card with the
// side-by-side GIF -> only the owner can Allow -> bug fixed, bug hunter credited on /g.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gameRegion } from '@crewarcade/engine';
import { CARD_MESSAGE_TYPES, type BugCardContent, type PlanCardContent, type PublishCardContent } from '@crewarcade/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mutants from '../../../packages/engine/eval/mutants/penguin-slide';
import { createHeadless, type Playtester } from '../src/agents/smoke';
import type { AiClient, StructuredCall } from '../src/ai/claude';
import { createFakeAiClient } from '../src/ai/fake';
import { bugs, cards, gameVersions, ledger } from '../src/db/schema';
import { createHarness, signUp, WEB, type Harness, type NexconnCall } from './harness';

const CLEAN = readFileSync(path.resolve(__dirname, '../../../packages/engine/fixtures/games/penguin-slide/v2/index.html'), 'utf8');
const MUTANT = mutants.find(m => m.id === 'penguin-slide-collision-disabled')!;
const BUGGY = MUTANT.apply(CLEAN);
const REPRO = {
  steps: [{ call: 'start' }, { wait: 10_000 }, { expect: "state.scene === 'over'", label: 'running into a snowman should end the run' }],
  question: 'What were you doing when it happened?',
};
// 1x1 PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** FAKE client: Forge's v1 = the mutant, its hotfix = the clean fixture; Glitch's repro is fixed; images are recorded. */
function plantedAi(): AiClient & { images: number } {
  const inner = createFakeAiClient({ speed: 0 });
  const me = {
    model: 'fake',
    images: 0,
    structured<T>(call: StructuredCall<T>) {
      if (call.images?.length) me.images++;
      if (call.purpose === 'glitch.repro') {
        const value = REPRO as T;
        const usage = { model: 'fake', tokensIn: 0, tokensOut: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, ms: 1, fellBack: false };
        return { fieldChunks: (async function* () {})(), done: Promise.resolve({ value, usage }) };
      }
      const run = inner.structured(call);
      if (call.purpose !== 'forge.build') return run;
      const hotfix = /Hotfix BUG/.test(String((call.hint as { change?: string } | undefined)?.change ?? ''));
      const code = gameRegion(hotfix ? CLEAN : BUGGY);
      return { fieldChunks: run.fieldChunks, done: run.done.then(r => ({ ...r, value: { ...(r.value as object), code } as T })) };
    },
    streamText: inner.streamText.bind(inner),
  };
  return me;
}

/** Real Chromium, except v1's full playtest (the saved build counts as playtested: it only needs to reach the crew). */
function firstPlaytestStubbed(real: Playtester): Playtester {
  let full = 0;
  return {
    async playtest(input) {
      if (input.only || ++full > 1) return real.playtest(input);
      const r = await real.playtest({ ...input, only: { name: 'start', steps: [{ call: 'start' }, { wait: 500 }] } });
      return { ...r, pass: true, failed: [], checks: [] };
    },
    clip: (html, title) => real.clip(html, title),
    clipBug: input => real.clipBug(input),
  };
}

describe('planted bug -> report -> reproduced -> hotfix -> repro passes', () => {
  let h: Harness;
  const headless = createHeadless();
  const ai = plantedAi();
  let asha: { cookie: string; id: string };
  let riya: { cookie: string; id: string };
  let channelId: string;
  const post = (url: string, cookie: string, payload?: object) =>
    h.app.inject({ method: 'POST', url, headers: { cookie, origin: WEB }, ...(payload && { payload }) });
  const sends = (type: string) => h.calls.filter((c: NexconnCall) => c.path === '/v4/group-channel/message/send' && c.body.messageType === type);
  const metaSets = (messageId: string) =>
    h.calls
      .filter(c => c.path === '/v4/channel-type/message/metadata/set' && c.body.messageId === messageId)
      .map(c => c.body.metadata as Record<string, string>);

  beforeAll(async () => {
    h = await createHarness({
      agents: true,
      builds: true,
      ai,
      playtester: firstPlaytestStubbed(headless.playtester),
      env: { FAKE_AGENTS: '1', PUBLIC_API_ORIGIN: 'https://api.test' },
    });
    asha = await signUp(h, 'Asha', '10.6.0.1');
    riya = await signUp(h, 'Riya', '10.6.0.2');
    const created = await post('/api/crews', asha.cookie, { name: 'Bug Crew' });
    channelId = created.json().crew.groupChannelId;
    expect((await post(`/api/invites/${created.json().crew.inviteCode}/join`, riya.cookie)).statusCode).toBe(200);
  }, 60_000);
  afterAll(async () => {
    await h.close();
    await headless.close();
  });

  it('runs end to end', async () => {
    await h.webhook('message:send', [
      {
        userId: asha.id,
        channelId,
        channelType: 3,
        messageType: 'RC:TxtMsg',
        content: JSON.stringify({ content: '@pixel a penguin sliding past snowmen', mentionedInfo: { type: 2, userIdList: ['agentpixel'] } }),
        time: (h.now.t += 1000),
        messageId: 'BUGS-1',
        os: 'Websocket',
      },
    ]);
    await h.settle();
    const plan = JSON.parse(String(sends(CARD_MESSAGE_TYPES.plan).at(-1)!.body.content)) as PlanCardContent;
    const gameId = plan.gameId;
    const [pc] = await h.db
      .select()
      .from(cards)
      .where(and(eq(cards.gameId, gameId), eq(cards.cardType, 'plan')));
    expect((await post(`/api/cards/${pc!.nexconnMessageId}/approve`, asha.cookie)).statusCode).toBe(200);
    await h.settle();
    expect(sends(CARD_MESSAGE_TYPES.publish)).toHaveLength(1); // v1 reached the crew

    // Riya reports the bug from the player, with a phone screenshot.
    const rep = await post(`/api/games/${gameId}/bugs`, riya.cookie, {
      description: 'I crashed into a snowman and nothing happened, the run never ends',
      version: 1,
      screenshot: PNG,
    });
    expect(rep.statusCode).toBe(200);
    const { bugId, messageId: bugCardId } = rep.json() as { bugId: string; messageId: string };
    await h.settle();

    const bugCard = JSON.parse(String(sends(CARD_MESSAGE_TYPES.bug).at(-1)!.body.content)) as BugCardContent;
    expect(bugCard).toMatchObject({ bugId, reporterName: 'Riya', version: 1, screenshotUrl: `${WEB}/api/bugs/${bugId}/screenshot` });
    expect(ai.images).toBe(1); // Glitch saw the screenshot
    // Screenshot: crew members only.
    expect((await h.app.inject({ method: 'GET', url: `/api/bugs/${bugId}/screenshot`, headers: { cookie: riya.cookie } })).statusCode).toBe(200);
    const stranger = await signUp(h, 'Zed', '10.6.0.9');
    expect((await h.app.inject({ method: 'GET', url: `/api/bugs/${bugId}/screenshot`, headers: { cookie: stranger.cookie } })).statusCode).toBe(404);

    // Reproduced on v1 (the BUG check FAILS), on camera; the hotfix v2 passes every repro.
    const [bug] = await h.db.select().from(bugs).where(eq(bugs.id, bugId));
    expect(bug).toMatchObject({ status: 'reproduced', reproducedOnVersion: 1, hotfixVersion: 2, number: 1 });
    const meta = metaSets(bugCardId);
    expect(meta.map(m => m.phase)).toEqual(expect.arrayContaining(['repro', 'hotfix']));
    const slug = await gameSlug();
    expect(meta.find(m => m.status === 'reproduced')!.reproClipUrl).toBe(`https://api.test/clips/${slug}/v1/bug-1-repro.gif`);
    expect((await h.app.inject({ method: 'GET', url: `/clips/${slug}/v1/bug-1-repro.gif` })).headers['content-type']).toBe('image/gif');

    const [v2] = await h.db
      .select()
      .from(gameVersions)
      .where(and(eq(gameVersions.gameId, gameId), eq(gameVersions.version, 2)));
    expect(v2).toMatchObject({ status: 'passed' });
    expect(v2!.notes[0]).toBe('hotfix: I crashed into a snowman and nothing happened, the run never ends (bug hunter: Riya)');
    const report = v2!.playtest as { checks: Array<{ name: string; pass: boolean; kind: string }> };
    expect(report.checks.filter(c => c.kind === 'repro')).toEqual([expect.objectContaining({ name: expect.stringContaining('BUG 1:'), pass: true })]);

    const hotfixCard = JSON.parse(String(sends(CARD_MESSAGE_TYPES.publish).at(-1)!.body.content)) as PublishCardContent;
    expect(hotfixCard).toMatchObject({
      version: 2,
      hotfix: { bugId, hunter: 'Riya', fromVersion: 1, fixGifUrl: `https://api.test/clips/${slug}/v2/bug-1-fix.gif` },
    });
    expect((await h.app.inject({ method: 'GET', url: `/clips/${slug}/v2/bug-1-fix.gif` })).statusCode).toBe(200);

    // The Allow gate: the reporter (a member) cannot publish; the owner can. Then the bug is fixed.
    const [pub] = await h.db
      .select()
      .from(cards)
      .where(and(eq(cards.gameId, gameId), eq(cards.cardType, 'publish'), eq(cards.version, 2)));
    expect((await post(`/api/cards/${pub!.nexconnMessageId}/publish`, riya.cookie, { decision: 'allow' })).statusCode).toBe(403);
    expect((await post(`/api/cards/${pub!.nexconnMessageId}/publish`, asha.cookie, { decision: 'allow' })).statusCode).toBe(200);
    expect((await h.db.select().from(bugs).where(eq(bugs.id, bugId)))[0]).toMatchObject({ status: 'fixed', fixedInVersion: 2 });
    expect(metaSets(bugCardId).at(-1)).toMatchObject({ status: 'fixed', fixedInVersion: '2' });
    const page = (await h.app.inject({ method: 'GET', url: `/api/public/games/${slug}` })).json();
    expect(page.bugHunters).toEqual([{ name: 'Riya', bug: expect.stringContaining('snowman'), version: 2 }]);

    const acts = (await h.db.select({ a: ledger.action }).from(ledger).where(eq(ledger.gameId, gameId))).map(r => r.a);
    expect(acts).toEqual(expect.arrayContaining(['bug.reported', 'bug.reproduced', 'bug.hotfix_passed', 'publish.approved', 'bug.fixed']));

    async function gameSlug() {
      return JSON.parse(String(sends(CARD_MESSAGE_TYPES.publish)[0]!.body.content)).slug as string;
    }
  }, 300_000);
});
