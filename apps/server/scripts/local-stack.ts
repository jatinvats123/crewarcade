// A throwaway local API on :8080 for UI checks without Docker or keys: the test harness (PGlite,
// real migrations, fake Nexconn, FAKE agents, memory queue and storage) with a real clock, plus a
// few local demo games (published, with scores) so /arcade, /g/<slug> and the player have data.
// Everything lives in memory and disappears on exit. Never points at a real database.
//   pnpm --filter @crewarcade/server exec tsx scripts/local-stack.ts
// Real chat (your Nexconn app, from apps/server/.env), run from apps/server:
//   LOCAL_REAL_NEXCONN=1 pnpm exec tsx --env-file=.env scripts/local-stack.ts
import { replaceGameRegion, starterHtml } from '@crewarcade/engine';
import { newId } from '@crewarcade/shared';
import { fakeGameRegion } from '../src/ai/fake-game';
import { games, gameVersions, scores } from '../src/db/schema';
import { gameHtmlKey } from '../src/storage';
import { createHarness, sessionFrom } from '../test/harness';

const PORT = Number(process.env.PORT ?? 8080);
// LOCAL_REAL_NEXCONN=1 (with the NEXCONN_* keys in the environment, e.g. --env-file=.env): real chat
// against your Nexconn app, so the web client connects. Data stays in memory here, but the users,
// crews and messages it creates are real in that Nexconn app. Agents only answer via webhooks, which
// Nexconn sends to the deployed server, so agents stay quiet locally.
const realNexconn =
  process.env.LOCAL_REAL_NEXCONN === '1'
    ? {
        appKey: required('NEXCONN_APP_KEY'),
        appSecret: required('NEXCONN_APP_SECRET'),
        baseUrls: [process.env.NEXCONN_API_BASE ?? 'https://api.sg-light-api.com', process.env.NEXCONN_API_BACKUP ?? 'https://api-b.sg-light-api.com'] as const,
      }
    : undefined;
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`LOCAL_REAL_NEXCONN=1 needs ${name} in the environment`);
  return v;
}
const h = await createHarness({
  agents: true,
  builds: true,
  ...(realNexconn && { realNexconn }),
  env: { WEB_ORIGIN: 'http://localhost:3000', PUBLIC_API_ORIGIN: `http://localhost:${PORT}` },
});
setInterval(() => (h.now.t = Date.now()), 50).unref();

const DEMO = [
  { title: 'Mango Rooftop Dash', pitch: 'A mango dodging crows on a rooftop.', emoji: '🥭', colors: ['#ffb547', '#2ec4b6'], hindi: false },
  { title: 'चाय की दौड़', pitch: 'चाय का कप स्कूटर पर गड्ढों से बचता है।', emoji: '☕', colors: ['#c2410c', '#fde68a'], hindi: true },
  {
    title: 'தமிழ் பட்டம் பறக்கும் விளையாட்டு',
    pitch: 'ஒரு பட்டம் காற்றில் பறந்து பறவைகளைத் தவிர்க்கிறது.',
    emoji: '🪁',
    colors: ['#7c5cff', '#22d3ee'],
    hindi: false,
  },
  {
    title: 'The Extraordinarily Long Penguin Pizza Delivery Across Icy Rooftops',
    pitch: 'A penguin delivers pizza across icy rooftops before it gets cold, while seagulls try to steal slices and the wind keeps changing direction.',
    emoji: '🐧',
    colors: ['#38bdf8', '#f472b6'],
    hindi: false,
  },
  {
    title: 'Auto Rickshaw Cricket 🏏🛺',
    pitch: 'Ek cricket ball jo traffic mein auto rickshaws se bachta hai.',
    emoji: '🏏',
    colors: ['#22c55e', '#facc15'],
    hindi: false,
  },
];

const WEB_LOCAL = 'http://localhost:3000';
const signupRes = await h.app.inject({
  method: 'POST',
  url: '/api/auth/guest',
  headers: { origin: WEB_LOCAL },
  payload: { displayName: 'Asha', avatarEmoji: '🦊', avatarColor: 'pink', referrer: 'demo' },
});
const owner = { id: signupRes.json().user.id as string, cookie: sessionFrom(signupRes) };
const crewRes = await h.app.inject({
  method: 'POST',
  url: '/api/crews',
  headers: { cookie: owner.cookie, origin: WEB_LOCAL },
  payload: { name: 'Chai Crew ☕ DU Gaming Society, Delhi' },
});
const crewId = crewRes.json().crew.id as string;
let i = 0;
for (const d of DEMO) {
  i++;
  const id = newId('game');
  const slug = `demo-${i}-game`;
  await h.db.insert(games).values({
    id,
    slug,
    crewId,
    title: d.title,
    pitch: d.pitch,
    createdBy: owner.id,
    status: 'published',
    publishedVersion: 1,
    language: d.hindi ? 'hi' : 'en',
  });
  const html = replaceGameRegion(starterHtml(), fakeGameRegion({ title: d.title, pitch: d.pitch, seed: i * 7919, hindi: d.hindi }));
  const htmlPath = await h.storage.put(gameHtmlKey(slug, 1), html, 'text/html; charset=utf-8');
  await h.db.insert(gameVersions).values({
    id: newId('version'),
    gameId: id,
    version: 1,
    spec: {},
    htmlPath,
    status: 'published',
    publishedAt: new Date(Date.now() - i * 3_600_000),
    notes: ['Catch the good stuff, dodge the rest.', 'Touch buttons on phones.'],
    meta: { emoji: d.emoji, colors: d.colors, orientation: 'portrait' },
  });
  for (let s = 0; s < 6 - i; s++)
    await h.db.insert(scores).values({ id: newId('score'), gameId: id, version: 1, userId: owner.id, score: 100 * (6 - i) + s * 37, timeMs: 30_000 });
}

await h.app.listen({ port: PORT, host: '127.0.0.1' });
console.log(
  `local stack on http://localhost:${PORT} (PGlite, ${realNexconn ? 'REAL Nexconn' : 'fake Nexconn'}, FAKE agents) with ${DEMO.length} demo games; demo slugs demo-1-game … demo-${DEMO.length}-game`,
);
