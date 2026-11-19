'use client';

import { cn } from '@/lib/cn';
import { useReveal } from './useReveal';

/**
 * "Built on Nexconn Chat": the sponsor's five pillars (AI agents as first-class chat members, plus
 * trust and safety) and exactly how CrewArcade uses each, with the Nexconn features underneath.
 * Only features that are live in the app are listed. Rows drift in (fade + un-blur) as they scroll in.
 */

const PILLARS = [
  {
    name: 'Agent identities',
    how: 'Pixel, Forge and Glitch are real Nexconn users, with tokens, avatars and presence, and members of every crew.',
    uses: ['Users + tokens', 'Group channels', 'Presence'],
  },
  {
    name: 'Agent-to-agent handoffs',
    how: 'Pixel hands the approved plan to Forge, Forge hands the build to Glitch, Glitch sends bugs back to Forge.',
    uses: ['Handoff card messages', 'Webhooks'],
  },
  {
    name: 'Streamed + structured messages',
    how: 'Agents stream their replies live, and every decision is a typed card: plan, build, test, publish, bug.',
    uses: ['Stream messages', 'Custom message types'],
  },
  {
    name: 'Human in the loop',
    how: 'The crew votes, an approver taps Approve, and nothing goes public until someone taps Allow.',
    uses: ['Live message metadata', 'Approver roles'],
  },
  {
    name: 'Audit trail',
    how: 'Every agent step and human decision lands in a ledger, shown as the "How it was made" story of each game.',
    uses: ['Decision ledger', 'Message history'],
  },
];

const ALSO = ['Direct messages', 'HQ voice messages', 'Built-in translation', 'Webhooks', 'Message metadata'];

function Row({ i, p }: { i: number; p: (typeof PILLARS)[number] }) {
  const { ref, shown } = useReveal<HTMLLIElement>();
  return (
    <li
      ref={ref}
      className={cn(
        'group grid gap-4 border-t border-text/12 py-8 transition-all duration-700 ease-out md:grid-cols-[5rem_1.1fr_1.4fr] md:items-baseline md:gap-8 md:py-10',
        shown ? 'translate-y-0 opacity-100 blur-0' : 'translate-y-10 opacity-0 blur-sm',
      )}
      style={{ transitionDelay: `${(i % 5) * 70}ms` }}
    >
      <span className="font-poster text-2xl text-text/30 transition-colors group-hover:text-brand">0{i + 1}</span>
      <p className="font-poster text-4xl leading-[0.95] uppercase md:text-5xl xl:text-6xl">{p.name}</p>
      <div>
        <p className="text-lg text-text/75">{p.how}</p>
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {p.uses.map(u => (
            <li key={u} className="rounded-full border border-text/20 px-2.5 py-1 text-[11px] font-medium text-text/75">
              {u}
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

export function BuiltOnNexconn() {
  const head = useReveal<HTMLDivElement>();
  return (
    <section id="nexconn" aria-labelledby="nexconn-heading" className="px-safe py-24 md:px-10 md:py-32 xl:px-16">
      <div className="mx-auto max-w-[1500px]">
        <div
          ref={head.ref}
          className={cn(
            'grid gap-8 transition-all duration-700 ease-out md:grid-cols-[1.4fr_1fr] md:items-end',
            head.shown ? 'opacity-100 blur-0' : 'opacity-0 blur-sm',
          )}
        >
          <div>
            <p className="mb-4 text-xs font-semibold tracking-[0.2em] text-brand uppercase">Sponsor · Nexconn Build Challenge 2026</p>
            <h2 id="nexconn-heading" className="font-poster text-6xl leading-[0.9] uppercase md:text-8xl">
              Built on
              <br />
              Nexconn Chat
            </h2>
          </div>
          <p className="max-w-md text-lg text-text/75 md:justify-self-end">
            Nexconn&apos;s bet: AI agents as real members of a chat, with people in control. CrewArcade runs on it end to end. Here is every pillar, and where
            it shows up.
          </p>
        </div>

        <ol className="mt-16 border-b border-text/12">
          {PILLARS.map((p, i) => (
            <Row key={p.name} i={i} p={p} />
          ))}
        </ol>

        <div className="mt-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-2 text-[10px] font-bold tracking-[0.25em] text-text/50 uppercase">Also on Nexconn</span>
            {ALSO.map(a => (
              <span key={a} className="rounded-full bg-text/8 px-3 py-1.5 text-xs font-medium text-text/80">
                {a}
              </span>
            ))}
          </div>
          <p className="text-[11px] font-semibold tracking-[0.2em] text-text/50 uppercase">
            Nexconn Build Challenge 2026 · on Reskilll · by <span className="text-brand">Jatin</span>
          </p>
        </div>
      </div>
    </section>
  );
}
