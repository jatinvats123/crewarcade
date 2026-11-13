// pnpm --filter @crewarcade/engine eval [--fast] [--only <slug>[,<slug>]] [--kind <kind>] [--jobs N] [--strict] [--doc]
// Measures the playtester against planted bugs. For each fixture game: one clean run of its latest
// version plus one run per mutant from eval/mutants/<slug>.ts (format: eval/mutate.ts). Every run is
// a real playtest() (headless Chromium, fake clock, seed 42) with the game's own scenario and repros.
//   caught     = playtest FAIL on a mutant        missed = playtest PASS on a mutant (a finding)
//   false FAIL = playtest FAIL on a clean game    (exit 1)
// A run failing only "frame rate" is re-run once (CPU contention), except fps-killer mutants.
// --fast uses the playtester's fast profile (5 s random input, no advisory replays) for CI.
// --doc writes eval/RESULTS.md. Exit 1: a clean game FAILs, a mutant is invalid, a run errors,
// or (--strict) a mutant is missed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadVersion } from '../src/disk';
import { launchBrowser } from '../src/player';
import { playtest, type PlaytestInput, type PlaytestResult } from '../src/playtest';
import { listVersions } from '../src/versions';
import { KINDS, KIND_TEXT, validateMutants, type MutantKind, type ValidMutant } from './mutate';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, '..', 'fixtures', 'games');
const MUTANTS = path.join(HERE, 'mutants');
const USAGE = 'Usage: eval [--fast] [--only <slug>[,<slug>]] [--kind <kind>] [--jobs N] [--strict] [--doc]';

// ---- arguments
const argv = process.argv.slice(2);
const VALUED = ['--only', '--kind', '--jobs'];
const BOOL = ['--strict', '--doc', '--fast'];
const opts: Record<string, string | true> = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (BOOL.includes(a)) opts[a] = true;
  else if (VALUED.includes(a)) {
    const v = argv[++i];
    if (!v || v.startsWith('--')) usage(`${a} needs a value`);
    opts[a] = v;
  } else usage(`unknown argument "${a}"`);
}
function usage(msg: string): never {
  console.error(`${msg}\n${USAGE}\nKinds: ${KINDS.join(', ')}`);
  process.exit(2);
}
const allGames = fs.readdirSync(FIXTURES).filter(g => listVersions(FIXTURES, g).length).sort();
const games = typeof opts['--only'] === 'string' ? opts['--only'].split(',').map(s => s.trim()).filter(Boolean) : allGames;
for (const g of games) if (!allGames.includes(g)) usage(`no fixture game "${g}"`);
const kindFilter = typeof opts['--kind'] === 'string' ? (opts['--kind'] as MutantKind) : null;
if (kindFilter && !KINDS.includes(kindFilter)) usage(`unknown kind "${kindFilter}"`);
const jobsLimit = typeof opts['--jobs'] === 'string' ? Number(opts['--jobs']) : 3;
if (!Number.isInteger(jobsLimit) || jobsLimit < 1) usage('--jobs takes a positive integer');
const fast = !!opts['--fast'];
const strict = !!opts['--strict'];

// ---- load + validate mutants (an invalid mutant is reported and fails the eval, never dropped)
const invalid: Array<{ game: string; id: string; reason: string }> = [];
const evalErrors: string[] = [];
const mutants: ValidMutant[] = [];
const base: Record<string, PlaytestInput> = {};
for (const game of games) {
  const versions = listVersions(FIXTURES, game);
  base[game] = loadVersion(FIXTURES, game, versions[versions.length - 1]!);
  const file = path.join(MUTANTS, `${game}.ts`);
  if (!fs.existsSync(file)) {
    evalErrors.push(`${game}: no mutants file eval/mutants/${game}.ts`);
    continue;
  }
  let list: unknown;
  try {
    list = ((await import(pathToFileURL(file).href)) as { default: unknown }).default;
  } catch (e) {
    invalid.push({ game, id: path.basename(file), reason: `import failed: ${(e as Error).message}` });
    continue;
  }
  const res = validateMutants(game, base[game]!.html, list);
  invalid.push(...res.invalid.map(m => ({ game, ...m })));
  mutants.push(...res.valid.filter(m => !kindFilter || m.kind === kindFilter));
}

/** Run async jobs with at most `limit` at once (playtests are CPU-heavy; 3 is a good default). */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        results[k] = await fn(items[k]!);
      }
    }),
  );
  return results;
}

// ---- runs
interface Job {
  game: string;
  mutant: ValidMutant | null;
}
interface JobResult extends Job {
  status: 'pass' | 'fail' | 'error';
  failed: string[];
  total: number;
  seconds: number;
  detail?: string;
  rerun?: string;
}

const browser = await launchBrowser();
const runOne = async (job: Job): Promise<Omit<JobResult, keyof Job>> => {
  const input = base[job.game]!;
  let r: PlaytestResult;
  try {
    r = await playtest({ ...input, html: job.mutant ? job.mutant.html : input.html, browser, profile: fast ? 'fast' : 'full' });
  } catch (e) {
    return { status: 'error', failed: [], total: 0, seconds: 0, detail: (e as Error).message };
  }
  const hard = r.checks.filter(c => !c.advisory);
  return { status: r.pass ? 'pass' : 'fail', failed: r.failed.map(c => c.name), total: hard.length, seconds: r.seconds };
};
const fpsOnly = (r: { status: string; failed: string[] }) => r.status === 'fail' && r.failed.length > 0 && r.failed.every(n => /^frame rate/.test(n));

