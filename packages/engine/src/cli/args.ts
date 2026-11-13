// Tiny argv helpers shared by the engine CLIs.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_GAMES = path.join(PACKAGE_ROOT, 'fixtures', 'games');

export function die(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
}

/** Value after a flag (`--games dir`), or null when the flag is absent. */
export function flag(argv: string[], name: string): string | null {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  const v = argv[i + 1];
  if (!v || v.startsWith('--')) die(`${name} needs a value`, 2);
  return v;
}

/** Positional args (everything that is not a flag or a flag's value). */
export function positionals(argv: string[], valued: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (valued.includes(a)) i++;
    else if (!a.startsWith('--')) out.push(a);
  }
  return out;
}

export const gamesDir = (argv: string[]) => path.resolve(flag(argv, '--games') ?? DEFAULT_GAMES);

export function versionArg(v: string | undefined, usage: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) die(usage, 2);
  return n;
}
