'use client';

// The publish gate. Glitch posts it when a version passes: Play, the GIF, and Allow / Block for the
// crew owner and approvers (buttons hidden for others; the server checks the role either way).
// Allow -> the card becomes the published card with the /g link and Share.
import { parseCardMeta, type PublishCardContent } from '@crewarcade/shared';
import { useState } from 'react';
import { Badge, Button, CardShell, useToast } from '@/components/ui';
import { ApiRequestError } from '@/lib/api';
import type { ChatMessage } from '@/lib/chat/types';
import { useCardEnv } from './context';

export function PublishCard({ m, pub }: { m: ChatMessage; pub: PublishCardContent }) {
  const env = useCardEnv();
  const toast = useToast();
  const meta = parseCardMeta('publish', m.meta);
  const [busy, setBusy] = useState<'allow' | 'block' | null>(null);
  const title = pub.title ?? 'this game';
  const messageId = m.messageId ?? '';
  const decide = async (decision: 'allow' | 'block') => {
    setBusy(decision);
    try {
      const r = await env.actions.publish(messageId, decision);
      env.setMeta(m.channelId, messageId, r.metadata);
      toast(decision === 'allow' ? `${title} is live! 🎉` : 'Blocked. It stays private.', decision === 'allow' ? 'success' : 'info');
    } catch (e) {
      toast(e instanceof ApiRequestError ? e.message : "Couldn't save that.", 'danger');
    } finally {
      setBusy(null);
    }
  };
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title, text: `Play ${title} on CrewArcade`, url: pub.arcadeUrl });
      else {
        await navigator.clipboard.writeText(pub.arcadeUrl);
        toast('Link copied', 'success');
      }
    } catch {
      /* share sheet dismissed */
    }
  };
  const live = meta.status === 'approved';
  const deciding = meta.status === 'waiting' && env.canApprove;
  const hotfix = pub.hotfix;
  const heading = live
    ? hotfix
      ? `🎉 Hotfix v${pub.version} is live`
      : `🎉 ${title} is live`
    : meta.status === 'rejected'
      ? `🚫 v${pub.version} blocked`
      : hotfix
        ? `🩹 Hotfix v${pub.version}: publish?`
        : `🚀 Publish ${title} v${pub.version}?`;

  return (
    <CardShell
      agent="glitch"
      className="w-full"
      title={heading}
      meta={live ? `v${pub.version} · public on the Arcade` : hotfix ? `Fixes “${hotfix.bug}” · passes every old repro` : 'Passed its playtest'}
      badges={
        <Badge tone={live ? 'success' : meta.status === 'rejected' ? 'danger' : 'gold'}>
          {meta.status === 'waiting' ? 'Waiting for an approver' : `${live ? 'Allowed' : 'Blocked'} by ${meta.decidedBy ?? 'an approver'}`}
        </Badge>
      }
      actions={
        <>
          <Button size="sm" variant={deciding ? 'ghost' : 'primary'} onClick={() => env.actions.play(pub.gameId, pub.version, pub.title)}>
            ▶ Play
          </Button>
          {deciding && (
            <>
              <Button size="sm" variant="approve" loading={busy === 'allow'} disabled={!!busy} onClick={() => void decide('allow')} data-testid="publish-allow">
                ✅ Allow
              </Button>
              <Button size="sm" variant="ghost" loading={busy === 'block'} disabled={!!busy} onClick={() => void decide('block')} data-testid="publish-block">
                Block
              </Button>
            </>
          )}
          {live && (
            <>
              <a
                href={pub.arcadeUrl}
                className="inline-flex min-h-9 items-center justify-center rounded-2xl border border-border px-3 text-sm font-semibold"
                data-testid="publish-link"
              >
                Open page
              </a>
              <Button size="sm" variant="ghost" onClick={() => void share()}>
                Share
              </Button>
            </>
          )}
        </>
      }
    >
      {hotfix && (
        <div className="mb-2" data-testid="hotfix-info">
          {hotfix.fixGifUrl && !live && (
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element -- side-by-side GIF from our clips bucket */}
              <img
                src={hotfix.fixGifUrl}
                alt={`v${hotfix.fromVersion} fails the repro, v${pub.version} passes`}
                className="w-full rounded-2xl border border-border"
                loading="lazy"
              />
              <figcaption className="mt-1 text-xs text-dim">
                Left: v{hotfix.fromVersion} (bug) · Right: v{pub.version} (fixed), same moves
              </figcaption>
            </figure>
          )}
          <p className="mt-1 text-sm">
            <span aria-hidden>🏅 </span>Bug hunter: <strong>{hotfix.hunter}</strong>
          </p>
        </div>
      )}
      {pub.gifUrl && !live && !hotfix?.fixGifUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- playtest GIF from our clips bucket
        <img src={pub.gifUrl} alt={`${title} being played`} className="w-full rounded-2xl border border-border" loading="lazy" />
      )}
      <p className="mt-2 text-dim">
        {live
          ? `Anyone with the link can play: ${pub.arcadeUrl.replace(/^https?:\/\//, '')}`
          : meta.status === 'rejected'
            ? 'It stays private. Ask Forge for changes any time.'
            : env.canApprove
              ? 'Play it first. Nothing goes public until you tap Allow.'
              : 'Nothing goes public until an owner or approver taps Allow.'}
      </p>
    </CardShell>
  );
}
