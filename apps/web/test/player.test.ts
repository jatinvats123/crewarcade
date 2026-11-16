// The player's trust rules: only our sandboxed iframe's messages, only the score-hook shapes, and
// an iframe that can run scripts but never gets same-origin, top navigation, popups or forms.
import { describe, expect, it } from 'vitest';
import { acceptHostMessage, GAME_ALLOW, GAME_SANDBOX } from '@/lib/player-messages';

describe('player postMessage validation', () => {
  const frame = { name: 'our iframe window' };
  const other = { name: 'some other window' };
  const score = { type: 'crewarcade:score', score: 120, best: 300, time: 41.5 };

  it('accepts the score hook from our sandboxed iframe (opaque "null" origin)', () => {
    expect(acceptHostMessage({ source: frame, origin: 'null', data: score }, frame, 'https://api.test')).toEqual(score);
    expect(acceptHostMessage({ source: frame, origin: 'null', data: { type: 'crewarcade:start' } }, frame, 'https://api.test')).toEqual({
      type: 'crewarcade:start',
    });
    expect(acceptHostMessage({ source: frame, origin: 'https://api.test', data: score }, frame, 'https://api.test')).toEqual(score);
  });

  it('ignores other windows, other origins and unexpected shapes', () => {
    expect(acceptHostMessage({ source: other, origin: 'null', data: score }, frame, 'https://api.test')).toBeNull();
    expect(acceptHostMessage({ source: frame, origin: 'https://evil.test', data: score }, frame, 'https://api.test')).toBeNull();
    expect(acceptHostMessage({ source: frame, origin: 'null', data: score }, null, 'https://api.test')).toBeNull();
    for (const data of [
      'crewarcade:score',
      { ...score, score: '120' },
      { ...score, score: -5 },
      { ...score, time: Number.NaN },
      { ...score, extra: true },
      { type: 'crewarcade:navigate', url: 'https://evil.test' },
      null,
    ])
      expect(acceptHostMessage({ source: frame, origin: 'null', data }, frame, 'https://api.test')).toBeNull();
  });

  it('the iframe sandbox allows scripts and pointer lock only (never same-origin)', () => {
    expect(GAME_SANDBOX.split(' ').sort()).toEqual(['allow-pointer-lock', 'allow-scripts']);
    expect(GAME_SANDBOX).not.toMatch(/same-origin|top-navigation|popups|forms|modals/);
    expect(GAME_ALLOW).toBe('fullscreen; gamepad');
  });
});

describe('Open Graph card text', () => {
  it('never draws Indic titles or crew names (satori cannot shape them)', async () => {
    const { ogCardText, needsShaping } = await import('@/lib/public-game');
    const crew = { name: 'Chai Crew', members: [] };
    expect(ogCardText({ title: 'Chai Dash', publishedVersion: 1, crew })).toEqual({ title: 'Chai Dash', line: 'Made by Chai Crew with Pixel, Forge & Glitch' });
    expect(ogCardText({ title: 'दिवाली पटाखा बिल्ली', publishedVersion: 1, crew })).toEqual({
      title: "Chai Crew's new game",
      line: 'Made by Chai Crew with Pixel, Forge & Glitch',
    });
    expect(ogCardText({ title: 'चाय डैश', publishedVersion: null, crew: { name: 'चाय टीम', members: [] } })).toEqual({
      title: 'A new CrewArcade game',
      line: 'A crew is building this right now',
    });
    expect(needsShaping('தமிழ்')).toBe(true);
    expect(needsShaping('Chai Dash 🎮')).toBe(false);
  });
});
