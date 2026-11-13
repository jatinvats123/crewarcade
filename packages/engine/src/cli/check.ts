// pnpm --filter @crewarcade/engine check <file.html> | <slug> <N> [--games <dir>]
// Fast static check. Prints CHECK PASS or numbered problems; exit 0 = pass.
import fs from 'node:fs';
import path from 'node:path';
import { checkHtml, formatCheck } from '../check';
import { versionDir } from '../versions';
import { die, gamesDir, positionals, versionArg } from './args';

const USAGE = 'Usage: check <file.html> | check <slug> <N> [--games <dir>]';
const argv = process.argv.slice(2);
const [a, b] = positionals(argv, ['--games']);
if (!a) die(USAGE, 2);
const isFile = a.endsWith('.html');
const file = isFile ? path.resolve(a) : path.join(versionDir(gamesDir(argv), a, versionArg(b, USAGE)), 'index.html');
if (!fs.existsSync(file)) die(`${file} does not exist.`);
const result = checkHtml(fs.readFileSync(file, 'utf8'));
console.log(formatCheck(result, isFile ? path.basename(file) : `${a} v${b}`));
process.exit(result.pass ? 0 : 1);
