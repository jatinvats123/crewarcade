'use client';

import { AGENT_STATES } from '@crewarcade/shared';
import { useState, type ReactNode } from 'react';
import { Logo, LogoMark } from '@/components/brand/Logo';
import { ThemeToggle } from '@/components/brand/ThemeToggle';
import {
  AiBadge,
  Avatar,
  Badge,
  Button,
  CardShell,
  Chip,
  Composer,
  EmptyState,
  ErrorState,
  HUMAN_RINGS,
  IconButton,
  MessageSkeleton,
  RoleBadge,
  Sheet,
  Skeleton,
  StateChip,
  TranslatedBadge,
  useToast,
  type HumanColor,
} from '@/components/ui';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3" aria-labelledby={`s-${title}`}>
      <h2 id={`s-${title}`} className="font-display text-sm font-bold tracking-widest text-faint uppercase">
        {title}
      </h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

export function Gallery() {
  const [sheet, setSheet] = useState(false);
  const [chip, setChip] = useState('all');
  const toast = useToast();
  const colors = Object.keys(HUMAN_RINGS) as HumanColor[];
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="pt-safe px-safe sticky top-0 z-20 flex items-center justify-between border-b border-border bg-bg/90 py-2 backdrop-blur">
        <Logo className="text-lg" />
        <ThemeToggle />
      </header>
      <main className="px-safe mx-auto w-full max-w-3xl flex-1 space-y-8 py-6">
        <h1 className="font-display text-3xl font-bold">UI kit</h1>

        <Section title="Brand">
          <Logo className="text-3xl" />
          <LogoMark className="size-12" />
        </Section>

        <Section title="Button">
          <Button>Primary</Button>
          <Button variant="approve">Approve</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Block</Button>
          <Button loading>Building</Button>
          <Button size="lg" icon={<span aria-hidden>▶</span>}>
            Play
          </Button>
          <Button size="sm" disabled>
            Disabled
          </Button>
        </Section>

        <Section title="IconButton">
          <IconButton label="Ghost" icon={<span aria-hidden>⋯</span>} />
          <IconButton label="Filled" variant="filled" icon={<span aria-hidden>🎙️</span>} />
          <IconButton label="Brand" variant="brand" icon={<span aria-hidden>➤</span>} />
        </Section>

        <Section title="Avatar">
          <Avatar kind="agent" agent="pixel" presence="online" />
          <Avatar kind="agent" agent="forge" state="building" presence="online" />
          <Avatar kind="agent" agent="glitch" size="lg" state="testing" presence="online" />
          {colors.map((c, i) => (
            <Avatar
              key={c}
              kind="human"
              name={`Player ${i + 1}`}
              emoji={['🦊', '🐼', '🐙', '🦄', '🐸', '🐯'][i]!}
              color={c}
              presence={i % 3 === 0 ? 'online' : i % 3 === 1 ? 'away' : 'offline'}
            />
          ))}
        </Section>

        <Section title="Badge">
          <RoleBadge role="owner" />
          <RoleBadge role="approver" />
          <AiBadge />
          <TranslatedBadge from="Hindi" />
          <Badge tone="success">PASS</Badge>
          <Badge tone="danger">FAIL</Badge>
          <Badge tone="pixel">Plan</Badge>
          <Badge tone="forge">v2</Badge>
          <Badge tone="glitch">Repro saved</Badge>
        </Section>

        <Section title="Chip (agent states)">
          {AGENT_STATES.map(s => (
            <StateChip key={s} state={s} />
          ))}
          <StateChip state="building" detail="v2 · 0:42" />
        </Section>

        <Section title="Chip (filters)">
          {['all', 'new', 'top', 'remixes'].map(c => (
            <Chip key={c} selected={chip === c} onClick={() => setChip(c)}>
              {c}
            </Chip>
          ))}
        </Section>

        <section className="space-y-3">
          <h2 className="font-display text-sm font-bold tracking-widest text-faint uppercase">Card shell</h2>
          <CardShell
            agent="pixel"
            title="Plan: Moon Mango Mayhem"
            meta="v1 · just now · 2 of 3 votes"
            badges={<Badge tone="pixel">Voting</Badge>}
            actions={
              <>
                <Button variant="secondary" size="sm">
                  👎 Not this
                </Button>
                <Button variant="approve" size="sm">
                  👍 Vote yes
                </Button>
              </>
            }
          >
            <ul className="list-disc space-y-1 pl-5 text-dim">
              <li>Tap or Space to flap; dodge falling mangoes</li>
              <li>+1 per second, +10 per golden mango</li>
              <li>6 acceptance checks Glitch will play against</li>
            </ul>
          </CardShell>
          <CardShell
            agent="glitch"
            title="Playtest FAIL · v1"
            meta="5/6 checks · 58 fps"
            badges={<Badge tone="danger">FAIL</Badge>}
            actions={<Button size="sm">Ask Forge to fix</Button>}
          >
            A4 failed: grabbing a golden mango did not add 10 points.
          </CardShell>
          <CardShell
            title="Publish Moon Mango Mayhem v2?"
            meta="Needs an approver"
            actions={
              <>
                <Button variant="danger" size="sm">
                  Block
                </Button>
                <Button variant="approve" size="sm">
                  Allow
                </Button>
              </>
            }
          >
            Nothing goes public until an approver taps Allow.
          </CardShell>
        </section>

        <Section title="Sheet + Toast">
          <Button variant="secondary" onClick={() => setSheet(true)}>
            Open sheet
          </Button>
          <Button variant="secondary" onClick={() => toast('Plan approved. Forge is building v1.', 'success')}>
            Success toast
          </Button>
          <Button variant="secondary" onClick={() => toast('Build failed the static check.', 'danger')}>
            Error toast
          </Button>
        </Section>

        <section className="space-y-3">
          <h2 className="font-display text-sm font-bold tracking-widest text-faint uppercase">Skeleton</h2>
          <MessageSkeleton />
          <Skeleton className="h-24 w-full" />
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <EmptyState title="No games yet" action={<Button size="sm">Pitch one</Button>}>
            Pitch an idea in the chat and Pixel will turn it into a plan.
          </EmptyState>
          <ErrorState onRetry={() => toast('Retrying…')}>We could not reach the chat server.</ErrorState>
        </section>
      </main>
      <Composer
        onSend={t => toast(`Sent: ${t}`)}
        onMic={() => toast('Voice notes arrive in a later phase')}
        onAttach={() => toast('Screenshots arrive in a later phase')}
      />
      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="Report a bug"
        footer={
          <Button block onClick={() => setSheet(false)}>
            Send to Glitch
          </Button>
        }
      >
        <p className="text-sm text-dim">Describe what went wrong. Glitch turns it into a saved repro test.</p>
      </Sheet>
    </div>
  );
}
