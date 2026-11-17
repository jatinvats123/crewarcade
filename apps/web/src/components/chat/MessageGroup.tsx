'use client';

// One sender's consecutive messages: avatar + name once, then the bubbles.
import { AGENTS, type CrewMember } from '@crewarcade/shared';
import { memo } from 'react';
import { agentKeyOf, MemberAvatar } from '@/components/identity/MemberAvatar';
import { AiBadge } from '@/components/ui';
import { ACCENT_TEXT } from '@/lib/agents';
import { clockTime, type SenderGroup } from '@/lib/chat/grouping';
import { tokenize, type MentionTarget } from '@/lib/chat/text';
import type { ChatMessage } from '@/lib/chat/types';
import { cn } from '@/lib/cn';
import { CardMessage } from '@/components/cards/CardMessage';
import { Markdown } from './Markdown';
import { TranslateTap } from './TranslateTap';
import { VoicePlayer } from './VoicePlayer';

interface Props {
  group: SenderGroup;
  sender: CrewMember | undefined;
  isMe: boolean;
  targets: MentionTarget[];
  onRetry: (localId: string) => void;
  onSeenBy: (messageId: string) => void;
  onOpenImage: (url: string) => void;
}

export const SenderGroupView = memo(function SenderGroupView({ group, sender, isMe, targets, onRetry, onSeenBy, onOpenImage }: Props) {
  const agent = agentKeyOf(group.senderId);
  const name = agent ? AGENTS[agent].displayName : (sender?.displayName ?? 'Someone');
  const last = group.messages.length - 1;
  const hasCard = group.messages.some(m => m.kind === 'card');
  return (
    <div className={cn('flex gap-2 [contain-intrinsic-size:auto_96px] [content-visibility:auto]', isMe ? 'flex-row-reverse' : 'flex-row')}>
      {!isMe && (
        <div className="w-8 shrink-0 self-end">
          <MemberAvatar
            size="sm"
            person={{ id: group.senderId, displayName: name, avatarEmoji: sender?.avatarEmoji ?? '🙂', avatarColor: sender?.avatarColor ?? 'violet' }}
          />
        </div>
      )}
      <div
        className={cn(
          'flex min-w-0 flex-col gap-0.5',
          hasCard ? 'w-full max-w-[min(100%,28rem)]' : 'max-w-[82%] sm:max-w-[70%]',
          isMe ? 'items-end' : 'items-start',
        )}
      >
        {!isMe && (
          <p className="flex items-center gap-1.5 px-1 text-xs font-semibold">
            <span className={agent ? ACCENT_TEXT[agent] : 'text-dim'}>{name}</span>
            {agent && <AiBadge />}
          </p>
        )}
        {group.messages.map((m, i) => (
          <Bubble key={m.key} m={m} isMe={isMe} showMeta={i === last} targets={targets} onRetry={onRetry} onSeenBy={onSeenBy} onOpenImage={onOpenImage} />
        ))}
      </div>
    </div>
  );
});

