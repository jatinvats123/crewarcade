'use client';

import type { AgentKey } from '@crewarcade/shared';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Avatar, type HumanColor } from '@/components/ui/Avatar';
import { ChatPlayMark } from '@/components/brand/marks';
import { ACCENT_TEXT } from '@/lib/agents';
import { cn } from '@/lib/cn';
import { GameScene } from '@/components/arcade/GameScene';
import { glassStyle, mix, RIM, WHITE } from './glass';

/**
 * "How a game gets made" as a camera tour (desktop), like a car/bike launch page: one hero object (a
 * map of glass cards, one per moment, threaded by a lime line) stays on screen while scrolling flies
 * the camera into each moment: the pitch, Pixel's plan, Forge's build, Glitch's PASS, Publish. Text drifts in (fade +
 * un-blur) on the opposite side, alternating; the chat reacts as the camera arrives (approved, build
 * bar fills, PASS stamps in, published). A chapter ruler on the right, a spotlight floor, no blobs.
 * Phones get the steps as a list and the finished chat, no camera.
 */

/** `pillar` and `nexconn`: which Nexconn Chat pillar and features each step runs on (all live in the app). */
type Step = { n: string; word: string; text: string; agent?: AgentKey; who?: string; side: 'left' | 'right'; pillar: string; nexconn: string[] };
const STEPS: Step[] = [
  {
    n: '01',
    word: 'Pitch',
    who: 'You + your crew',
    text: 'Drop an idea in the group chat. Your friends pile on, everyone votes.',
    side: 'left',
    pillar: 'Group chat',
    nexconn: ['Group channel', 'Real-time messages', 'Voice messages', 'Tap to translate'],
  },
  {
    n: '02',
    word: 'Plan',
    agent: 'pixel',
    text: 'Pixel turns the pitch into a game plan with a checklist. An approver taps Approve.',
    side: 'right',
    pillar: 'Human in the loop',
    nexconn: ['Agent identity', 'Custom card message', 'Live metadata votes'],
  },
  {
    n: '03',
    word: 'Build',
    agent: 'forge',
    text: 'Forge writes the whole game as one file, streamed live into the chat.',
    side: 'left',
    pillar: 'Agent handoffs',
    nexconn: ['Pixel → Forge handoff', 'Streamed message', 'Webhooks'],
  },
  {
    n: '04',
    word: 'Playtest',
    agent: 'glitch',
    text: 'Glitch plays every build against the checklist. PASS or FAIL, with a GIF.',
    side: 'right',
    pillar: 'Structured messages',
    nexconn: ['Forge → Glitch handoff', 'Typed test card', 'Agent DMs'],
  },
  {
    n: '05',
    word: 'Publish',
    who: 'You',
    text: 'Nothing goes public until someone taps Allow. Then it lives in the Arcade.',
    side: 'left',
    pillar: 'Audit trail',
    nexconn: ['Approver-only Allow', 'Decision ledger'],
  },
];

