'use client';

// One renderer per card type, all on the common CardShell (agent avatar + name + AI badge, title,
// body, action row, status chip). Build and score cards are live (Phase 3), test and publish cards
// (Phase 4); bug cards render their content and get their buttons with the flows that serve them.
import { AGENTS, parseCardMeta, type AnyCard } from '@crewarcade/shared';
import Link from 'next/link';
import { agentKeyOf } from '@/components/identity/MemberAvatar';
import { Avatar, Badge, Button, CardShell } from '@/components/ui';
import type { ChatMessage } from '@/lib/chat/types';
import { useCardEnv } from './context';
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
      return (
        <CardShell
          agent={c.from}
          className="w-full"
          title={
            <span className="inline-flex items-center gap-2">
              <span>Handoff</span>
              <Avatar kind="agent" agent={c.from} size="sm" />
              <span aria-label="to">→</span>
              <Avatar kind="agent" agent={c.to} size="sm" />
            </span>
          }
          meta={`${AGENTS[c.from].displayName} → ${AGENTS[c.to].displayName}`}
          badges={<Badge tone={meta.status === 'done' ? 'success' : 'gold'}>{status}</Badge>}
        >
          <p className="font-semibold">{c.task}</p>
          <p className="mt-1 text-dim">{c.contextSummary}</p>
          {c.artifacts.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {c.artifacts.map(a => (
                <li key={a.ref}>
                  <Badge tone="pixel">📎 {a.label}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardShell>
      );
    }

    case 'roomLink': {
      const c = card.content;
      return (
        <CardShell
          agent={agent}
          className="w-full"
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

    case 'bug': {
      const c = card.content;
      const meta = parseCardMeta('bug', m.meta);
      return (
        <CardShell
          agent={agent}
          className="w-full"
          title="🐞 Bug report"
          badges={<Badge tone={meta.status === 'fixed' ? 'success' : 'danger'}>{meta.status.replace('_', ' ')}</Badge>}
        >
          <p>{c.description}</p>
        </CardShell>
      );
    }

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
