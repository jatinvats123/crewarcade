import { cn } from '@/lib/cn';

/**
 * A game's thumbnail as a little game world in its own two colours: a sky, a far skyline, a tiled
 * ground with obstacles and coins, the hero (the game's emoji) mid-hop, and an arcade HUD (score, hi
 * score, lives) behind CRT scanlines. Every game gets its own layout (seeded by its slug).
 * `motion`: 'off' still; 'hover' scrolls while a parent `.group` is hovered; 'on' always (attract mode).
 * Reduced motion stops it (global rule in globals.css).
 */

type Props = {
  seed: string;
  emoji: string;
  colors: [string, string];
  score?: number | null;
  best?: number | null;
  motion?: 'off' | 'hover' | 'on';
  /** Wide (21:9) canvas for big screens; default 4:3. */
  wide?: boolean;
  /** false: no score / lives HUD (decorative art, e.g. a crew card). */
  hud?: boolean;
  className?: string;
};

/** Small deterministic PRNG from a string, so each game keeps its layout. */
function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

const pad = (n: number) => String(Math.max(0, Math.round(n))).padStart(6, '0');

export function GameScene({ seed, emoji, colors, score, best, motion = 'off', wide = false, hud = true, className }: Props) {
  const [c1, c2] = colors;
  const W = wide ? 700 : 400;
  const r = rng(seed);
  // One 400-unit strip, drawn twice side by side, so the scroll loops seamlessly.
  const towers = Array.from({ length: 9 }, (_, i) => ({ x: i * 46 + r() * 14, w: 26 + r() * 22, h: 40 + r() * 70 }));
  const blocks = Array.from({ length: 3 }, (_, i) => ({ x: 70 + i * 120 + r() * 50, h: 18 + r() * 26, w: 18 + r() * 16 }));
  const coins = Array.from({ length: 4 }, (_, i) => ({ x: 40 + i * 95 + r() * 30, y: 150 + r() * 40 }));
  const shown = score ?? Math.round(r() * 900 + 100);

  const play =
    motion === 'on' ? '' : motion === 'hover' ? '[animation-play-state:paused] group-hover:[animation-play-state:running]' : '[animation-play-state:paused]';

  const strip = (dx: number) => (
    <g transform={`translate(${dx} 0)`}>
      {towers.map((t, i) => (
        <rect key={`t${i}`} x={t.x} y={232 - t.h} width={t.w} height={t.h} fill="#000" opacity="0.16" />
      ))}
      {coins.map((c, i) => (
        <g key={`c${i}`} transform={`translate(${c.x} ${c.y})`}>
          <rect x="-6" y="-6" width="12" height="12" transform="rotate(45)" fill="#fff" opacity="0.9" />
        </g>
      ))}
      {blocks.map((b, i) => (
        <g key={`b${i}`}>
          <rect x={b.x} y={232 - b.h} width={b.w} height={b.h} fill="#000" opacity="0.38" />
          <rect x={b.x} y={232 - b.h} width={b.w} height="4" fill="#fff" opacity="0.25" />
        </g>
      ))}
      {/* Ground tiles. */}
      {Array.from({ length: 16 }, (_, i) => (
        <rect key={`g${i}`} x={i * 25} y="232" width="12" height="68" fill="#000" opacity="0.1" />
      ))}
    </g>
  );

  return (
    <svg viewBox={`0 0 ${W} 300`} preserveAspectRatio="xMidYMid slice" className={cn('size-full', className)} aria-hidden>
      <rect width={W} height="300" fill={c1} />
      <circle cx={W - 140 + r() * 90} cy={70} r="38" fill={c2} opacity="0.55" />
      <rect y="232" width={W} height="68" fill={c2} />
      <rect y="232" width={W} height="5" fill="#fff" opacity="0.35" />

      {/* The world scrolls left; the hero stays put and hops. */}
      <g className={cn('animate-[scene-x_9s_linear_infinite]', play)}>
        {strip(0)}
        {strip(400)}
        {wide && strip(800)}
      </g>

      <g display={emoji ? undefined : 'none'} className={cn('animate-[scene-hop_0.9s_ease-in-out_infinite_alternate]', play)}>
        <ellipse cx="118" cy="236" rx="26" ry="5" fill="#000" opacity="0.25" />
        <text x="118" y="226" fontSize="66" textAnchor="middle">
          {emoji}
        </text>
      </g>

      {/* HUD. */}
      <g display={hud ? undefined : 'none'} fontFamily="ui-monospace, 'Cascadia Mono', Menlo, monospace" fontWeight="800" fill="#fff">
        <text x="18" y="30" fontSize="13" opacity="0.85">
          SCORE
        </text>
        <text x="18" y="48" fontSize="18">
          {pad(shown)}
        </text>
        {best !== null && best !== undefined && (
          <>
            <text x={W - 18} y="30" fontSize="13" textAnchor="end" opacity="0.85">
              HI
            </text>
            <text x={W - 18} y="48" fontSize="18" textAnchor="end">
              {pad(best)}
            </text>
          </>
        )}
        {[0, 1, 2].map(i => (
          <rect key={i} x={18 + i * 15} y="58" width="10" height="10" fill="#fff" opacity={i < 2 ? 0.95 : 0.35} />
        ))}
      </g>

      {/* CRT scanlines. */}
      <rect width={W} height="300" fill="url(#scan)" opacity="0.5" />
      <defs>
        <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="1.4" fill="#000" opacity="0.18" />
        </pattern>
      </defs>
    </svg>
  );
}
