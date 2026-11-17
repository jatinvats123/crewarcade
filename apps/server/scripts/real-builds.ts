// Real Forge builds: 3 pitches (one Hindi) -> Pixel's plan (chat model) -> Forge's build loop
// (build model, the production prompt, static check + retries) -> a headless smoke playtest
// through the engine (starts, score increases). Prints build time, attempts, tokens and cost per
// build, all labelled with the model. Uses AI_PROVIDER from apps/server/.env (no Nexconn, no DB).
//   pnpm --filter @crewarcade/server real:builds            (writes HTML to .data/real-builds/)
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser, playtest, starterHtml } from '@crewarcade/engine';
import { createAi } from '../src/agents';
import { BuildCheckFailedError, runBuildLoop } from '../src/agents/forge';
import { createHeadless, SMOKE_STEPS } from '../src/agents/smoke';
import { AiUnavailableError } from '../src/ai/claude';
import { baseSlug, detectLanguage, normalizePlan, PixelPlanOutput } from '../src/agents/plan';
import { PIXEL_SYSTEM, planRequest } from '../src/agents/prompts';
import { loadConfig } from '../src/config';

const PITCHES = [
  { who: 'Asha', text: 'a chai cup on a scooter dodging potholes' },
  { who: 'Riya', text: 'a penguin who delivers pizza across icy rooftops' },
  { who: 'Meera', text: 'दिवाली की रात पटाखे पकड़ने वाली एक बिल्ली' },
];

const config = loadConfig({ ...process.env, FAKE_AGENTS: '0' });
const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const chat = createAi(config, log, 'chat');
const build = createAi(config, log, 'build');
if (!chat || !build) {
  console.error(`No AI key for AI_PROVIDER=${config.AI_PROVIDER}. Set it in apps/server/.env.`);
  process.exit(1);
}
const outDir = path.resolve('.data/real-builds');
await mkdir(outDir, { recursive: true });
const browser = await launchBrowser();
// Same as production (FORGE_SMOKE=1): Forge's loop plays each build before accepting it.
const forgeSmoke = createHeadless();

interface Row {
  pitch: string;
  title: string;
  model: string;
  ok: boolean;
  attempts: number;
  buildS: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  sizeKb: number;
  smoke: string;
  problems?: string[];
  /** Problems per attempt (static check + smoke), to see what the retries fixed. */
  attemptProblems?: string[][];
  /** Full engine playtest (Glitch's Phase 4 checks), for information. */
  fullPlaytest?: string;
  fps?: number;
}
const rows: Row[] = [];

