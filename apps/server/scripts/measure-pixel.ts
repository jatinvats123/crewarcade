// Measures real Claude cost and time for Pixel's plan step: 5 pitches (English, Hindi, Hinglish)
// through the exact production prompt, schema, effort and wrapper (no Nexconn, no database).
// Spends real money (roughly a few cents per pitch). Needs ANTHROPIC_API_KEY.
//   pnpm --filter @crewarcade/server measure:pixel            # all 5
//   pnpm --filter @crewarcade/server measure:pixel -- --json  # machine-readable
import { normalizePlan, detectLanguage, PixelPlanOutput, baseSlug } from '../src/agents/plan';
import { PIXEL_SYSTEM, planRequest } from '../src/agents/prompts';
import { createClaudeClient, type AiUsage } from '../src/ai/claude';

const PITCHES: Array<{ who: string; text: string }> = [
  { who: 'Asha', text: 'a chai cup on a scooter dodging potholes' },
  { who: 'Riya', text: 'a penguin who delivers pizza across icy rooftops' },
  { who: 'Kabir', text: 'ek cricket ball jo traffic mein auto rickshaws se bachta hai' },
  { who: 'Meera', text: 'दिवाली की रात पटाखे पकड़ने वाली एक बिल्ली' },
  { who: 'Sam', text: 'make Flappy Bird but with a mango' },
];

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error('ANTHROPIC_API_KEY is not set. Put it in apps/server/.env (never commit it) and run again.');
  process.exit(1);
}
const model = process.env.ANTHROPIC_MODEL ?? 'claude-opus-5-5';
const ai = createClaudeClient({ apiKey: key, model, timeoutMs: 180_000 });

interface Row {
  pitch: string;
  title: string;
  checks: number;
  valid: boolean;
  firstIntroMs: number | null;
  usage: AiUsage;
}
const rows: Row[] = [];

for (const p of PITCHES) {
  const language = detectLanguage(p.text);
  const user = planRequest({ pitcher: p.who, pitch: p.text, language, memory: ['likes Indian everyday themes'], chat: [] });
  const t0 = performance.now();
  const run = ai.structured({
    purpose: 'pixel.plan',
    system: PIXEL_SYSTEM,
    user,
    schema: PixelPlanOutput,
    streamField: 'intro',
    effort: 'medium',
    maxTokens: 16_000,
  });
  let firstIntroMs: number | null = null;
  let intro = '';
  for await (const piece of run.fieldChunks) {
    firstIntroMs ??= Math.round(performance.now() - t0);
    intro += piece;
  }
  try {
    const { value, usage } = await run.done;
    let valid = true;
    let checks = value.acceptance.length;
    try {
      const { card } = normalizePlan(value, {
        gameId: 'gMeasure',
        planVersion: 1,
        slug: baseSlug(value.title, 'game-measure'),
        language: language.code,
        credits: [p.who],
      });
      checks = card.acceptance.length;
    } catch {
      valid = false;
    }
    rows.push({ pitch: p.text, title: value.title, checks, valid, firstIntroMs, usage });
    if (!process.argv.includes('--json'))
      console.log(
        `${value.title.padEnd(28)} ${String(usage.tokensIn).padStart(6)} in (${usage.cacheReadTokens} cached) ${String(usage.tokensOut).padStart(6)} out  $${usage.costUsd.toFixed(4)}  ${(usage.ms / 1000).toFixed(1)} s  intro after ${firstIntroMs ? (firstIntroMs / 1000).toFixed(1) : '-'} s  ${checks} checks${valid ? '' : ' INVALID'}  "${intro.slice(0, 60)}"`,
      );
  } catch (e) {
    console.error(`FAILED for "${p.text}": ${(e as Error).message}`);
  }
}

const n = rows.length || 1;
const avg = (f: (r: Row) => number) => rows.reduce((s, r) => s + f(r), 0) / n;
const summary = {
  model,
  plans: rows.length,
  avgCostUsd: Number(avg(r => r.usage.costUsd).toFixed(4)),
  avgSeconds: Number((avg(r => r.usage.ms) / 1000).toFixed(1)),
  avgFirstIntroSeconds: Number((avg(r => r.firstIntroMs ?? 0) / 1000).toFixed(1)),
  avgTokensIn: Math.round(avg(r => r.usage.tokensIn)),
  avgTokensOut: Math.round(avg(r => r.usage.tokensOut)),
  cacheHitRate: Number(
    (
      rows.reduce((s, r) => s + r.usage.cacheReadTokens, 0) /
      Math.max(
        1,
        rows.reduce((s, r) => s + r.usage.tokensIn, 0),
      )
    ).toFixed(2),
  ),
  allValid: rows.every(r => r.valid),
  rows,
};
if (process.argv.includes('--json')) console.log(JSON.stringify(summary, null, 2));
else
  console.log(
    `\n${summary.plans} plans on ${model}: average $${summary.avgCostUsd} and ${summary.avgSeconds} s per plan (intro starts after ${summary.avgFirstIntroSeconds} s); ${summary.avgTokensIn} tokens in, ${summary.avgTokensOut} out; cache hit rate ${summary.cacheHitRate}.`,
  );
