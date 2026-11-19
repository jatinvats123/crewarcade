'use client';

// A player's bug report (Phase 5), posted by Glitch and updated live through metadata:
// queued -> Glitch replays it -> reproduced (the bug on camera) -> Forge's hotfix -> fixed,
// or not reproduced with Glitch's one follow-up question.
import { parseCardMeta, type BugCardContent } from '@crewarcade/shared';
import { Badge, Button, CardShell } from '@/components/ui';
import type { ChatMessage } from '@/lib/chat/types';
import { useCardEnv } from './context';

const TONE = { open: 'gold', reproduced: 'danger', not_reproduced: 'pixel', fixed: 'success' } as const;
const LABEL = { open: 'Reported', reproduced: 'Reproduced', not_reproduced: 'Not reproduced yet', fixed: 'Fixed' } as const;

export function BugCard({ m, bug }: { m: ChatMessage; bug: BugCardContent }) {
  const env = useCardEnv();
  const meta = parseCardMeta('bug', m.meta);
  const who = bug.reporterName ?? 'A player';
  const line =
    meta.status === 'fixed'
      ? `Fixed in v${meta.fixedInVersion ?? '?'}. Thanks, ${who}: bug hunter credit on the game page 🏅`
      : meta.status === 'not_reproduced'
        ? null
        : meta.status === 'reproduced'
          ? meta.hotfixVersion
            ? `Forge's hotfix v${meta.hotfixVersion} is being built and tested against every old repro.`
            : 'Forge is on the hotfix.'
          : meta.phase === 'repro'
            ? 'Glitch is replaying it on camera…'
            : 'Glitch will try to reproduce it.';
  return (
    <CardShell
      agent="glitch"
      className="w-full"
      title={`Bug from ${who}`}
      meta={bug.version ? `on v${bug.version}` : undefined}
      badges={
        <Badge tone={TONE[meta.status]} data-testid="bug-status">
          {LABEL[meta.status]}
        </Badge>
      }
      actions={
        <Button size="sm" variant="ghost" onClick={() => env.actions.play(bug.gameId, meta.fixedInVersion ?? bug.version ?? 'latest')}>
          ▶ Play
        </Button>
      }
    >
      <p className="break-words whitespace-pre-wrap">{bug.description}</p>
      {bug.screenshotUrl && (
        <a href={bug.screenshotUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block w-24">
          {/* eslint-disable-next-line @next/next/no-img-element -- members-only screenshot route */}
          <img src={bug.screenshotUrl} alt="The player's screenshot" className="w-24 rounded-xl border border-border object-cover" loading="lazy" />
        </a>
      )}
      {meta.reproClipUrl && meta.status !== 'not_reproduced' && (
        <figure className="mt-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- repro GIF from our clips bucket */}
          <img src={meta.reproClipUrl} alt="The bug on camera" className="w-full rounded-2xl border border-border" loading="lazy" data-testid="bug-repro-gif" />
          {meta.check && <figcaption className="mt-1 text-xs text-dim">{meta.check}</figcaption>}
        </figure>
      )}
      {meta.status === 'not_reproduced' && meta.question && (
        <p className="mt-2 rounded-2xl bg-surface-2 px-3 py-2 text-sm">
          <span aria-hidden>❓ </span>
          {meta.question}
          <span className="mt-1 block text-xs text-dim">Reply with “bug: …” and more detail.</span>
        </p>
      )}
      {line && <p className="mt-2 text-sm text-dim">{line}</p>}
    </CardShell>
  );
}
