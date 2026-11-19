import type { CSSProperties } from 'react';

/**
 * Liquid-glass styles shared by the landing pieces (agent cards, How it works chat).
 * Use on an element with a border radius and `overflow-hidden`; put something colourful behind it.
 */

export const WHITE = '#ffffff';
export const mix = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

/** Clear glass: a light blur that boosts colour, a faint tint, and inner light top and bottom. */
export function glassStyle(accent: string): CSSProperties {
  return {
    backdropFilter: 'blur(7px) saturate(190%) brightness(1.08)',
    WebkitBackdropFilter: 'blur(7px) saturate(190%) brightness(1.08)',
    background: `linear-gradient(160deg, ${mix(WHITE, 14)}, ${mix(WHITE, 3)} 45%, ${mix(accent, 10)})`,
    boxShadow: `inset 0 1px 1px ${mix(WHITE, 70)}, inset 0 -1px 1px ${mix(WHITE, 18)}, inset 0 24px 48px -24px ${mix(WHITE, 30)}, inset 0 -30px 60px -30px ${mix(accent, 55)}, 0 30px 80px -30px ${mix(accent, 55)}`,
  };
}

/** A 1.5px rim drawn with a mask, so it can carry a gradient (bright corners, clear sides). */
export const RIM: CSSProperties = {
  padding: '1.5px',
  background: `linear-gradient(140deg, ${mix(WHITE, 95)}, ${mix(WHITE, 15)} 30%, ${mix(WHITE, 5)} 55%, ${mix(WHITE, 60)})`,
  WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
  WebkitMaskComposite: 'xor',
  mask: 'linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)',
};