/** "Nexconn · <pillar>" and the features a step uses, as small hairline tags. */
function NexconnTags({ step, align = 'left' }: { step: Step; align?: 'left' | 'right' }) {
  return (
    <div className={cn('mt-5 flex flex-col gap-2', align === 'right' && 'items-end')}>
      <p className="text-[10px] font-bold tracking-[0.25em] text-text/50 uppercase">
        Nexconn <span className="text-brand">·</span> {step.pillar}
      </p>
      <ul className={cn('flex flex-wrap gap-1.5', align === 'right' && 'justify-end')}>
        {step.nexconn.map(f => (
          <li key={f} className="rounded-full border border-text/20 px-2.5 py-1 text-[11px] font-medium text-text/75">
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Keyframes along the tour: 0 = intro (whole phone), 1..5 = the steps, 6 = outro.
const LAST = STEPS.length + 1;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const smooth = (t: number) => t * t * (3 - 2 * t);
/** Rest on each keyframe for a while, then glide to the next (so the text can be read). */
const glide = (t: number) => smooth(clamp01((t - 0.3) / 0.7));

type Cam = { x: number; y: number; s: number; rx: number; ry: number };

/* ---------- chat pieces (the cards' content) ---------- */

function Human({ name, emoji, color, children }: { name: string; emoji: string; color: HumanColor; children: ReactNode }) {
  return (
    <div className="flex items-end gap-2.5">
      <Avatar kind="human" emoji={emoji} color={color} name={name} size="sm" />
      <div>
        <p className="mb-1 text-[11px] font-semibold text-text/55">{name}</p>
        <p className="rounded-2xl rounded-bl-md bg-text/12 px-3.5 py-2 text-[13px]">{children}</p>
      </div>
    </div>
  );
}

function AgentMsg({ agent, children }: { agent: AgentKey; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <Avatar kind="agent" agent={agent} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="mb-1 flex items-center gap-2 text-[11px] font-semibold">
          <span className={cn('capitalize', ACCENT_TEXT[agent])}>{agent}</span>
          <span className="rounded-full bg-text/10 px-1.5 py-px text-[9px] tracking-wider text-text/55 uppercase">AI</span>
        </p>
        <div className="rounded-2xl rounded-tl-md border border-text/10 bg-text/[0.06] p-3.5 text-[13px]">{children}</div>
      </div>
    </div>
  );
}

function Pill({ on, children, tone }: { on: boolean; children: ReactNode; tone: 'go' | 'done' }) {
  return (
    <span
      className={cn(
        'rounded-full px-3 py-1 text-[11px] font-bold transition-all duration-500',
        tone === 'go' ? 'bg-success text-black' : 'bg-success/15 text-success',
        on ? 'scale-100 opacity-100' : 'scale-90 opacity-0',
      )}
    >
      {children}
    </span>
  );
}

/* ---------- the map: one glass card per moment, threaded by a lime line ---------- */

// Map canvas (desktop) and where each card sits on it, in a zig-zag.
const MAP_W = 1900;
const MAP_H = 1240;
const SPOTS = [
  { x: 60, y: 60 },
  { x: 560, y: 430 },
  { x: 1080, y: 70 },
  { x: 1400, y: 560 },
  { x: 820, y: 860 },
];
const CARD_W = 460;
const ACCENTS = ['var(--text)', 'var(--pixel)', 'var(--forge)', 'var(--glitch)', 'var(--brand)'];
const HANDOFFS = ['Pixel plans', 'Pixel → Forge', 'Forge → Glitch', 'Glitch → you'];

/** A smooth curve through points (Catmull-Rom as cubic Béziers). */
function curveThrough(pts: Array<{ x: number; y: number }>) {
  let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    d += ` C ${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6}, ${p2.x - (p3.x - p1.x) / 6} ${p2.y - (p3.y - p1.y) / 6}, ${p2.x} ${p2.y}`;
  }
  return d;
}
const CENTERS = SPOTS.map(s => ({ x: s.x + CARD_W / 2, y: s.y + 120 }));
const THREAD = curveThrough(CENTERS);

type Links = { d: string; segs: string[]; mids: Array<{ x: number; y: number }> };
type Box = { x: number; y: number; w: number; h: number };

/** Where a link leaves (or enters) a card: the middle of the side that faces the other card. */
function port(b: Box, toward: { x: number; y: number }) {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (Math.abs(dx) * b.h > Math.abs(dy) * b.w) return { x: dx > 0 ? b.x + b.w : b.x, y: cy, nx: Math.sign(dx), ny: 0 };
  return { x: cx, y: dy > 0 ? b.y + b.h : b.y, nx: 0, ny: Math.sign(dy) };
}

/** The thread between consecutive cards, edge to edge (never through a card), plus each link's midpoint. */
function route(boxes: Box[]): Links {
  const segs: string[] = [];
  const mids: Links['mids'] = [];
  for (let i = 0; i < boxes.length - 1; i++) {
    const a = boxes[i]!;
    const b = boxes[i + 1]!;
    const pa = port(a, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
    const pb = port(b, { x: a.x + a.w / 2, y: a.y + a.h / 2 });
    const k = 140;
    const c1 = { x: pa.x + pa.nx * k, y: pa.y + pa.ny * k };
    const c2 = { x: pb.x + pb.nx * k, y: pb.y + pb.ny * k };
    segs.push(`M ${pa.x} ${pa.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${pb.x} ${pb.y}`);
    mids.push({ x: (pa.x + 3 * c1.x + 3 * c2.x + pb.x) / 8, y: (pa.y + 3 * c1.y + 3 * c2.y + pb.y) / 8 });
  }
  return { d: segs.join(' '), segs, mids };
}

function MapCard({ i, layout, mark, children }: { i: number; layout: 'map' | 'stack'; mark: (el: HTMLDivElement | null) => void; children: ReactNode }) {
  const step = STEPS[i]!;
  return (
    <div
      ref={mark}
      className={cn('w-full max-w-[460px]', layout === 'map' && 'absolute')}
      style={layout === 'map' ? { left: SPOTS[i]!.x, top: SPOTS[i]!.y, width: CARD_W } : undefined}
    >
      <p className="mb-3 flex items-center gap-3 px-1 text-[11px] font-bold tracking-[0.25em] uppercase">
        <span className="font-poster text-lg tracking-normal text-brand">{step.n}</span>
        <span className="text-text/70">{step.word}</span>
      </p>
      <div className="relative overflow-hidden rounded-[28px] p-5" style={glassStyle(ACCENTS[i]!)}>
        <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[28px]" style={RIM} />
        <div className="relative">{children}</div>
      </div>
    </div>
  );
}

function Board({
  at,
  fill,
  msgRefs,
  boardRef,
  threadRef,
  links,
  layout,
}: {
  at: number;
  links?: Links;
  fill: React.RefObject<HTMLDivElement | null>;
  msgRefs: React.RefObject<Array<HTMLDivElement | null>>;
  boardRef?: React.RefObject<HTMLDivElement | null>;
  threadRef?: React.RefObject<Array<SVGPathElement | null>>;
  layout: 'map' | 'stack';
}) {
  const mark = (i: number) => (el: HTMLDivElement | null) => {
    msgRefs.current[i] = el;
  };
  const map = layout === 'map';
  return (
    <div ref={boardRef} className={cn('relative', map ? '' : 'flex flex-col items-center gap-10')} style={map ? { width: MAP_W, height: MAP_H } : undefined}>
      {map && (
        <svg aria-hidden className="absolute inset-0 overflow-visible" width={MAP_W} height={MAP_H}>
          {/* The track, then the lime thread that draws itself as the story moves on. */}
          <path d={links?.d ?? THREAD} fill="none" stroke="var(--text)" strokeOpacity="0.14" strokeWidth="2" strokeDasharray="6 10" />
          {(links?.segs ?? [THREAD]).map((d, k) => (
            <path
              key={k}
              ref={el => {
                if (threadRef) threadRef.current[k] = el;
              }}
              d={d}
              fill="none"
              stroke="var(--brand)"
              strokeWidth="3"
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray="1"
              strokeDashoffset="1"
            />
          ))}
          {CENTERS.slice(0, -1).map((c, k) => {
            const n = CENTERS[k + 1]!;
            const mid = links?.mids[k] ?? { x: (c.x + n.x) / 2, y: (c.y + n.y) / 2 };
            return (
              <g key={k} transform={`translate(${mid.x} ${mid.y})`} opacity={at > k + 1 ? 1 : 0.35}>
                <rect x="-62" y="-14" width="124" height="28" rx="14" fill="var(--bg)" stroke="var(--brand)" strokeOpacity="0.5" />
                <text textAnchor="middle" y="4.5" fontSize="11" fontWeight="700" letterSpacing="1.5" fill="var(--text)">
                  {HANDOFFS[k]!.toUpperCase()}
                </text>
              </g>
            );
          })}
        </svg>
      )}

      <MapCard i={0} layout={layout} mark={mark(0)}>
        <div className="mb-4 flex items-center justify-between border-b border-text/10 pb-3">
          <div>
            <p className="font-poster text-lg leading-none uppercase">The Rooftop Crew</p>
            <p className="mt-1 text-[10px] text-text/55">4 friends · 3 agents</p>
          </div>
          <div className="flex -space-x-2">
            <Avatar kind="agent" agent="pixel" size="sm" />
            <Avatar kind="agent" agent="forge" size="sm" />
            <Avatar kind="agent" agent="glitch" size="sm" />
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <Human name="Aarav" emoji="🦊" color="amber">
            pitch: a mango dodging crows on a rooftop
          </Human>
          <Human name="Meera" emoji="🐼" color="cyan">
            yesss, with power-ups pls
          </Human>
        </div>
      </MapCard>

      <MapCard i={1} layout={layout} mark={mark(1)}>
        <AgentMsg agent="pixel">
          <p className="font-poster text-base leading-none uppercase">Plan · Mango Rooftop Dash</p>
          <ul className="mt-2.5 space-y-1.5">
            {['Dodge the crows, 3 lives', 'Power-ups: chilli dash, umbrella', 'Score = rooftops crossed'].map((c, i) => (
              <li
                key={c}
                className={cn('flex items-center gap-2 transition-all duration-500', at >= 1 ? 'opacity-100' : 'opacity-40')}
                style={{ transitionDelay: `${i * 120}ms` }}
              >
                <span aria-hidden className={cn('size-2 transition-colors duration-500', at >= 1 ? 'bg-brand' : 'bg-text/25')} />
                {c}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[11px] text-text/55">3 votes · 👍 3</span>
            <span className="relative grid">
              <span className="col-start-1 row-start-1">
                <Pill on={at < 2} tone="go">
                  Approve
                </Pill>
              </span>
              <span className="col-start-1 row-start-1">
                <Pill on={at >= 2} tone="done">
                  Approved by Aarav
                </Pill>
              </span>
            </span>
          </div>
        </AgentMsg>
      </MapCard>

      <MapCard i={2} layout={layout} mark={mark(2)}>
        <AgentMsg agent="forge">
          <p className="font-poster text-base leading-none uppercase">Building v1 · game.html</p>
          <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-text/10">
            <div ref={fill} className="h-full w-0 rounded-full bg-forge" style={at >= LAST ? { width: '100%' } : undefined} />
          </div>
          <p className="mt-2 text-[11px] text-text/55">one file · no installs · streamed live</p>
        </AgentMsg>
      </MapCard>

      <MapCard i={3} layout={layout} mark={mark(3)}>
        <AgentMsg agent="glitch">
          <div className="flex items-center justify-between">
            <p className="font-poster text-base leading-none uppercase">Playtest · v1</p>
            <span
              className={cn(
                'rounded-md border-2 border-success px-2 py-0.5 font-poster text-sm text-success transition-all duration-300',
                at >= 4 ? 'rotate-[-8deg] scale-100 opacity-100' : 'scale-150 opacity-0',
              )}
            >
              PASS
            </span>
          </div>
          <div className="relative mt-2.5 h-24 overflow-hidden rounded-xl">
            <GameScene
              seed="mango-rooftop-dash"
              emoji="🥭"
              colors={['#ffb547', '#2ec4b6']}
              score={648}
              best={648}
              motion="on"
              wide
              className="absolute inset-0"
            />
          </div>
          <p className="mt-2 text-[11px] text-text/55">8 of 8 checks · 60 fps</p>
        </AgentMsg>
      </MapCard>

      <MapCard i={4} layout={layout} mark={mark(4)}>
        <AgentMsg agent="pixel">
          <p className="font-poster text-base leading-none uppercase">Publish to the Arcade?</p>
          <div className="mt-2.5 grid">
            <div className={cn('col-start-1 row-start-1 flex gap-2 transition-opacity duration-500', at >= 5 ? 'opacity-0' : 'opacity-100')}>
              <span className="rounded-full bg-success px-3 py-1 text-[11px] font-bold text-black">Allow</span>
              <span className="rounded-full bg-text/10 px-3 py-1 text-[11px] font-semibold">Not yet</span>
            </div>
            <p className={cn('col-start-1 row-start-1 transition-opacity duration-500', at >= 5 ? 'opacity-100' : 'opacity-0')}>
              <span className="font-semibold text-success">Published.</span> <span className="text-text/65">crewarcade.app/g/mango-rooftop-dash</span>
            </p>
          </div>
        </AgentMsg>
      </MapCard>
    </div>
  );
}

/* ---------- the section ---------- */

export function HowItWorks() {
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const camera = useRef<HTMLDivElement>(null);
  const tilt = useRef<HTMLDivElement>(null);
  const phone = useRef<HTMLDivElement>(null);
  const thread = useRef<Array<SVGPathElement | null>>([]);
  const [links, setLinks] = useState<Links | undefined>(undefined);
  const fill = useRef<HTMLDivElement>(null);
  const msgs = useRef<Array<HTMLDivElement | null>>([]);
  const texts = useRef<Array<HTMLDivElement | null>>([]);
  const keys = useRef<Cam[]>([]);
  const [wide, setWide] = useState(false);
  const [at, setAt] = useState(0); // nearest keyframe, drives the chat's reactions and the ruler

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  /** Where the camera sits at each keyframe: which point of the phone lands where on the stage. */
  const measure = useCallback(() => {
    const st = stage.current;
    const ph = phone.current;
    if (!st || !ph) return;
    const W = st.clientWidth;
    const H = st.clientHeight;
    const pw = ph.offsetWidth;
    const pH = ph.offsetHeight;
    const fit = Math.min((W * 0.92) / pw, (H * 0.74) / pH);
    const place = (px: number, py: number, s: number, dx: number, dy: number, rx: number, ry: number): Cam => ({ x: dx - px * s, y: dy - py * s, s, rx, ry });
    // Intro: the whole map, tilted back like a table seen from above.
    const ks: Cam[] = [place(pw / 2, pH / 2, fit, W / 2, H / 2 + 40, 26, 0)];
    STEPS.forEach((step, i) => {
      const m = msgs.current[i];
      if (!m) return;
      const cx = m.offsetLeft + m.offsetWidth / 2;
      const cy = m.offsetTop + m.offsetHeight / 2;
      const s = Math.min(1.45, (H * 0.6) / m.offsetHeight, (W * 0.4) / m.offsetWidth);
      const left = step.side === 'left';
      ks.push(place(cx, cy, s, W * (left ? 0.66 : 0.34), H * 0.52, 0, left ? -6 : 6));
    });
    ks.push(place(pw / 2, pH / 2, fit * 0.95, W / 2, H / 2 + 30, 0, 0));
    keys.current = ks;
    const boxes = msgs.current.map(m => (m ? { x: m.offsetLeft, y: m.offsetTop, w: m.offsetWidth, h: m.offsetHeight } : null));
    if (boxes.every(Boolean)) setLinks(route(boxes as Box[]));
  }, []);

  const frame = useCallback(() => {
    const sec = section.current;
    const ks = keys.current;
    if (!sec || ks.length !== LAST + 1) return;
    const r = sec.getBoundingClientRect();
    const run = r.height - window.innerHeight;
    const k = clamp01(run > 0 ? -r.top / run : 0) * LAST;
    const i = Math.min(LAST - 1, Math.floor(k));
    const t = glide(k - i);
    const a = ks[i]!;
    const b = ks[i + 1]!;
    const lerp = (p: number, q: number) => p + (q - p) * t;
    if (camera.current) camera.current.style.transform = `translate3d(${lerp(a.x, b.x)}px, ${lerp(a.y, b.y)}px, 0) scale(${lerp(a.s, b.s)})`;
    if (tilt.current) tilt.current.style.transform = `rotateX(${lerp(a.rx, b.rx)}deg) rotateY(${lerp(a.ry, b.ry)}deg)`;
    const pos = i + t; // where the camera actually is
    // Text: fully in while the camera rests on its step, blurred out as it leaves.
    texts.current.forEach((el, j) => {
      if (!el) return;
      const d = pos - (j + 1);
      const vis = 1 - smooth(clamp01((Math.abs(d) - 0.12) / 0.38));
      el.style.opacity = String(vis);
      el.style.filter = `blur(${((1 - vis) * 12).toFixed(1)}px)`;
      el.style.transform = `translateY(${(-d * 60).toFixed(1)}px)`;
    });
    // Each link draws while the camera travels it (card k → card k+1).
    thread.current.forEach((el, k) => {
      if (el) el.style.strokeDashoffset = (1 - clamp01(pos - (k + 1))).toFixed(4);
    });
    if (fill.current) fill.current.style.width = `${(clamp01((pos - 2.75) / 0.5) * 100).toFixed(1)}%`;
    setAt(Math.min(LAST, Math.floor(pos + 0.15)));
  }, []);

  useLayoutEffect(() => {
    if (!wide) return;
    let raf = 0;
    const tick = () => {
      raf = 0;
      frame();
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const onResize = () => {
      measure();
      frame();
    };
    onResize();
    // Fonts change message heights: measure again once they are in.
    void document.fonts?.ready.then(onResize);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
    };
  }, [wide, measure, frame]);

  const jump = (j: number) => {
    const sec = section.current;
    if (!sec) return;
    const top = sec.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + (j / LAST) * (sec.offsetHeight - window.innerHeight), behavior: 'smooth' });
  };

  /* Phones and small tablets: the steps as a list, then the finished chat. */
  if (!wide) {
    return (
      <section id="how" aria-labelledby="how-heading" className="border-y border-border px-safe py-20">
        <ChatPlayMark className="mb-5 size-12" />
        <h2 id="how-heading" className="mb-8 text-xs font-semibold tracking-[0.2em] text-brand uppercase">
          How a game gets made
        </h2>
        <ol className="space-y-6">
          {STEPS.map(s => (
            <li key={s.word}>
              <p className="font-poster text-5xl leading-none uppercase">
                <span className="mr-3 text-xl text-brand">{s.n}</span>
                {s.word}
              </p>
              <p className="mt-2 text-text/75">{s.text}</p>
              <NexconnTags step={s} />
            </li>
          ))}
        </ol>
        <div className="mt-12 flex justify-center">
          <Board at={LAST} fill={fill} msgRefs={msgs} layout="stack" />
        </div>
      </section>
    );
  }

  return (
    <section id="how" ref={section} aria-labelledby="how-heading" className="relative h-[700vh] border-y border-border">
      <div ref={stage} className="sticky top-0 h-dvh overflow-hidden">
        {/* Studio: a soft spotlight on the floor and one behind the phone. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background: `radial-gradient(60% 40% at 50% 100%, ${mix(WHITE, 9)}, transparent 70%), radial-gradient(35% 45% at 50% 45%, ${mix(WHITE, 4)}, transparent 70%)`,
          }}
        />

        {/* Intro and outro titles. */}
        <h2
          id="how-heading"
          className={cn(
            'absolute top-10 left-1/2 flex -translate-x-1/2 items-center gap-4 text-center font-poster text-5xl leading-none whitespace-nowrap uppercase transition-all duration-700 xl:text-6xl',
            at === 0 ? 'opacity-100 blur-0' : 'opacity-0 blur-md',
          )}
        >
          <ChatPlayMark className="size-12 shrink-0" />
          How a game gets made
        </h2>
        <p
          className={cn(
            'absolute top-12 left-1/2 -translate-x-1/2 text-center font-poster text-5xl leading-none uppercase transition-all duration-700 xl:text-6xl',
            at === LAST ? 'opacity-100 blur-0' : 'pointer-events-none opacity-0 blur-md',
          )}
        >
          Pitch to <span className="text-brand">played</span> in minutes
        </p>

        {/* The camera: moves and scales the phone; the inner layer tilts it. */}
        <div className="absolute inset-0 [perspective:1600px]">
          <div ref={camera} className="absolute top-0 left-0 origin-top-left will-change-transform">
            <div ref={tilt} className="transition-none will-change-transform [transform-style:preserve-3d]">
              <Board at={at} fill={fill} msgRefs={msgs} boardRef={phone} threadRef={thread} links={links} layout="map" />
            </div>
          </div>
        </div>

        {/* Step text, drifting in on the side away from the phone. */}
        {STEPS.map((s, j) => (
          <div
            key={s.word}
            ref={el => {
              texts.current[j] = el;
            }}
            className={cn(
              'pointer-events-none absolute top-1/2 w-[min(34vw,520px)] -translate-y-1/2 opacity-0',
              s.side === 'left' ? 'left-[7vw]' : 'right-[7vw] text-right',
            )}
          >
            <div className={cn('flex items-center gap-3', s.side === 'right' && 'justify-end')}>
              <span className="font-poster text-xl text-brand">{s.n}</span>
              <span className="h-px w-10 bg-text/30" />
              {s.agent ? (
                <span className={cn('text-xs font-semibold tracking-[0.2em] uppercase', ACCENT_TEXT[s.agent])}>{s.agent}</span>
              ) : (
                <span className="text-xs font-semibold tracking-[0.2em] text-text/60 uppercase">{s.who}</span>
              )}
            </div>
            <p className="mt-4 font-poster text-[clamp(4rem,8vw,9rem)] leading-[0.88] uppercase">{s.word}</p>
            <p className={cn('mt-5 max-w-md text-lg text-text/75', s.side === 'right' && 'ml-auto')}>{s.text}</p>
            <NexconnTags step={s} align={s.side} />
          </div>
        ))}

        {/* Chapter ruler. */}
        <nav aria-label="Steps" className="absolute top-1/2 right-6 flex -translate-y-1/2 flex-col items-end gap-3">
          {STEPS.map((s, j) => (
            <button
              key={s.word}
              type="button"
              onClick={() => jump(j + 1)}
              className="group flex min-h-6 items-center gap-3"
              aria-current={at === j + 1 ? 'step' : undefined}
            >
              <span
                className={cn(
                  'text-[10px] font-semibold tracking-[0.2em] uppercase transition-opacity',
                  at === j + 1 ? 'text-brand opacity-100' : 'opacity-0 group-hover:opacity-60',
                )}
              >
                {s.word}
              </span>
              <span className={cn('h-px transition-all duration-500', at === j + 1 ? 'w-10 bg-brand' : at > j + 1 ? 'w-5 bg-text/60' : 'w-5 bg-text/25')} />
            </button>
          ))}
        </nav>

        {/* Scroll cue. */}
        <div
          aria-hidden
          className={cn(
            'absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 transition-opacity duration-500',
            at === LAST ? 'opacity-0' : 'opacity-100',
          )}
        >
          <span className="text-[10px] font-semibold tracking-[0.25em] text-text/60 uppercase">Scroll</span>
          <span className="relative h-8 w-px overflow-hidden bg-text/20">
            <span className="absolute inset-x-0 top-0 h-3 animate-[scroll-cue_1.6s_ease-in-out_infinite] bg-text" />
          </span>
        </div>
      </div>
    </section>
  );
}
