'use client';

// Composer: multiline text (Enter sends on desktop, the button on phones; IME composition never
// sends), @mention autocomplete (sent as real mentions), photos (camera or gallery, compressed to
// <= 1600 px), hold-to-record voice notes (tap to lock), throttled typing signals.
import { LIMITS, TYPING_THROTTLE_MS } from '@crewarcade/shared';
import { useEffect, useId, useRef, useState, type ClipboardEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { MemberAvatar } from '@/components/identity/MemberAvatar';
import { IconButton, useToast } from '@/components/ui';
import { formatDuration } from '@/lib/chat/normalize';
import { insertMention, mentionCandidates, mentionQuery, resolveMentions, type MentionTarget } from '@/lib/chat/text';
import { cn } from '@/lib/cn';
import { compressImage, MAX_VOICE_S, startRecording } from '@/lib/media';

export interface ComposerProps {
  targets: MentionTarget[];
  disabled?: boolean;
  onSendText: (text: string, mentionUserIds: string[]) => void;
  onSendImage: (file: File) => void;
  /** mentionUserIds: agents tagged before recording ("@pixel " then hold the mic) get the voice pitch. */
  onSendVoice: (file: File, durationS: number, mentionUserIds: string[]) => void;
  onTyping: () => void;
}

type Recorder = Awaited<ReturnType<typeof startRecording>>;
type VoiceMode = 'idle' | 'starting' | 'holding' | 'locked';

export function ChatComposer({ targets, disabled, onSendText, onSendImage, onSendVoice, onTyping }: ComposerProps) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [query, setQuery] = useState<{ query: string; start: number } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [attachOpen, setAttachOpen] = useState(false);
  const [voice, setVoice] = useState<VoiceMode>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [cancelArmed, setCancelArmed] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const lastTyping = useRef(0);
  const finePointer = useRef(true);
  const rec = useRef<Recorder | null>(null);
  const press = useRef<{ x: number; t: number } | null>(null);
  const ids = { text: useId(), list: useId() };

  useEffect(() => {
    finePointer.current = matchMedia('(pointer: fine)').matches;
  }, []);

  const candidates = query ? mentionCandidates(query.query, targets) : [];
  // Only @mentions typed: the mic stays available, so a voice pitch can be addressed to an agent.
  const onlyMentions = !!text.trim() && resolveMentions(text, targets).length > 0 && text.replace(/@[\p{L}\p{N}_-]+/gu, '').trim() === '';
  const listOpen = candidates.length > 0;

  const updateQuery = (value: string, caret: number) => {
    setQuery(mentionQuery(value, caret));
    setHighlight(0);
  };

  const onChange = (value: string) => {
    setText(value);
    updateQuery(value, area.current?.selectionStart ?? value.length);
    const now = Date.now();
    if (value.trim() && now - lastTyping.current > TYPING_THROTTLE_MS) {
      lastTyping.current = now;
      onTyping();
    }
  };

  const pick = (t: MentionTarget) => {
    if (!query || !area.current) return;
    const caret = area.current.selectionStart ?? text.length;
    const next = insertMention(text, query.start, caret, t.handle);
    setText(next.text);
    setQuery(null);
    requestAnimationFrame(() => {
      area.current?.focus();
      area.current?.setSelectionRange(next.caret, next.caret);
    });
  };

  const send = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSendText(t, resolveMentions(t, targets));
    setText('');
    setQuery(null);
    lastTyping.current = 0;
    area.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // IME (Hindi, Tamil, Japanese... keyboards): Enter confirms the composition, it never sends.
    if (composing.current || e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (listOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight(h => (h + (e.key === 'ArrowDown' ? 1 : candidates.length - 1)) % candidates.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pick(candidates[highlight]!);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setQuery(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && finePointer.current) {
      e.preventDefault();
      send();
    }
  };

  const onFiles = async (files: FileList | File[] | null) => {
    setAttachOpen(false);
    for (const f of Array.from(files ?? [])) {
      if (!f.type.startsWith('image/')) {
        toast('Only photos can be shared for now', 'danger');
        continue;
      }
      try {
        onSendImage(await compressImage(f));
      } catch {
        toast("Couldn't prepare that photo", 'danger');
      }
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      void onFiles(files);
    }
  };

  // ---- voice notes
  useEffect(() => {
    if (voice !== 'holding' && voice !== 'locked') return;
    const t = setInterval(() => {
      const r = rec.current;
      if (!r) return;
      const s = (performance.now() - r.startedAt) / 1000;
      setElapsed(s);
      if (s >= MAX_VOICE_S) void finishVoice(true);
    }, 200);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- finishVoice is stable enough for a timer
  }, [voice]);

  const beginVoice = async (mode: 'holding' | 'locked') => {
    if (disabled || rec.current) return;
    setVoice('starting');
    try {
      rec.current = await startRecording();
      setElapsed(0);
      // If the finger lifted while the permission prompt was open, keep recording in locked mode.
      setVoice(press.current || mode === 'locked' ? mode : 'locked');
    } catch (e) {
      rec.current = null;
      setVoice('idle');
      toast((e as Error).name === 'NotAllowedError' ? 'Allow the microphone to send voice notes' : (e as Error).message, 'danger');
    }
  };

  async function finishVoice(sendIt: boolean) {
    const r = rec.current;
    rec.current = null;
    setVoice('idle');
    setCancelArmed(false);
    if (!r) return;
    if (!sendIt) return r.cancel();
    const result = await r.stop();
    if (result) {
      // "@pixel " typed before recording: the voice note goes to Pixel (transcribed on the server).
      const mentions = resolveMentions(text, targets);
      onSendVoice(result.file, result.durationS, mentions);
      if (onlyMentions) setText('');
    } else toast('Hold a little longer to record', 'info');
  }

  const micDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { x: e.clientX, t: performance.now() };
    void beginVoice('holding');
  };
  const micMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!press.current) return;
    setCancelArmed(press.current.x - e.clientX > 80);
  };
  const micUp = (e: PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    const held = performance.now() - p.t;
    if (p.x - e.clientX > 80) return void finishVoice(false);
    if (held < 350) {
      // A tap: keep recording hands-free.
      setVoice(v => (v === 'holding' ? 'locked' : v));
      return;
    }
    void finishVoice(true);
  };

  const recording = voice === 'holding' || voice === 'locked' || voice === 'starting';

  return (
    <div className="pb-safe relative border-t border-border bg-bg/90 px-2 pt-2 backdrop-blur">
      {listOpen && (
        <ul
          id={ids.list}
          role="listbox"
          aria-label="Mention someone"
          className="animate-slide-up absolute inset-x-2 bottom-full mb-2 max-h-64 overflow-y-auto rounded-2xl border border-border bg-surface p-1 shadow-card"
        >
          {candidates.map((c, i) => (
            <li
              key={c.userId}
              id={`${ids.list}-${i}`}
              role="option"
              aria-selected={i === highlight}
              onPointerDown={e => {
                e.preventDefault();
                pick(c);
              }}
              className={cn('flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2', i === highlight ? 'bg-surface-3' : 'hover:bg-surface-2')}
            >
              <MemberAvatar size="sm" person={{ id: c.userId, displayName: c.label, avatarEmoji: '🙂', avatarColor: 'violet' }} />
              <span className="font-semibold">@{c.handle}</span>
              {c.isAgent && <span className="truncate text-xs text-faint">{c.label}</span>}
            </li>
          ))}
        </ul>
      )}
      {attachOpen && (
        <div
          role="menu"
          aria-label="Share a photo"
          className="animate-slide-up absolute bottom-full left-2 mb-2 flex flex-col rounded-2xl border border-border bg-surface p-1 shadow-card"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => camera.current?.click()}
            className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-left hover:bg-surface-2"
          >
            <span aria-hidden>📷</span> Take a photo
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => gallery.current?.click()}
            className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-left hover:bg-surface-2"
          >
            <span aria-hidden>🖼️</span> Choose from gallery
          </button>
        </div>
      )}
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={e => void onFiles(e.target.files).finally(() => (e.target.value = ''))}
      />
      <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={e => void onFiles(e.target.files).finally(() => (e.target.value = ''))} />

      <div className="flex items-end gap-1">
        {recording ? (
          <div className="flex min-h-11 flex-1 items-center gap-3 rounded-3xl border border-danger/40 bg-danger/8 px-4" role="status" aria-live="polite">
            <span aria-hidden className="size-2.5 animate-pulse rounded-full bg-danger" />
            <span className="tabular-nums">{formatDuration(elapsed)}</span>
            <span className="truncate text-sm text-dim">
              {voice === 'starting'
                ? 'Starting the microphone…'
                : voice === 'holding'
                  ? cancelArmed
                    ? 'Release to cancel'
                    : '← Slide to cancel'
                  : 'Recording'}
            </span>
          </div>
        ) : (
          <>
            <IconButton
              label="Share a photo"
              icon={<span aria-hidden>＋</span>}
              aria-expanded={attachOpen}
              onClick={() => setAttachOpen(o => !o)}
              disabled={disabled}
            />
            <label className="sr-only" htmlFor={ids.text}>
              Message
            </label>
            <textarea
              ref={area}
              id={ids.text}
              rows={1}
              value={text}
              maxLength={LIMITS.chatTextChars}
              disabled={disabled}
              placeholder={disabled ? 'Connecting…' : 'Message, or @pixel to pitch a game'}
              onChange={e => onChange(e.target.value)}
              onKeyDown={onKeyDown}
              onSelect={e => updateQuery(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
              onCompositionStart={() => (composing.current = true)}
              onCompositionEnd={() => (composing.current = false)}
              onPaste={onPaste}
              onBlur={() => setTimeout(() => setQuery(null), 150)}
              aria-controls={listOpen ? ids.list : undefined}
              aria-activedescendant={listOpen ? `${ids.list}-${highlight}` : undefined}
              aria-autocomplete="list"
              enterKeyHint="send"
              className="field-sizing-content max-h-36 min-h-11 flex-1 resize-none rounded-3xl border border-border bg-surface px-4 py-2.5 text-base placeholder:text-faint focus:border-brand focus:outline-none disabled:opacity-60"
            />
          </>
        )}
        {recording && voice === 'locked' ? (
          <>
            <IconButton label="Cancel voice note" variant="filled" icon={<span aria-hidden>✕</span>} onClick={() => void finishVoice(false)} />
            <IconButton label="Send voice note" variant="brand" icon={<span aria-hidden>➤</span>} onClick={() => void finishVoice(true)} />
          </>
        ) : text.trim() && !recording && !onlyMentions ? (
          <IconButton label="Send" variant="brand" icon={<span aria-hidden>➤</span>} onClick={send} disabled={disabled} />
        ) : (
          <button
            type="button"
            aria-label={recording ? 'Recording: release to send' : 'Record a voice note (hold, or tap to start)'}
            title="Hold to record"
            disabled={disabled}
            onPointerDown={micDown}
            onPointerMove={micMove}
            onPointerUp={micUp}
            onPointerCancel={() => {
              press.current = null;
              void finishVoice(false);
            }}
            onKeyDown={e => {
              if ((e.key === 'Enter' || e.key === ' ') && !recording) {
                e.preventDefault();
                void beginVoice('locked');
              }
            }}
            onContextMenu={e => e.preventDefault()}
            className={cn(
              'inline-flex size-11 shrink-0 touch-none items-center justify-center rounded-full border border-border transition-transform select-none disabled:opacity-40',
              recording ? 'scale-125 bg-danger text-white' : 'bg-surface-2',
            )}
          >
            <span aria-hidden>🎙️</span>
          </button>
        )}
      </div>
    </div>
  );
}
