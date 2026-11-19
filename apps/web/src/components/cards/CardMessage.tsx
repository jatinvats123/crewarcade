'use client';

// One renderer per card type, all on the common CardShell (agent avatar + name + AI badge, title,
// body, action row, status chip). Build and score cards are live (Phase 3), test and publish cards
// (Phase 4), bug cards and hotfix publish cards (Phase 5).
import { AGENTS, parseCardMeta, type AnyCard } from '@crewarcade/shared';
import Link from 'next/link';
import { agentKeyOf } from '@/components/identity/MemberAvatar';
import { GameScene } from '@/components/arcade/GameScene';
import { AiBadge, Avatar, Badge, Button, CardShell } from '@/components/ui';
import { ACCENT_TEXT } from '@/lib/agents';
import { paletteFor } from '@/lib/palette';
import type { ChatMessage } from '@/lib/chat/types';
import { useCardEnv } from './context';
import { BugCard } from './BugCard';
import { BuildCard } from './BuildCard';
import { PlanCard } from './PlanCard';
import { PublishCard } from './PublishCard';
import { TestCard } from './TestCard';

export function CardMessage({ m }: { m: ChatMessage }) {
  const card = m.card;
  if (!card)
    return (
      <div className="rounded-3xl border border-dashed border-border bg-surface px-4 py-3 text-sm text-dim">
        <span aria-hidden>🃏 </span>This card needs a newer version of CrewArcade. Refresh to see it.
      </div>
    );
  return <CardBody m={m} card={card} />;
}

function CardBody({ m, card }: { m: ChatMessage; card: AnyCard }) {
  const env = useCardEnv();
  const agent = agentKeyOf(m.senderId);
  switch (card.kind) {
    case 'plan':
      return <PlanCard m={m} plan={card.content} />;

    case 'handoff': {
      const c = card.content;
      const meta = parseCardMeta('handoff', m.meta);
      const to = AGENTS[c.to].displayName.split(' ')[0];
      const status = meta.status === 'waiting' ? `${to} will start soon` : meta.status === 'started' ? `${to} is on it` : 'Done';
      // A slim baton pass, not a full card: who handed what to whom, and where it stands.
      return (
        <article className="flex w-full animate-slide-up items-start gap-3.5 rounded-2xl border border-border bg-surface px-4 py-3.5">
          <span className="flex shrink-0 items-center gap-1.5 pt-0.5" aria-label={`${AGENTS[c.from].displayName} to ${AGENTS[c.to].displayName}`}>
            <Avatar kind="agent" agent={c.from} size="sm" />
            <span aria-hidden className="flex items-center text-faint">
              <span className="h-px w-3 bg-border" />▸
            </span>
            <Avatar kind="agent" agent={c.to} size="sm" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold tracking-[0.16em] text-faint uppercase">
              Handoff · <span className={ACCENT_TEXT[c.from]}>{AGENTS[c.from].displayName.split(' ')[0]}</span> →{' '}
              <span className={ACCENT_TEXT[c.to]}>{AGENTS[c.to].displayName.split(' ')[0]}</span>
            </p>
            <p className="mt-0.5 font-semibold">{c.task}</p>
            <p className="mt-0.5 line-clamp-2 text-sm text-dim">{c.contextSummary}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge tone={meta.status === 'done' ? 'success' : 'gold'}>{status}</Badge>
              <AiBadge />
            </div>
            {c.artifacts.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {c.artifacts.map(a => (
                  <li key={a.ref}>
                    <Badge tone="pixel">📎 {a.label}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </article>
      );
    }

    case 'roomLink': {
      const c = card.content;
      return (
        <CardShell
          agent={agent}
          className="group w-full"
          cover={<GameScene seed={c.title} emoji="" colors={paletteFor(c.gameId)} hud={false} motion="hover" className="absolute inset-0" />}
          title={c.title}
          meta={c.kind === 'live' ? 'Live Build Theater' : 'Game room: plan, builds, playtests'}
          actions={
            <Link
              href={env.roomHref(c.channelId)}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand px-4 font-semibold text-brand-ink shadow-card"
            >
              <span aria-hidden>🎮</span> Open room
            </Link>
          }
        >
          <p className="text-dim">The plan was approved. Forge builds it in its own room so this chat stays tidy.</p>
        </CardShell>
      );
    }

    case 'build':
      return <BuildCard m={m} build={card.content} />;

    case 'test':
      return <TestCard m={m} test={card.content} />;

    case 'publish':
      return <PublishCard m={m} pub={card.content} />;

    case 'bug':
      return <BugCard m={m} bug={card.content} />;

    case 'score': {
      const c = card.content;
      return (
        <CardShell
          agent={agent ?? 'glitch'}
          className="w-full"
          title={
            c.beatPlayerName
              ? `🔥 ${c.playerName} beat ${c.beatPlayerName}: ${c.score.toLocaleString()}!`
              : `🏆 ${c.playerName} took #${c.rank}: ${c.score.toLocaleString()}`
          }
          meta={`${c.title} · v${c.version}${c.beatScore !== undefined ? ` · beat ${c.beatScore.toLocaleString()}` : ''}`}
          actions={
            <Button size="sm" onClick={() => env.actions.play(c.gameId, 'latest', c.title)}>
              ▶ Play
            </Button>
          }
        >
          <p className="text-dim">{c.rank === 1 ? 'New #1 on the leaderboard. Can anyone beat it?' : `Now #${c.rank}. Can anyone beat it?`}</p>
        </CardShell>
      );
    }
  }
}
