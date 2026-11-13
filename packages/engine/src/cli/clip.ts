// pnpm --filter @crewarcade/engine clip <slug> <N> [--repro repro-<k>.json [--vs <M>]] [--games <dir>] [--title <t>] [--out <file.gif>]
//   clip:   ~6 s of the playtester playing v<N>
//   repro:  the bug repro replayed on v<N> (red = bug on camera, green = passes)
//   --vs M: the same repro on v<M> (left) and v<N> (right)
// Writes the GIF to --out (default: <tmp>/crewarcade-clips/<slug>-v<N>-<kind>.gif) and prints the path.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clip, type ClipInput } from '../clip';
import { findRepro } from '../disk';
import { versionDir } from '../versions';
import { die, flag, gamesDir, positionals, versionArg } from './args';

const USAGE = 'Usage: clip <slug> <N> [--repro repro-<k>.json [--vs <M>]] [--games <dir>] [--title <t>] [--out <file.gif>]';
const argv = process.argv.slice(2);
const [slug, nArg] = positionals(argv, ['--games', '--repro', '--vs', '--out', '--title']);
if (!slug) die(USAGE, 2);
const n = versionArg(nArg, USAGE);
const games = gamesDir(argv);
const reproName = flag(argv, '--repro');
const vsArg = flag(argv, '--vs');
const m = vsArg === null ? null : versionArg(vsArg, '--vs takes a version number');
if (m !== null && (!reproName || m === n)) die('--vs <M> needs --repro and another version number', 2);
const title = flag(argv, '--title') ?? slug;
const side = (v: number) => {
  const file = path.join(versionDir(games, slug, v), 'index.html');
  if (!fs.existsSync(file)) die(`${slug}/v${v}/index.html does not exist`);
  return { html: fs.readFileSync(file, 'utf8'), version: v };
};

let input: ClipInput;
if (!reproName) input = { kind: 'clip', title, game: side(n) };
else {
  const ref = findRepro(games, slug, reproName, [n, ...(m === null ? [] : [m])]);
  if (!ref?.steps) die(`${reproName}: ${ref?.error ?? 'not found in any version'}`);
  const repro = { name: reproName.replace(/\.json$/, ''), steps: ref.steps };
  input = m === null ? { kind: 'repro', title, game: side(n), repro } : { kind: 'fix', title, before: side(m), after: side(n), repro };
}
try {
  const res = await clip(input);
  const out = path.resolve(flag(argv, '--out') ?? path.join(os.tmpdir(), 'crewarcade-clips', `${slug}-v${n}-${input.kind}.gif`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, res.gif);
  console.log(`${res.summary}\n${out}`);
} catch (e) {
  die(`CLIP FAILED: ${(e as Error).message.split('\n')[0]}`);
}
