import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { KINDS, replaceOnce, validateMutants } from '../eval/mutate';
import { listVersions } from '../src/versions';
import catVsCucumbers from '../eval/mutants/cat-vs-cucumbers';
import cometDash from '../eval/mutants/comet-dash';
import penguinSlide from '../eval/mutants/penguin-slide';

const FIXTURES = path.join(import.meta.dirname, '..', 'fixtures', 'games');
const latestHtml = (slug: string) => {
  const v = listVersions(FIXTURES, slug).at(-1)!;
  return fs.readFileSync(path.join(FIXTURES, slug, `v${v}`, 'index.html'), 'utf8');
};

describe('replaceOnce', () => {
  it('replaces exactly one match and throws otherwise', () => {
    expect(replaceOnce('a b c', 'b', 'x')).toBe('a x c');
    expect(() => replaceOnce('a b b', 'b', 'x')).toThrow(/found 2 times/);
    expect(() => replaceOnce('a', 'z', 'x')).toThrow(/found 0 times/);
    expect(replaceOnce('n=1;', /n=(\d)/, 'n=$1$1')).toBe('n=11;');
  });
});

describe('planted-bug mutants', () => {
  it.each([
    ['cat-vs-cucumbers', catVsCucumbers],
    ['comet-dash', cometDash],
    ['penguin-slide', penguinSlide],
  ])('%s: one valid, deterministic mutant per kind', (slug, list) => {
    const { valid, invalid } = validateMutants(slug, latestHtml(slug), list);
    expect(invalid).toEqual([]);
    expect(valid.map(m => m.kind).sort()).toEqual([...KINDS].sort());
  });
});