function Bubble({
  m,
  isMe,
  showMeta,
  targets,
  onRetry,
  onSeenBy,
  onOpenImage,
}: {
  m: ChatMessage;
  isMe: boolean;
  showMeta: boolean;
  targets: MentionTarget[];
  onRetry: (localId: string) => void;
  onSeenBy: (messageId: string) => void;
  onOpenImage: (url: string) => void;
}) {
  const bubble = cn(
    'rounded-3xl px-3.5 py-2 text-[0.95rem] leading-snug',
    isMe ? 'rounded-br-lg bg-brand/18 text-text' : 'rounded-bl-lg bg-surface-2 text-text',
  );
  let body: React.ReactNode;
  switch (m.kind) {
    case 'text':
      body = (
        <p className={cn(bubble, 'break-words whitespace-pre-wrap')}>
          {tokenize(m.text ?? '', targets).map((s, i) =>
            s.type === 'link' ? (
              <a key={i} href={s.href} target="_blank" rel="noopener noreferrer nofollow ugc" className="break-all text-glitch underline underline-offset-2">
                {s.value}
              </a>
            ) : s.type === 'mention' ? (
              <span key={i} className="rounded-md bg-pixel/18 px-0.5 font-semibold text-pixel">
                {s.value}
              </span>
            ) : (
              <span key={i}>{s.value}</span>
            ),
          )}
        </p>
      );
      break;
    case 'image':
      body = (
        <button
          type="button"
          onClick={() => m.image && onOpenImage(m.image.url)}
          aria-label="Open photo"
          className="relative block overflow-hidden rounded-3xl border border-border bg-surface-2"
          style={m.image?.thumb ? { backgroundImage: `url(${m.image.thumb})`, backgroundSize: 'cover' } : undefined}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- user media from the Nexconn file server */}
          <img src={m.image?.url} alt="Photo" loading="lazy" decoding="async" className="block max-h-80 w-auto max-w-[min(70vw,280px)] object-cover" />
          {m.status === 'sending' && (
            <span className="absolute inset-x-0 bottom-0 bg-overlay px-2 py-1 text-xs text-white">Uploading {m.progress ? `${m.progress}%` : '…'}</span>
          )}
        </button>
      );
      break;
    case 'voice':
      body = m.voice ? <VoicePlayer url={m.voice.url} durationS={m.voice.durationS} seed={m.key} isMe={isMe} /> : null;
      break;
    case 'card':
      body = <CardMessage m={m} />;
      break;
    case 'stream':
      // Agent replies stream in as Markdown; a soft caret shows while chunks are arriving.
      body = (
        <div className={cn(bubble, 'min-w-12')} aria-busy={!m.streamComplete || undefined}>
          <Markdown text={m.text ?? ''} caret={!m.streamComplete} />
        </div>
      );
      break;
    default:
      body = <p className={cn(bubble, 'text-dim italic')}>This message type isn't supported yet.</p>;
  }

  const seen = (m.readCount ?? 0) > 0;
  const translatable = !isMe && (m.kind === 'text' || (m.kind === 'stream' && m.streamComplete)) && !!m.text?.trim();
  return (
    <div className={cn('flex flex-col', isMe ? 'items-end' : 'items-start')}>
      {body}
      {translatable && <TranslateTap messageId={m.messageId} text={m.text ?? ''} />}
      {m.blockedReason && (
        <p role="alert" className="mt-1 max-w-full rounded-2xl border border-danger/40 bg-danger/8 px-3 py-1.5 text-xs text-danger">
          <span aria-hidden>⛔ </span>Not delivered: {m.blockedReason}
        </p>
      )}
      {m.status === 'failed' && m.localId ? (
        <button
          type="button"
          onClick={() => onRetry(m.localId!)}
          className="mt-0.5 inline-flex min-h-8 items-center gap-1 px-1 text-xs font-semibold text-danger"
        >
          <span aria-hidden>⚠</span> Not sent. Tap to retry
        </button>
      ) : (
        showMeta && (
          <p className="flex min-h-5 items-center gap-1 px-1 text-[0.7rem] text-faint">
            <time dateTime={new Date(m.sentTime).toISOString()}>{clockTime(m.sentTime)}</time>
            {isMe &&
              (m.status === 'sending' ? (
                <span aria-label="Sending">◷</span>
              ) : seen && m.messageId ? (
                <button
                  type="button"
                  onClick={() => onSeenBy(m.messageId!)}
                  className="-my-2 inline-flex min-h-8 items-center gap-0.5 font-semibold text-glitch"
                >
                  <span aria-hidden>✓✓</span> Seen by {m.readCount}
                </button>
              ) : (
                <span aria-label="Sent">✓</span>
              ))}
          </p>
        )
      )}
    </div>
  );
}
