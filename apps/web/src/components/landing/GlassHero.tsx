'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Logo } from '@/components/brand/Logo';
import { cn } from '@/lib/cn';
import { HERO_3D_QUERY, heroUses3d } from '@/lib/hero';

// three.js loads on demand, only where WebGL2 works.
const HeroScene = dynamic(() => import('./HeroScene'), { ssr: false });

const NAV = [
  { href: '#agents', label: 'Agents' },
  { href: '#how', label: 'How it works' },
  { href: '/arcade', label: 'Arcade' },
  { href: '/impact', label: 'Live numbers' },
  { href: '/try', label: 'Judge mode' },
];

const TAPE = 'PITCH → PLAN → BUILD → PLAYTEST → PUBLISH → ';

function canUse3d(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

/**
 * Poster-style hero: giant condensed headline, a glass game controller in front (WebGL), hairline
 * frame, a lime tape. Scrolling through the 170vh runway (desktop) turns and zooms the controller.
 */
export function GlassHero() {
  const section = useRef<HTMLElement>(null);
  const progress = useRef(0);
  const [use3d, setUse3d] = useState(false);
  const [quality, setQuality] = useState<'high' | 'low'>('high');
  const [ready, setReady] = useState(false);
  const [still, setStill] = useState(false);
  const [active, setActive] = useState(true);

  useEffect(() => {
    const wide = window.matchMedia(HERO_3D_QUERY).matches;
    setUse3d(heroUses3d({ webgl2: canUse3d(), wide }));
    setQuality(wide ? 'high' : 'low');
    setStill(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const el = section.current;
    if (!el) return;
    const onScroll = () => {
      const r = el.getBoundingClientRect();
      const run = r.height - window.innerHeight;
      progress.current = run > 0 ? Math.min(1, Math.max(0, -r.top / run)) : 0;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    const io = new IntersectionObserver(([e]) => setActive(!!e?.isIntersecting));
    io.observe(el);
    return () => {
      window.removeEventListener('scroll', onScroll);
      io.disconnect();
    };
  }, []);

  const show3d = use3d && ready;

  return (
    <section ref={section} aria-labelledby="hero-title" className="relative md:h-[170vh]">
      <div className="sticky top-0 flex h-dvh min-h-[560px] flex-col overflow-hidden bg-bg">
        {use3d && <HeroScene progress={progress} still={still} active={active} quality={quality} onReady={() => setReady(true)} />}

        <Frame />

        <header className="pt-safe relative z-10 flex items-center justify-between px-6 py-4 md:px-10">
          <Logo className="text-xl" />
          <nav aria-label="Main" className="flex items-center gap-1 text-xs font-semibold tracking-[0.18em] whitespace-nowrap uppercase">
            {NAV.map(n => (
              <Link key={n.href} href={n.href} className="hidden min-h-11 items-center px-3 text-dim hover:text-text lg:inline-flex">
                {n.label}
              </Link>
            ))}
            <Link
              href="/start"
              className="inline-flex min-h-11 items-center rounded-full border border-text/30 px-3 hover:border-brand hover:text-brand sm:px-4"
            >
              Start a crew
            </Link>
          </nav>
        </header>
        <Credit className="relative z-20 mt-1 text-center md:hidden" />

        {/* The HTML headline: what phones see, what screen readers read, and the first paint on desktop. */}
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center">
          <h1
            id="hero-title"
            className={cn(
              'font-poster leading-[0.9] text-text uppercase transition-opacity duration-300',
              show3d ? 'sr-only' : 'text-[clamp(3.25rem,13vw,11rem)] md:text-[min(16vw,25vh)]',
            )}
          >
            Your friends
            <br />+ 3 AI agents
          </h1>
        </div>

        <div className="relative z-10 mx-auto flex w-full max-w-lg flex-col items-center gap-4 px-6 pb-24 text-center md:pb-8">
          <p className="relative px-5 py-3 text-xs leading-relaxed font-medium tracking-[0.14em] text-dim uppercase">
            {/* Corner brackets, like a selection on a design canvas. */}
            <span aria-hidden className="absolute top-0 left-0 size-3 border-t border-l border-text/50" />
            <span aria-hidden className="absolute top-0 right-0 size-3 border-t border-r border-text/50" />
            <span aria-hidden className="absolute bottom-0 left-0 size-3 border-b border-l border-text/50" />
            <span aria-hidden className="absolute right-0 bottom-0 size-3 border-r border-b border-text/50" />
            One chat. A new game in minutes. Pitch it with your crew; Pixel plans it, Forge builds it, Glitch playtests it. Nothing goes public until you tap
            Allow.
          </p>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Link
              href="/start"
              className="inline-flex min-h-12 items-center justify-center rounded-full whitespace-nowrap bg-brand px-7 text-sm font-bold tracking-[0.12em] text-brand-ink uppercase hover:brightness-110"
            >
              Start a crew
            </Link>
            <Link
              href="/arcade"
              className="inline-flex min-h-12 items-center justify-center rounded-full whitespace-nowrap border border-text/30 px-7 text-sm font-bold tracking-[0.12em] uppercase hover:border-text"
            >
              Play the Arcade
            </Link>
          </div>
          {/* Judges: one tap, no sign-up, a guided tour of every feature (/try). */}
          <Link
            href="/try"
            data-testid="judge-cta"
            className="inline-flex min-h-11 max-w-full items-center justify-center gap-2 rounded-full border border-gold/60 bg-gold/10 px-5 text-sm font-semibold text-gold hover:bg-gold/20"
          >
            <span aria-hidden>★</span>
            <span className="min-w-0 truncate">I&apos;m a judge: guided tour</span>
            <span aria-hidden>→</span>
          </Link>
        </div>

        <Credit className="absolute bottom-10 left-10 z-20 hidden md:block" />
        <Tape />
      </div>
    </section>
  );
}

/** Who made it and for what: bottom-left of the frame on desktop, under the header on phones. */
function Credit({ className }: { className: string }) {
  return (
    <p className={cn('text-[11px] leading-relaxed font-semibold tracking-[0.2em] text-dim uppercase', className)}>
      <span className="text-text">
        By <span className="text-brand">Jatin</span>
      </span>
      <span className="mx-2 md:hidden" aria-hidden>
        ·
      </span>
      <br className="hidden md:block" />
      Nexconn Build Challenge 2026
      <br />
      Built on the Nexconn Chat SDK
    </p>
  );
}

/** Hairline frame with corner handles and three tall ovals, like a canvas being designed. */
function Frame() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-[1]">
      <svg className="absolute inset-0 size-full text-text/10" preserveAspectRatio="none" viewBox="0 0 100 100">
        <ellipse cx="22" cy="50" rx="11" ry="46" fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <ellipse cx="50" cy="50" rx="11" ry="46" fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <ellipse cx="78" cy="50" rx="11" ry="46" fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1="34" x2="100" y2="34" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <line x1="0" y1="78" x2="100" y2="78" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="absolute inset-4 border border-text/15 md:inset-6">
        {['-left-1 -top-1', '-right-1 -top-1', '-left-1 -bottom-1', '-right-1 -bottom-1', '-left-1 top-1/2', '-right-1 top-1/2'].map(pos => (
          <span key={pos} className={cn('absolute size-2 bg-text', pos)} />
        ))}
      </div>
    </div>
  );
}

/** The lime tape across the bottom-right corner, its words sliding (stopped by reduced motion). */
function Tape() {
  return (
    <div aria-hidden className="pointer-events-none absolute -right-24 bottom-3 z-20 w-[min(46rem,120vw)] origin-center -rotate-[14deg] md:bottom-16">
      <div className="overflow-hidden bg-brand py-2 text-brand-ink">
        <div className="flex w-max animate-marquee font-poster text-2xl leading-none whitespace-nowrap md:text-3xl">
          <span className="pr-2">{TAPE.repeat(4)}</span>
          <span className="pr-2">{TAPE.repeat(4)}</span>
        </div>
      </div>
    </div>
  );
}
