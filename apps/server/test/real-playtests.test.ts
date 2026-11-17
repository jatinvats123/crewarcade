// Integration: Glitch playtests the 3 real Phase 3 builds (apps/server/.data/real-builds) for real:
// headless Chromium, the game in <iframe sandbox="allow-scripts">, GIF + screenshot. No new paid
// builds: Forge's v1 output is the saved game's own code, Glitch's scenario comes from the FAKE
// client, and any automatic fix is the FAKE Forge. Each game ends PASS -> publish request -> Allow
// -> published, or (after 2 automatic fixes) the crew is asked. Prints the Phase 4 metrics
// (playtest time, first-try pass rate, auto-fix rounds). Slow (~7 min): runs with REAL_PLAYTESTS=1
// and only where the saved builds exist (they are local, not committed):
//   REAL_PLAYTESTS=1 pnpm --filter @crewarcade/server exec vitest run test/real-playtests.test.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gameRegion } from '@crewarcade/engine';
import { CARD_MESSAGE_TYPES, type PlanCardContent, type TestCardContent } from '@crewarcade/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHeadless } from '../src/agents/smoke';
import type { AiClient, StructuredCall } from '../src/ai/claude';
import { createFakeAiClient } from '../src/ai/fake';
import { cards, games } from '../src/db/schema';
import { createHarness, signUp, WEB, type Harness, type NexconnCall } from './harness';

const DIR = path.resolve(__dirname, '../.data/real-builds');
const GAMES = [
  { file: 'chai-scooter-dash.html', pitch: '@pixel a chai cup on a scooter dodging potholes' },
  { file: 'ice-delivery.html', pitch: '@pixel deliver ice blocks before they melt' },
  { file: 'real-build.html', pitch: '@pixel दिवाली पर पटाखों से बचती बिल्ली' },
].filter(g => existsSync(path.join(DIR, g.file)));

/** FAKE client whose next v1 build returns a saved real game's code. */
function savedBuildAi(): AiClient & { nextCode: string | null } {
  const inner = createFakeAiClient({ speed: 0 });
  const me = {
    model: 'fake',
    nextCode: null as string | null,
    structured<T>(call: StructuredCall<T>) {
      const run = inner.structured(call);
      const code = me.nextCode;
      if (call.purpose !== 'forge.build' || !code) return run;
      me.nextCode = null;
      return { fieldChunks: run.fieldChunks, done: run.done.then(r => ({ ...r, value: { ...(r.value as object), code } as T })) };
    },
    streamText: inner.streamText.bind(inner),
  };
  return me;
}

describe.skipIf(GAMES.length === 0 || process.env.REAL_PLAYTESTS !== '1')('Glitch playtests the saved real builds', () => {
  let h: Harness;
  const headless = createHeadless();
  const ai = savedBuildAi();
  let asha: { cookie: string; id: string };
  let channelId: string;
  const post = (url: string, cookie: string, payload?: object) =>
    h.app.inject({ method: 'POST', url, headers: { cookie, origin: WEB }, ...(payload && { payload }) });
  const sends = (type: string) => h.calls.filter((c: NexconnCall) => c.path === '/v4/group-channel/message/send' && c.body.messageType === type);

  beforeAll(async () => {
    h = await createHarness({
      agents: true,
      builds: true,
      playtester: headless.playtester,
      ai,
      env: { FAKE_AGENTS: '1', PUBLIC_API_ORIGIN: 'https://api.test' },
    });
    asha = await signUp(h, 'Asha', '10.5.0.1');
    channelId = (await post('/api/crews', asha.cookie, { name: 'Real Builds' })).json().crew.groupChannelId;
  }, 60_000);
  afterAll(async () => {
    await h.close();
    await headless.close();
  });

  it('every game ends PASS -> published, or asks the crew after 2 automatic fixes', async () => {
    const rows: Array<{ game: string; firstTry: boolean; rounds: number; published: boolean; seconds: number[]; fps: number[] }> = [];
    let n = 0;
    for (const g of GAMES) {
      ai.nextCode = gameRegion(readFileSync(path.join(DIR, g.file), 'utf8'));
      const before = sends(CARD_MESSAGE_TYPES.test).length;
      await h.webhook('message:send', [
        {
          userId: asha.id,
          channelId,
          channelType: 3,
          messageType: 'RC:TxtMsg',
          content: JSON.stringify({ content: g.pitch, mentionedInfo: { type: 2, userIdList: ['agentpixel'] } }),
          time: (h.now.t += 1000),
          messageId: `REAL-${++n}`,
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

      const tests = sends(CARD_MESSAGE_TYPES.test)
        .slice(before)
        .map(c => JSON.parse(String(c.body.content)) as TestCardContent);
      const last = tests.at(-1)!;
      rows.push({
        game: g.file,
        firstTry: tests[0]!.pass,
        rounds: tests.length - 1,
        published: last.pass,
        seconds: tests.map(t => t.seconds ?? 0),
        fps: tests.map(t => t.fps),
      });
      for (const t of tests.filter(x => !x.pass)) console.log(`  ${g.file} v${t.version} FAIL:`, t.failures.map(f => f.label).join(' | '));
      expect(tests.length).toBeLessThanOrEqual(3);
      expect(last.gifUrl).toMatch(/\/play\.gif$/);
      if (!last.pass) {
        // Automatic fixes used up: the crew decides; nothing was published.
        expect(tests.map(t => t.round)).toEqual([0, 1, 2]);
        const [failed] = await h.db.select().from(games).where(eq(games.id, plan.gameId));
        expect(failed).toMatchObject({ status: 'failed', publishedVersion: null });
        continue;
      }

      const [pub] = await h.db
        .select()
        .from(cards)
        .where(and(eq(cards.gameId, plan.gameId), eq(cards.cardType, 'publish')));
      expect((await post(`/api/cards/${pub!.nexconnMessageId}/publish`, asha.cookie, { decision: 'allow' })).statusCode).toBe(200);
      const [game] = await h.db.select().from(games).where(eq(games.id, plan.gameId));
      expect(game).toMatchObject({ status: 'published', publishedVersion: last.version });
      expect(h.clips.objects.has(`${game!.slug}/v${last.version}/shot.png`)).toBe(true);
    }
    const all = rows.flatMap(r => r.seconds);
    const metrics = {
      rows,
      avgPlaytestS: +(all.reduce((a, b) => a + b, 0) / all.length).toFixed(1),
      firstTryPass: `${rows.filter(r => r.firstTry).length}/${rows.length}`,
    };
    writeFileSync(path.join(DIR, '..', 'playtest-metrics.json'), JSON.stringify(metrics, null, 2));
    console.log('PLAYTEST METRICS', JSON.stringify(metrics));
  }, 900_000);
});