for (const p of PITCHES) {
  const language = detectLanguage(p.text);
  // The free tier answers 503 "high demand" at peaks: be patient here (the client retries twice itself).
  let plan: Awaited<ReturnType<typeof planOnce>> | null = null;
  const planOnce = () =>
    chat.structured({
      purpose: 'pixel.plan',
      system: PIXEL_SYSTEM,
      user: planRequest({ pitcher: p.who, pitch: p.text, language, memory: [], chat: [] }),
      schema: PixelPlanOutput,
      effort: 'medium',
      maxTokens: 16_000,
    }).done;
  for (let i = 1; !plan; i++) {
    try {
      plan = await planOnce();
    } catch (e) {
      if (!(e instanceof AiUnavailableError) || i >= 6) throw e;
      console.log(`  (plan: model busy, waiting 20 s, try ${i + 1}/6)`);
      await new Promise(r => setTimeout(r, 20_000));
    }
  }
  const { spec } = normalizePlan(plan.value, {
    gameId: 'gReal',
    planVersion: 1,
    slug: baseSlug(plan.value.title, 'real-build'),
    language: language.code,
    credits: [p.who],
  });
  process.stdout.write(`${spec.title} (${language.code}) — planned by ${plan.usage.model}; building with ${build.model}… `);
  const t0 = performance.now();
  try {
    const r = await runBuildLoop({
      ai: build,
      baseHtml: starterHtml(),
      spec,
      version: 1,
      language: language.code,
      timeoutMs: config.BUILD_TIMEOUT_MS,
      smoke: forgeSmoke.smoke,
    });
    const buildS = (performance.now() - t0) / 1000;
    await writeFile(path.join(outDir, `${spec.slug}.html`), r.html);
    // The brief's smoke check (starts, score rises), plus the full engine playtest as a preview of
    // what Glitch will check in Phase 4 (reported separately, not part of the pass/fail here).
    const smoke = await playtest({ html: r.html, label: spec.slug, only: { name: 'smoke', steps: SMOKE_STEPS }, profile: 'fast', browser });
    const full = await playtest({ html: r.html, label: spec.slug, scenario: SMOKE_STEPS, profile: 'fast', browser });
    const failedChecks = smoke.checks.filter(c => !c.pass && !c.advisory).map(c => c.name);
    const fullIssues = full.checks.filter(c => !c.pass && !c.advisory).map(c => `${c.name}: ${String(c.detail).slice(0, 100)}`);
    rows.push({
      pitch: p.text,
      title: spec.title,
      model: r.usage.model,
      ok: true,
      attempts: r.attempts.length,
      buildS,
      tokensIn: r.usage.tokensIn,
      tokensOut: r.usage.tokensOut,
      costUsd: r.usage.costUsd,
      sizeKb: r.check.sizeBytes / 1024,
      smoke: smoke.pass ? 'PASS' : `FAIL (${failedChecks.slice(0, 4).join('; ')})`,
      attemptProblems: r.attempts.map(a => a.problems.map(x => x.slice(0, 160))),
      fullPlaytest: full.pass ? 'PASS' : `issues: ${fullIssues.slice(0, 4).join(' | ')}`,
      fps: full.fps,
    });
    console.log(`ok in ${buildS.toFixed(0)} s, ${r.attempts.length} attempt(s), smoke ${smoke.pass ? 'PASS' : 'FAIL'}`);
  } catch (e) {
    const buildS = (performance.now() - t0) / 1000;
    const failed = e instanceof BuildCheckFailedError;
    rows.push({
      pitch: p.text,
      title: spec.title,
      model: failed ? e.usage.model : build.model,
      ok: false,
      attempts: failed ? e.attempts.length : 0,
      buildS,
      tokensIn: failed ? e.usage.tokensIn : 0,
      tokensOut: failed ? e.usage.tokensOut : 0,
      costUsd: failed ? e.usage.costUsd : 0,
      sizeKb: 0,
      smoke: 'not run',
      problems: failed ? e.problems.slice(0, 5) : [(e as Error).message.slice(0, 200)],
    });
    console.log(`FAILED after ${buildS.toFixed(0)} s: ${failed ? e.problems.slice(0, 3).join(' | ') : (e as Error).message}`);
  }
}
await browser.close();
await forgeSmoke.close();

const n = rows.length || 1;
const avg = (f: (r: Row) => number) => rows.reduce((s, r) => s + f(r), 0) / n;
console.log(
  '\n' +
    JSON.stringify(
      {
        provider: config.AI_PROVIDER,
        buildModel: build.model,
        builds: rows.length,
        passedStaticCheck: rows.filter(r => r.ok).length,
        smokePass: rows.filter(r => r.smoke === 'PASS').length,
        fullPlaytestPass: rows.filter(r => r.fullPlaytest === 'PASS').length,
        avgBuildSeconds: Number(avg(r => r.buildS).toFixed(1)),
        retryRate: Number((rows.filter(r => r.attempts > 1).length / n).toFixed(2)),
        avgAttempts: Number(avg(r => r.attempts).toFixed(2)),
        avgTokensIn: Math.round(avg(r => r.tokensIn)),
        avgTokensOut: Math.round(avg(r => r.tokensOut)),
        avgCostUsd: Number(avg(r => r.costUsd).toFixed(4)),
        rows,
      },
      null,
      2,
    ),
);
