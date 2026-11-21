import { describe, expect, it } from 'vitest';
import { HERO_3D_QUERY, heroUses3d } from '@/lib/hero';

describe('heroUses3d', () => {
  it('uses the WebGL controller only on wide screens that have WebGL2', () => {
    expect(heroUses3d({ webgl2: true, wide: true })).toBe(true);
  });

  it('keeps phones on the HTML headline (the 3D controller covered "+ 3 AI agents" and the intro)', () => {
    expect(heroUses3d({ webgl2: true, wide: false })).toBe(false);
  });

  it('falls back to the HTML headline without WebGL2', () => {
    expect(heroUses3d({ webgl2: false, wide: true })).toBe(false);
  });

  it('calls a screen wide from the md breakpoint up', () => {
    expect(HERO_3D_QUERY).toBe('(min-width: 768px)');
  });
});