const jobs: Job[] = [...games.map(game => ({ game, mutant: null })), ...mutants.map(m => ({ game: m.game, mutant: m }))];
const T0 = Date.now();
let done = 0;
console.log(
  `eval${fast ? ' (fast)' : ''}: ${games.length} game(s), ${mutants.length} mutant(s)${kindFilter ? ` of kind ${kindFilter}` : ''}, ` +
    `${jobs.length} playtests, ${jobsLimit} at a time${invalid.length ? `; ${invalid.length} INVALID mutant(s)` : ''}`,
);
const results = await pool(jobs, jobsLimit, async (job): Promise<JobResult> => {
  let r = await runOne(job);
  if (fpsOnly(r) && job.mutant?.kind !== 'fps-killer') r = { ...(await runOne(job)), rerun: 'first run failed only frame rate; re-ran once' };
  const res = { ...job, ...r };
  const name = job.mutant ? job.mutant.id : `${job.game} (clean)`;
  const verdict = res.status === 'error' ? 'ERROR' : job.mutant ? (res.status === 'fail' ? 'caught' : 'MISSED') : res.status === 'pass' ? 'pass' : 'FALSE FAIL';
  const why = res.status === 'error' ? res.detail : res.failed.join('; ');
  console.log(`[${String(++done).padStart(2)}/${jobs.length}] ${name.padEnd(36)} ${verdict.padEnd(10)} ${res.seconds}s${res.rerun ? ' (rerun)' : ''}${why ? `  ${why}`.slice(0, 160) : ''}`);
  return res;
});
await browser.close();

// ---- tally
const clean = results.filter(r => !r.mutant);
const muts = results.filter(r => r.mutant);
const falseFails = clean.filter(r => r.status === 'fail');
const caught = muts.filter(r => r.status === 'fail');
const missed = muts.filter(r => r.status === 'pass');
for (const r of results.filter(r => r.status === 'error')) evalErrors.push(`${r.mutant ? r.mutant.id : `${r.game} (clean)`}: ${r.detail}`);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const headline = `Caught ${caught.length}/${muts.length} planted bugs · ${plural(falseFails.length, 'false FAIL')} on ${plural(clean.length, 'clean game')}`;
const minutes = ((Date.now() - T0) / 60000).toFixed(1);

if (opts['--doc']) {
  const cell = (s: unknown) => String(s ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
  const L: string[] = ['# Playtester eval: planted bugs', ''];
  L.push(`_Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by \`pnpm --filter @crewarcade/engine eval${fast ? ' --fast' : ''} --doc\` in ${minutes} min._`, '');
  L.push(`**${headline}**`, '');
  L.push(
    'Each fixture game gets planted bugs ("mutants", `eval/mutants/<slug>.ts`): small deterministic edits of the latest version, ' +
      `one per kind (${KINDS.map(k => `\`${k}\``).join(', ')}). Every mutant, and each clean game, is played by the real playtester ` +
      'with the game\'s own scenario and saved repros. A mutant is **caught** when the playtest FAILs; a clean game must PASS.',
    '',
  );
  L.push('## Clean games', '', '| game | result | failed checks | time |', '|---|---|---|---|');
  for (const r of clean) L.push(`| ${r.game} | ${r.status === 'pass' ? 'PASS' : r.status === 'fail' ? 'false FAIL' : 'error'} | ${cell(r.failed.join('; ')) || '-'} | ${r.seconds}s |`);
  L.push('');
  for (const kind of KINDS) {
    if (kindFilter && kind !== kindFilter) continue;
    const rows = muts.filter(r => r.mutant!.kind === kind);
    L.push(`## ${kind} (${rows.filter(r => r.status === 'fail').length}/${rows.length} caught)`, '', `_Planted: ${KIND_TEXT[kind]}._`, '');
    if (!rows.length) continue;
    L.push('| game | mutant | what was planted | result | caught by |', '|---|---|---|---|---|');
    for (const r of rows)
      L.push(`| ${r.game} | \`${cell(r.mutant!.id)}\` | ${cell(r.mutant!.description)} | ${r.status === 'fail' ? 'caught' : r.status === 'pass' ? 'MISSED' : 'error'} | ${cell(r.status === 'error' ? r.detail : r.failed.join('; ')) || '-'} |`);
    L.push('');
  }
  fs.writeFileSync(path.join(HERE, 'RESULTS.md'), L.join('\n'));
}

console.log('');
console.log(headline);
for (const r of falseFails) console.log(`  false FAIL ${r.game}: ${r.failed.join('; ')}`);
for (const r of missed) console.log(`  missed ${r.mutant!.id} (${r.mutant!.kind}): ${r.mutant!.description}`);
for (const m of invalid) console.log(`  INVALID ${m.game} ${m.id}: ${m.reason}`);
for (const e of evalErrors) console.log(`  ERROR ${e}`);
console.log(`${minutes} min${opts['--doc'] ? '; wrote eval/RESULTS.md' : ''}`);
process.exit(falseFails.length || invalid.length || evalErrors.length || (strict && missed.length) ? 1 : 0);
