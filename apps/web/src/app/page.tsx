import { AGENTS, type AgentKey } from '@crewarcade/shared';
import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { ThemeToggle } from '@/components/brand/ThemeToggle';
import { Avatar, Badge, CardShell, StateChip } from '@/components/ui';
import { ACCENT_TEXT } from '@/lib/agents';

const STEPS = [
  { emoji: '💬', title: 'Pitch in the chat', text: 'Drop ideas with your crew. Vote on the best one.' },
  { emoji: '🎨', title: 'Pixel plans it', text: 'A game plan with a checklist. An approver taps Approve.' },
  { emoji: '🔨', title: 'Forge builds it', text: 'One self-contained game, streamed live into the chat.' },
  { emoji: '🧪', title: 'Glitch playtests it', text: 'PASS or FAIL against the checklist, with a GIF.' },
  { emoji: '🚀', title: 'You publish it', text: 'Nothing goes public until someone taps Allow.' },
];

export default function Landing() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-safe">
      <header className="pt-safe flex items-center justify-between py-3">
        <Logo className="text-xl" />
        <ThemeToggle />
      </header>

      <section className="flex flex-col items-start gap-5 py-10 sm:py-16">
        <Badge tone="brand">Built on the Nexconn Chat SDK</Badge>
        <h1 className="font-display text-4xl leading-[1.05] font-bold tracking-tight sm:text-6xl">
          Your friends + 3 AI agents.
          <br />
          <span className="text-brand">One chat.</span> A new game in minutes.
        </h1>
        <p className="max-w-xl text-lg text-dim">
          Make a crew, pitch a game, and watch Pixel, Forge and Glitch design, build and playtest it right in your group chat. Then play it, break it, fix it,
          and share it.
        </p>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Link
            href="/start"
            className="inline-flex min-h-13 items-center justify-center rounded-2xl bg-brand px-6 text-lg font-semibold text-brand-ink shadow-card hover:brightness-110"
          >
            Start a crew
          </Link>
          <Link
            href="/dev/ui"
            className="inline-flex min-h-13 items-center justify-center rounded-2xl border border-border bg-surface-2 px-6 text-lg font-semibold hover:bg-surface-3"
          >
            See the UI kit
          </Link>
        </div>
      </section>

      <section aria-labelledby="crew-heading" className="grid gap-3 sm:grid-cols-3">
        <h2 id="crew-heading" className="sr-only">
          Meet the agents
        </h2>
        {(Object.keys(AGENTS) as AgentKey[]).map((key, i) => (
          <div key={key} className="flex items-start gap-3 rounded-card border border-border bg-surface p-4">
            <Avatar kind="agent" agent={key} size="lg" presence="online" />
            <div className="min-w-0">
              <p className={`font-display font-bold ${ACCENT_TEXT[key]}`}>{AGENTS[key].displayName}</p>
              <p className="text-sm text-dim">{AGENTS[key].tagline}</p>
              <StateChip className="mt-2" state={(['planning', 'building', 'testing'] as const)[i]!} />
            </div>
          </div>
        ))}
      </section>

      <section aria-labelledby="how-heading" className="py-10">
        <h2 id="how-heading" className="mb-4 font-display text-2xl font-bold">
          How a game gets made
        </h2>
        <ol className="grid gap-3 sm:grid-cols-5">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-card border border-border bg-surface p-4">
              <span className="text-2xl" aria-hidden>
                {s.emoji}
              </span>
              <p className="mt-2 font-display font-bold">
                {i + 1}. {s.title}
              </p>
              <p className="text-sm text-dim">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="pb-12">
        <CardShell
          agent="glitch"
          title="Playtest PASS · your game, v1"
          meta="every checklist item · 60 fps on a phone-class CPU"
          badges={<Badge tone="success">PASS</Badge>}
        >
          Every build is played headlessly against its checklist before anyone is asked to publish it.
        </CardShell>
      </section>

      <footer className="pb-safe mt-auto border-t border-border py-6 text-sm text-faint">Built with the Nexconn Chat SDK · Nexconn Build Challenge 2026</footer>
    </main>
  );
}
