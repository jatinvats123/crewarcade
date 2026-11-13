// pnpm --filter @crewarcade/engine playtest <slug> <N> [--games <dir>] [--only repro-1.json] [--fast] [--out <dir>]
// Plays <games>/<slug>/v<N>/index.html headlessly with its scenario.json, saved repros (hard) and
// earlier scenarios (advisory). --only runs one scenario file from the version folder (bug repro or
// probe). --out writes playtest.json + screenshot.png there. Exit 0 = PLAYTEST PASS.
import fs from 'node:fs';
import path from 'node:path';
import { loadVersion, readScenarioFile } from '../disk';
import { playtest, playtestReport, type PlaytestInput } from '../playtest';
import { versionDir } from '../versions';
import { die, flag, gamesDir, positionals, versionArg } from './args';

const USAGE = 'Usage: playtest <slug> <N> [--games <dir>] [--only <file.json>] [--fast] [--out <dir>]';
const argv = process.argv.slice(2);
const [slug, nArg] = positionals(argv, ['--games', '--only', '--out']);
if (!slug) die(USAGE, 2);
const n = versionArg(nArg, USAGE);
const games = gamesDir(argv);
const only = flag(argv, '--only');
if (only !== null && !/^[\w.-]+\.json$/.test(only)) die('--only takes a file name in the version folder, e.g. repro-1.json', 2);
const out = flag(argv, '--out');

let input: PlaytestInput;
try {
  input = loadVersion(games, slug, n);
} catch (e) {
  die((e as Error).message);
}
if (only) {
  const ref = readScenarioFile(path.join(versionDir(games, slug, n), only), only.replace(/\.json$/, ''), n);
  if (!ref.steps) die(`${slug}/v${n}/${only}: ${ref.error ?? 'not found'}`);
  input = { ...input, only: ref };
}
const result = await playtest({ ...input, profile: argv.includes('--fast') ? 'fast' : 'full' });
if (out && !only) {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'playtest.json'), JSON.stringify(playtestReport(result), null, 2) + '\n');
  if (result.screenshot) fs.writeFileSync(path.join(out, 'screenshot.png'), result.screenshot);
}
console.log(result.summary);
process.exit(result.pass ? 0 : 1);
