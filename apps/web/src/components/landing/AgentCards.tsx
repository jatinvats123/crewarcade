'use client';
/* eslint-disable @next/next/no-img-element -- agent portraits are small static SVGs */

import { AGENTS, type AgentKey } from '@crewarcade/shared';
import { useRef, type PointerEvent } from 'react';
import { StateChip } from '@/components/ui';
import { ACCENT_BG, ACCENT_TEXT } from '@/lib/agents';
import { cn } from '@/lib/cn';
import { glassStyle, mix, RIM, WHITE } from './glass';

/**
 * The agents as liquid-glass cards (Apple Liquid Glass feel) over a living backdrop: a giant lime
 * word and drifting colour glows, so the glass has something to blur and bend. Layers per card:
 * clear glass body, bright gradient rim, top sheen, a specular light and 3D tilt that follow the
 * mouse. The cards span almost the full width on desktop. Tilt and moving light are mouse-only and
 * off with prefers-reduced-motion.
 */

const KEYS = Object.keys(AGENTS) as AgentKey[];
const STATE = { pixel: 'designing', forge: 'building', glitch: 'testing' } as const;
const FAN = ['md:-rotate-[3deg] md:translate-y-10', 'md:-translate-y-2', 'md:rotate-[3deg] md:translate-y-10'];
const AGENT_VAR: Record<AgentKey, string> = { pixel: 'var(--pixel)', forge: 'var(--forge)', glitch: 'var(--glitch)' };

function GlassCard({ agent, index }: { agent: AgentKey; index: number }) {
  const card = useRef<HTMLDivElement>(null);
  const accent = AGENT_VAR[agent];

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = card.current;
    if (!el || e.pointerType !== 'mouse' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
    el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
    el.style.setProperty('--rx', `${((0.5 - y) * 10).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${((x - 0.5) * 12).toFixed(2)}deg`);
    el.style.setProperty('--lit', '1');
  };
  const onLeave = () => {
    const el = card.current;
    if (el) for (const p of ['--mx', '--my', '--rx', '--ry', '--lit']) el.style.removeProperty(p);
  };

  const a = AGENTS[agent];
  return (
    <li className={cn('relative [perspective:1400px]', FAN[index])}>
      <div
        ref={card}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        className="relative min-h-[520px] rounded-[36px] transition-transform duration-300 ease-out will-change-transform [transform:rotateX(var(--rx,0deg))_rotateY(var(--ry,0deg))] lg:min-h-[600px]"
      >
        {/* Glass body. */}
        <div className="absolute inset-0 overflow-hidden rounded-[36px]" style={glassStyle(accent)}>
          {/* Top sheen: light falling on the upper edge. */}
          <span aria-hidden className="absolute inset-x-0 top-0 h-1/2" style={{ background: `linear-gradient(180deg, ${mix(WHITE, 18)}, transparent)` }} />
          {/* Specular light under the pointer. */}
          <span
            aria-hidden
            className="absolute inset-0 opacity-[calc(0.35+var(--lit,0)*0.65)] transition-opacity duration-300"
            style={{ background: `radial-gradient(320px circle at var(--mx, 25%) var(--my, 0%), ${mix(WHITE, 30)}, transparent 60%)` }}
          />
        </div>
        <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[36px]" style={RIM} />

        {/* Content. */}
        <div className="relative flex h-full min-h-[520px] flex-col p-8 lg:min-h-[600px] lg:p-10">
          <div className="flex items-start justify-between">
            <span className="font-poster text-4xl leading-none text-text/40">0{index + 1}</span>
            <span className="-rotate-3 bg-brand px-2.5 py-1 text-[11px] font-bold tracking-[0.2em] text-brand-ink uppercase">AI agent</span>
          </div>

          <div className="relative mx-auto mt-6 size-36 lg:size-44">
            <span aria-hidden className={cn('absolute inset-4 rounded-full opacity-70 blur-2xl', ACCENT_BG[agent])} />
            <img src={a.avatarPath} alt="" width={176} height={176} className="relative size-full drop-shadow-[0_18px_30px_rgba(0,0,0,0.55)]" />
          </div>

          <div className="mt-8">
            <p className={cn('font-poster text-6xl leading-none uppercase lg:text-8xl', ACCENT_TEXT[agent])}>{agent}</p>
            <p className="mt-3 text-xs font-semibold tracking-[0.22em] text-text/60 uppercase lg:text-sm">{a.role}</p>
            <p className="mt-4 max-w-sm text-text/80 lg:text-lg">{a.tagline}</p>
          </div>

          <div className="mt-auto pt-6">
            <StateChip state={STATE[agent]} />
          </div>
        </div>
      </div>
    </li>
  );
}

export function AgentCards() {
  return (
    <div className="relative">
      {/* The backdrop the glass blurs and bends: a giant lime word and drifting colour glows. */}
      <div aria-hidden className="pointer-events-none absolute -inset-x-16 -inset-y-28 [mask-image:radial-gradient(closest-side,#000_60%,transparent)]">
        <span className="absolute top-[36%] left-1/2 -translate-x-1/2 -translate-y-1/2 font-poster text-[24vw] leading-none text-brand/90 select-none">
          AGENTS
        </span>
        <span className="absolute top-[10%] left-[6%] size-96 animate-[drift_13s_ease-in-out_infinite_alternate] rounded-full bg-pixel opacity-60 blur-[100px]" />
        <span className="absolute top-[30%] left-[38%] size-96 animate-[drift_17s_ease-in-out_infinite_alternate-reverse] rounded-full bg-forge opacity-50 blur-[100px]" />
        <span className="absolute top-[12%] right-[6%] size-96 animate-[drift_15s_ease-in-out_infinite_alternate] rounded-full bg-glitch opacity-55 blur-[100px]" />
      </div>

      <ul className="relative grid gap-10 md:grid-cols-3 md:gap-6 lg:gap-8">
        {KEYS.map((key, i) => (
          <GlassCard key={key} agent={key} index={i} />
        ))}
      </ul>
    </div>
  );
}
