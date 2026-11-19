import Link from 'next/link';
import { LogoMark } from '@/components/brand/Logo';
import { CoinMark, CursorsMark } from '@/components/brand/marks';
import { AgentCards } from '@/components/landing/AgentCards';
import { BuiltOnNexconn } from '@/components/landing/BuiltOnNexconn';
import { GlassHero } from '@/components/landing/GlassHero';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { Badge, CardShell } from '@/components/ui';

/** Small uppercase label above a poster title. */
function Eyebrow({ children }: { children: string }) {
  return <p className="mb-3 text-xs font-semibold tracking-[0.2em] text-brand uppercase">{children}</p>;
}

export default function Landing() {
  return (
    // The landing is a black poster in every theme.
    <main data-theme="dark" className="min-h-dvh bg-bg text-text">
      <GlassHero />

      {/* Full width so the agent cards can span almost the whole screen; clipped only at the screen edge. */}
      <section id="agents" aria-labelledby="agents-heading" className="scroll-mt-8 overflow-x-clip px-safe py-20 md:px-10 md:py-28 xl:px-16">
        <div className="mx-auto max-w-6xl">
          <CursorsMark className="mb-6 size-12" />
          <Eyebrow>The crew</Eyebrow>
          <h2 id="agents-heading" className="font-poster text-5xl leading-[0.95] uppercase md:text-7xl">
            Three agents.
            <br />
            One group chat.
          </h2>
        </div>
        <div className="mx-auto mt-20 max-w-[1720px] pb-10">
          <AgentCards />
        </div>
      </section>

      <HowItWorks />

      <BuiltOnNexconn />

      <section aria-labelledby="proof-heading" className="mx-auto grid max-w-6xl items-center gap-10 px-safe py-20 md:grid-cols-2 md:px-10 md:py-28">
        <div>
          <Eyebrow>Tested before it ships</Eyebrow>
          <h2 id="proof-heading" className="font-poster text-5xl leading-[0.95] uppercase md:text-6xl">
            Every build gets played first
          </h2>
          <p className="mt-4 max-w-md text-dim">
            Glitch plays each build headlessly against its checklist and posts the result with a GIF, before anyone is asked to publish it.
          </p>
        </div>
        <CardShell
          agent="glitch"
          title="Playtest PASS · your game, v1"
          meta="every checklist item · 60 fps on a phone-class CPU"
          badges={<Badge tone="success">PASS</Badge>}
        >
          8 of 8 checks passed: the player jumps, the score counts up, and restart works. GIF attached.
        </CardShell>
      </section>

      <section aria-labelledby="cta-heading" className="bg-brand text-brand-ink">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-8 px-safe py-20 md:flex-row md:items-end md:justify-between md:px-10">
          <h2 id="cta-heading" className="font-poster text-6xl leading-[0.9] uppercase md:text-8xl">
            <span className="mb-6 grid size-16 place-items-center rounded-2xl bg-brand-ink" aria-hidden>
              <CoinMark className="size-10" />
            </span>
            Pitch your
            <br />
            first game
          </h2>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link
              href="/start"
              className="inline-flex min-h-12 items-center justify-center rounded-full bg-brand-ink px-7 text-sm font-bold tracking-[0.12em] text-brand uppercase hover:opacity-90"
            >
              Start a crew
            </Link>
            <Link
              href="/arcade"
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-brand-ink/40 px-7 text-sm font-bold tracking-[0.12em] uppercase hover:border-brand-ink"
            >
              Play the Arcade
            </Link>
          </div>
        </div>
      </section>

      <footer className="pb-safe mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-1 px-safe py-8 text-xs tracking-[0.14em] text-dim uppercase md:px-10">
        <LogoMark className="size-6" />
        <span>
          Made by <span className="text-text">Jatin</span> · Nexconn Build Challenge 2026 · Built on the Nexconn Chat SDK
        </span>
        <span className="flex gap-4 md:ml-auto">
          <Link href="/arcade" className="inline-flex min-h-11 items-center font-semibold hover:text-text">
            Arcade
          </Link>
          <Link href="/privacy" className="inline-flex min-h-11 items-center font-semibold hover:text-text">
            Privacy
          </Link>
        </span>
      </footer>
    </main>
  );
}
