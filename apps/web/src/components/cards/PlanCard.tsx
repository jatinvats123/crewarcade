'use client';

// Pixel's plan: the design at a glance, the acceptance checklist, live votes (optimistic), Approve
// for owners/approvers, and Change (a sheet to say what to change). Re-renders on metadata updates.
import { parseCardMeta, type PlanCardContent } from '@crewarcade/shared';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { GameScene } from '@/components/arcade/GameScene';
import { Badge, Button, CardFact, CardShell, CheckList, CheckMark, Sheet, useToast } from '@/components/ui';
import { ApiRequestError } from '@/lib/api';
import { optimisticVote, planStatusLabel } from '@/lib/cards';
import type { ChatMessage } from '@/lib/chat/types';
import { cn } from '@/lib/cn';
import { paletteFor } from '@/lib/palette';
import { useCardEnv } from './context';

const LANGUAGE_NAME: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  ta: 'Tamil',
  bn: 'Bengali',
  te: 'Telugu',
  mr: 'Marathi',
  gu: 'Gujarati',
  kn: 'Kannada',
  ml: 'Malayalam',
  ur: 'Urdu',
};

export function PlanCard({ m, plan }: { m: ChatMessage; plan: PlanCardContent }) {
  const env = useCardEnv();
  const toast = useToast();
  const meta = parseCardMeta('plan', m.meta);
  const status = planStatusLabel(meta);
  const mine = meta.voters[env.myId];
  const open = meta.status === 'pending';
  const [busy, setBusy] = useState<'approve' | 'change' | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [changeText, setChangeText] = useState('');
  const messageId = m.messageId;

  const setMeta = (metadata: Record<string, string>, replace = false) => messageId && env.setMeta(m.channelId, messageId, metadata, replace);

  // Every tap counts at once (optimistic). Only the newest request's answer is applied, so quick
  // yes -> no taps never flicker back; live metadata events from Nexconn settle the final state.
  const voteSeq = useRef(0);
  const vote = async (v: 'yes' | 'no') => {
    if (!messageId || busy === 'approve') return;
    const seq = ++voteSeq.current;
    const before = m.meta ?? {};
    setMeta(optimisticVote(before, env.myId, v));
    try {
      const res = await env.actions.vote(messageId, v);
      if (seq === voteSeq.current) setMeta(res.metadata);
    } catch (e) {
      if (seq === voteSeq.current) setMeta(before, true);
      toast(e instanceof ApiRequestError ? e.message : "Couldn't vote. Try again.", 'danger');
    }
  };

  const approve = async () => {
    if (!messageId || busy) return;
    setBusy('approve');
    try {
      setMeta((await env.actions.approve(messageId)).metadata);
      toast(`Approved! A game room for ${plan.title} is ready.`, 'success');
    } catch (e) {
      toast(e instanceof ApiRequestError ? e.message : "Couldn't approve. Try again.", 'danger');
    } finally {
      setBusy(null);
    }
  };

  const sendChange = async () => {
    if (!messageId || busy || changeText.trim().length < 3) return;
    setBusy('change');
    try {
      setMeta((await env.actions.requestChange(messageId, changeText.trim())).metadata);
      setChangeOpen(false);
      setChangeText('');
      toast('Sent to Pixel. A revised plan is on its way.', 'success');
    } catch (e) {
      toast(e instanceof ApiRequestError ? e.message : "Couldn't send the change. Try again.", 'danger');
    } finally {
      setBusy(null);
    }
  };

  const shown = showAll ? plan.acceptance : plan.acceptance.slice(0, 4);
  return (
    <>
      <CardShell
        agent="pixel"
        className={cn('group w-full', meta.status === 'superseded' && 'opacity-70')}
        cover={
          <>
            <GameScene seed={plan.slug} emoji="" colors={paletteFor(plan.gameId)} hud={false} motion="hover" className="absolute inset-0" />
            <span className="absolute top-3 left-3 -rotate-2 bg-brand px-2 py-0.5 text-[11px] font-bold tracking-[0.18em] text-brand-ink uppercase">
              Plan v{plan.version}
            </span>
          </>
        }
        title={plan.title}
        meta={`Plan v${plan.version}${plan.remixOf ? ` · remix of ${plan.remixOf}` : ''} · ${LANGUAGE_NAME[plan.language] ?? plan.language}`}
        badges={<Badge tone={status.tone}>{status.text}</Badge>}
        actions={
          meta.status === 'superseded' ? undefined : meta.status === 'approved' ? (
            meta.roomChannelId && meta.roomChannelId !== m.channelId ? (
              <Link
                href={env.roomHref(meta.roomChannelId)}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-brand px-4 font-semibold text-brand-ink shadow-card"
              >
                <span aria-hidden>🎮</span> Open game room
              </Link>
            ) : undefined
          ) : (
            <>
              <div className="flex gap-2" role="group" aria-label="Vote on this plan">
                <Button
                  variant="secondary"
                  size="sm"
                  aria-pressed={mine === 'yes'}
                  disabled={!open || busy === 'approve'}
                  onClick={() => void vote('yes')}
                  className={cn('flex-1 sm:flex-none', mine === 'yes' && 'border-success bg-success/15')}
                  aria-label={`Vote yes, ${meta.yes} so far`}
                >
                  👍{' '}
                  <span key={meta.yes} className="animate-pop tabular-nums">
                    {meta.yes}
                  </span>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-pressed={mine === 'no'}
                  disabled={!open || busy === 'approve'}
                  onClick={() => void vote('no')}
                  className={cn('flex-1 sm:flex-none', mine === 'no' && 'border-danger bg-danger/15')}
                  aria-label={`Vote no, ${meta.no} so far`}
                >
                  👎{' '}
                  <span key={meta.no} className="animate-pop tabular-nums">
                    {meta.no}
                  </span>
                </Button>
              </div>
              <Button variant="ghost" size="sm" disabled={!!busy || meta.status === 'changes_requested'} onClick={() => setChangeOpen(true)}>
                ✏️ Change
              </Button>
              {env.canApprove && (
                <Button variant="approve" size="sm" loading={busy === 'approve'} disabled={!!busy && busy !== 'approve'} onClick={() => void approve()}>
                  Approve
                </Button>
              )}
            </>
          )
        }
      >
        <p className="text-base leading-relaxed text-text">{plan.pitch}</p>
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
          <CardFact label="Controls">
            <span className="block">⌨️ {plan.controls.keyboard}</span>
            <span className="mt-1 block">📱 {plan.controls.touch}</span>
          </CardFact>
          <CardFact label="Play">{plan.coreLoop}</CardFact>
          {showAll && (
            <>
              <CardFact label="Win / lose">{plan.winLose}</CardFact>
              <CardFact label="Scoring">{plan.scoring}</CardFact>
              <CardFact label="Look">{plan.lookAndFeel}</CardFact>
              <CardFact label="Sound">{plan.sound}</CardFact>
            </>
          )}
        </div>
        <div className="mt-2.5">
          <CheckList
            label={
              <h4>
                <span className="sr-only">Checklist </span>Glitch will test
              </h4>
            }
          >
            {shown.map(a => (
              <li key={a.id} className="flex gap-2.5">
                <CheckMark state="todo" />
                <span>
                  <span className="sr-only">{a.id}: </span>
                  {a.text}
                </span>
              </li>
            ))}
          </CheckList>
        </div>
        <button type="button" onClick={() => setShowAll(v => !v)} className="mt-1 min-h-11 text-sm font-semibold text-pixel" aria-expanded={showAll}>
          {showAll ? 'Show less' : `Full plan${plan.acceptance.length > 4 ? ` (+${plan.acceptance.length - 4} checks)` : ''}`}
        </button>
        {plan.credits.length > 0 && <p className="text-xs text-faint">Ideas from {plan.credits.join(', ')}</p>}
      </CardShell>
      <Sheet
        open={changeOpen}
        onClose={() => setChangeOpen(false)}
        title={`Change ${plan.title}`}
        footer={
          <Button block loading={busy === 'change'} disabled={changeText.trim().length < 3} onClick={() => void sendChange()}>
            Send to Pixel
          </Button>
        }
      >
        <label htmlFor="change-text" className="text-sm text-dim">
          What should Pixel change? Pixel posts a revised plan and the votes start again.
        </label>
        <textarea
          id="change-text"
          value={changeText}
          onChange={e => setChangeText(e.target.value.slice(0, 280))}
          rows={3}
          placeholder="Make it faster, add a boss at the end…"
          className="mt-2 w-full rounded-2xl border border-border bg-surface-2 p-3 text-base outline-none focus:border-brand"
        />
        <p className="text-right text-xs text-faint">{changeText.length}/280</p>
      </Sheet>
    </>
  );
}
