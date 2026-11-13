// Version helpers: the starter template, version numbering, hotfix notes, and the on-disk layout
// used by the CLIs and test fixtures:  <games>/<slug>/v<N>/{index.html, scenario.json, repro-<k>.json, NOTES.md}
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isSlug } from './slug';

/** Absolute path of starter/index.html, also when this module is bundled into another package. */
export function starterPath(): string {
  try {
    const pkg = createRequire(import.meta.url).resolve('@crewarcade/engine/package.json');
    const p = path.join(path.dirname(pkg), 'starter', 'index.html');
    if (fs.existsSync(p)) return p;
  } catch {
    /* fall through to the source-relative path */
  }
  return fileURLToPath(new URL('../starter/index.html', import.meta.url));
}

export const starterHtml = (): string => fs.readFileSync(starterPath(), 'utf8');

/** Next version number given the versions that exist (1 when none). */
export const nextVersion = (existing: readonly number[]): number => (existing.length ? Math.max(...existing) + 1 : 1);

/** Replaces the GAME region of a game (between the markers) with new code; engine stays intact. */
export function replaceGameRegion(html: string, gameCode: string): string {
  const START = '// === GAME START ===';
  const END = '// === GAME END ===';
  const a = html.indexOf(START);
  const b = html.indexOf(END);
  if (a < 0 || b < a) throw new Error('GAME START / GAME END markers are missing');
  return `${html.slice(0, a + START.length)}\n${gameCode.trim()}\n${html.slice(b)}`;
}

/** The GAME region's code (without the markers). */
export function gameRegion(html: string): string {
  const START = '// === GAME START ===';
  const a = html.indexOf(START);
  const b = html.indexOf('// === GAME END ===');
  if (a < 0 || b < a) throw new Error('GAME START / GAME END markers are missing');
  return html.slice(a + START.length, b).trim();
}

export interface Hotfix {
  bug: string;
  hunter: string;
}

/** Hotfix info from a version's notes, first bullet "- hotfix: <bug> (bug hunter: <name>)", or null. */
export function readHotfix(notes: string): Hotfix | null {
  const m = notes.match(/^\s*[-*]\s*hotfix:\s*(.*?)\s*(?:\(\s*bug hunter:\s*([^)]+?)\s*\))?\s*$/im);
  return m ? { bug: m[1] ?? '', hunter: m[2] ?? '' } : null;
}

// ---- on-disk layout (CLIs, fixtures)

export const versionDir = (gamesDir: string, slug: string, n: number) => path.join(gamesDir, slug, `v${n}`);

/** Sorted version numbers that exist for a game on disk, e.g. [1, 2]. */
export function listVersions(gamesDir: string, slug: string): number[] {
  const dir = path.join(gamesDir, slug);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^v\d+$/.test(d.name))
    .map(d => Number(d.name.slice(1)))
    .sort((a, b) => a - b);
}

/**
 * Creates <games>/<slug>/v<N+1>/index.html from the latest version, or from the starter.
 * With `from` (remixes) v1 starts from the latest version of another game. Returns N and the source.
 */
export function createVersion(gamesDir: string, slug: string, opts: { from?: string } = {}): { version: number; source: string } {
  if (!isSlug(slug)) throw new Error(`Bad slug "${slug}": use 3-30 chars of a-z, 0-9 and "-".`);
  const have = listVersions(gamesDir, slug);
  const n = nextVersion(have);
  let file: string;
  let source: string;
  if (opts.from) {
    if (!isSlug(opts.from)) throw new Error(`Bad slug "${opts.from}".`);
    if (have.length) throw new Error(`--from is only for v1 of a remix, but ${slug} already has v${n - 1}.`);
    if (opts.from === slug) throw new Error('--from must name a different game.');
    const src = listVersions(gamesDir, opts.from);
    if (!src.length) throw new Error(`No versions of "${opts.from}" to remix.`);
    const last = src[src.length - 1]!;
    file = path.join(versionDir(gamesDir, opts.from, last), 'index.html');
    source = `${opts.from} v${last} (remix)`;
  } else if (have.length) {
    file = path.join(versionDir(gamesDir, slug, n - 1), 'index.html');
    source = `v${n - 1}`;
  } else {
    file = starterPath();
    source = 'starter';
  }
  if (!fs.existsSync(file)) throw new Error(`Missing source file: ${file}`);
  const dir = versionDir(gamesDir, slug, n);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(file, path.join(dir, 'index.html'));
  return { version: n, source };
}
