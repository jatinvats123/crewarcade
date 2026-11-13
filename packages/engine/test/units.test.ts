import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameSpecSchema, acceptanceFor, specToMarkdown } from '../src/spec';
import { bugStepIndex, expectLabels, parseScenario, scenarioMs } from '../src/scenario';
import { isSlug, slugify } from '../src/slug';
import { createVersion, gameRegion, listVersions, nextVersion, readHotfix, replaceGameRegion, starterHtml } from '../src/versions';
import { loadVersion } from '../src/disk';

const FIXTURES = path.join(import.meta.dirname, '..', 'fixtures', 'games');

describe('slugs', () => {
  it('accepts kebab-case 3-30 chars only', () => {
    expect(isSlug('cat-vs-cucumbers')).toBe(true);
    for (const bad of ['ab', '-abc', 'abc-', 'ABC', 'a_b_c', 'x'.repeat(31)]) expect(isSlug(bad)).toBe(false);
  });
  it('slugifies titles', () => {
    expect(slugify('Cat vs. Cucumbers!')).toBe('cat-vs-cucumbers');
    expect(slugify('Café Rush')).toBe('cafe-rush');
    expect(slugify('🙂')).toBeNull();
    expect(isSlug(slugify('A very long title that keeps going and going'))).toBe(true);
  });
});

describe('scenarios', () => {
  it('parses arrays, {steps} objects and JSON text', () => {
    expect(parseScenario([{ call: 'start' }])).toEqual({ ok: true, steps: [{ call: 'start' }] });
    expect(parseScenario({ steps: [{ wait: 100 }] }).ok).toBe(true);
    expect(parseScenario('[{"press":"ArrowLeft","ms":200}]').ok).toBe(true);
  });
  it('rejects bad steps with the step number', () => {
    expect(parseScenario('not json')).toMatchObject({ ok: false });
    expect(parseScenario({})).toMatchObject({ ok: false, error: expect.stringMatching(/array of steps/) });
    expect(parseScenario([{ call: 'start' }, { press: 'Q' }])).toMatchObject({ ok: false, error: expect.stringMatching(/^step 2/) });
    expect(parseScenario([{ call: 'jump' }]).ok).toBe(false);
    expect(parseScenario([{ wait: 10, extra: 1 }]).ok).toBe(false);
  });
  it('measures game time and finds the bug check', () => {
    const steps = [
      { call: 'start' as const },
      { press: 'ArrowRight', ms: 500 },
      { press: 'Space' },
      { wait: 1000 },
      { expect: 'true', label: 'A1' },
      { expect: 'state.scene', label: 'BUG 1: x' },
      { expect: '1' },
    ];
    expect(scenarioMs(steps)).toBe(1600);
    expect(bugStepIndex(steps)).toBe(5);
    expect(bugStepIndex([{ expect: 'a' }, { expect: 'b' }])).toBe(1);
    expect(bugStepIndex([{ wait: 1 }])).toBe(-1);
    expect(expectLabels(steps)).toEqual(['A1', 'BUG 1: x', '1']);
  });
  it('parses every fixture scenario and repro', () => {
    for (const slug of fs.readdirSync(FIXTURES).filter(f => !f.includes('.')))
      for (const v of listVersions(FIXTURES, slug)) {
        const dir = path.join(FIXTURES, slug, `v${v}`);
        for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')))
          expect(parseScenario(fs.readFileSync(path.join(dir, f), 'utf8')), `${slug} v${v} ${f}`).toMatchObject({ ok: true });
      }
  });
});

describe('specs', () => {
  const read = (slug: string) => GameSpecSchema.parse(JSON.parse(fs.readFileSync(path.join(FIXTURES, slug, 'spec.json'), 'utf8')));
  it('validates every fixture spec', () => {
    for (const slug of ['cat-vs-cucumbers', 'comet-dash', 'penguin-slide']) expect(read(slug).slug).toBe(slug);
  });
  it('accumulates acceptance items per version and renders markdown', () => {
    const spec = read('penguin-slide');
    expect(acceptanceFor(spec, 1)).toHaveLength(6);
    expect(acceptanceFor(spec, 2).map(a => a.id)).toContain('A7');
    const md = specToMarkdown(spec);
    expect(md).toMatch(/^# Penguin Slide/);
    expect(md).toMatch(/## Acceptance\n\n1\. /);
    expect(md).toMatch(/## v2 hotfix/);
  });
  it('rejects a spec with too few acceptance items', () => {
    const spec = { ...read('comet-dash'), acceptance: [{ id: 'A1', text: 'Score goes up.' }] };
    expect(GameSpecSchema.safeParse(spec).success).toBe(false);
  });
});

describe('versions', () => {
  it('numbers versions', () => {
    expect(nextVersion([])).toBe(1);
    expect(nextVersion([1, 3, 2])).toBe(4);
    expect(listVersions(FIXTURES, 'penguin-slide')).toEqual([1, 2]);
    expect(listVersions(FIXTURES, 'nope-nope')).toEqual([]);
  });
  it('reads hotfix notes', () => {
    expect(readHotfix('- hotfix: wall hugging (bug hunter: Asha)\n- more')).toEqual({ bug: 'wall hugging', hunter: 'Asha' });
    expect(readHotfix('* hotfix: no hunter')).toEqual({ bug: 'no hunter', hunter: '' });
    expect(readHotfix('- built a game')).toBeNull();
  });
  it('swaps the GAME region and keeps the engine', () => {
    const html = replaceGameRegion(starterHtml(), 'const Game = { title: "X" };');
    expect(gameRegion(html)).toBe('const Game = { title: "X" };');
    expect(html).toContain('window.__crew = {');
    expect(() => replaceGameRegion('<html></html>', 'x')).toThrow(/markers/);
  });
  it('creates versions from the starter, the previous version, or a remix source', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-versions-'));
    try {
      expect(createVersion(tmp, 'new-game')).toEqual({ version: 1, source: 'starter' });
      expect(createVersion(tmp, 'new-game')).toEqual({ version: 2, source: 'v1' });
      expect(createVersion(tmp, 'remix-game', { from: 'new-game' })).toEqual({ version: 1, source: 'new-game v2 (remix)' });
      expect(() => createVersion(tmp, 'remix-game', { from: 'new-game' })).toThrow(/only for v1/);
      expect(() => createVersion(tmp, 'Bad Slug')).toThrow(/Bad slug/);
      expect(fs.readFileSync(path.join(tmp, 'new-game', 'v1', 'index.html'), 'utf8')).toBe(starterHtml());
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
  it('loads a version with its repros and earlier scenarios', () => {
    const input = loadVersion(FIXTURES, 'penguin-slide', 2);
    expect(input.label).toBe('penguin-slide v2');
    expect(input.scenario?.length).toBeGreaterThan(3);
    expect(input.repros?.map(r => `${r.version}:${r.name}`)).toEqual(['1:repro-1']);
    expect(input.previous?.map(r => r.version)).toEqual([1]);
  });
});
