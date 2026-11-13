// Loads a game version from the on-disk layout into playtest input (CLIs, fixtures, eval).
// The server keeps the same pieces in Postgres + Storage and builds PlaytestInput directly.
import fs from 'node:fs';
import path from 'node:path';
import { parseScenario } from './scenario';
import type { PlaytestInput, ScenarioRef } from './playtest';
import { listVersions, versionDir } from './versions';

export const REPRO_FILE = /^repro-[\w-]+\.json$/;

/** Reads a scenario file. A missing file is { steps: null } with no error. */
export function readScenarioFile(file: string, name = path.basename(file, '.json'), version?: number): ScenarioRef {
  if (!fs.existsSync(file)) return { name, version, steps: null };
  const res = parseScenario(fs.readFileSync(file, 'utf8'));
  return res.ok ? { name, version, steps: res.steps } : { name, version, steps: null, error: res.error };
}

/** Everything a full playtest of <slug> v<n> needs: the game, its scenario, repros of v<=n, earlier scenarios. */
export function loadVersion(gamesDir: string, slug: string, n: number): PlaytestInput {
  const dir = versionDir(gamesDir, slug, n);
  const gameFile = path.join(dir, 'index.html');
  if (!fs.existsSync(gameFile)) throw new Error(`${slug}/v${n}/index.html does not exist.`);
  const scenario = readScenarioFile(path.join(dir, 'scenario.json'), 'scenario', n);
  const repros: ScenarioRef[] = [];
  const previous: ScenarioRef[] = [];
  for (const v of listVersions(gamesDir, slug).filter(v => v <= n)) {
    const vdir = versionDir(gamesDir, slug, v);
    for (const f of fs.readdirSync(vdir).filter(f => REPRO_FILE.test(f)).sort()) repros.push(readScenarioFile(path.join(vdir, f), undefined, v));
    if (v < n && fs.existsSync(path.join(vdir, 'scenario.json'))) previous.push(readScenarioFile(path.join(vdir, 'scenario.json'), 'scenario', v));
  }
  return {
    html: fs.readFileSync(gameFile, 'utf8'),
    label: `${slug} v${n}`,
    scenario: scenario.steps,
    ...(scenario.error && { scenarioError: scenario.error }),
    repros,
    previous,
  };
}

/** Finds a repro file by name in v<n>, then any other version (newest first). */
export function findRepro(gamesDir: string, slug: string, name: string, prefer: number[] = []): ScenarioRef | null {
  if (!REPRO_FILE.test(name)) throw new Error('A repro file name looks like repro-1.json');
  const order = [...prefer, ...listVersions(gamesDir, slug).reverse()].filter((v, i, a) => a.indexOf(v) === i);
  for (const v of order) {
    const file = path.join(versionDir(gamesDir, slug, v), name);
    if (fs.existsSync(file)) return readScenarioFile(file, undefined, v);
  }
  return null;
}
