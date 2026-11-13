'use client';

import { LIMITS } from '@crewarcade/shared';
import { useState, type FormEvent } from 'react';
import { IconButton } from './IconButton';

export interface ComposerProps {
  placeholder?: string;
  disabled?: boolean;
  onSend?: (text: string) => void;
  onMic?: () => void;
  onAttach?: () => void;
}

/** Sticky chat composer shell: attach, auto-growing text, mic, send. Respects the bottom safe area. */
export function Composer({ placeholder = 'Pitch a game, or @mention an agent…', disabled, onSend, onMic, onAttach }: ComposerProps) {
  const [text, setText] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onSend?.(t);
    setText('');
  };
  return (
    <form onSubmit={submit} className="pb-safe sticky bottom-0 z-10 flex items-end gap-1 border-t border-border bg-bg/90 px-2 pt-2 backdrop-blur">
      <IconButton label="Attach a screenshot" icon={<span aria-hidden>＋</span>} onClick={onAttach} disabled={disabled} />
      <label className="sr-only" htmlFor="composer-text">
        Message
      </label>
      <textarea
        id="composer-text"
        rows={1}
        value={text}
        maxLength={LIMITS.chatTextChars}
        disabled={disabled}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
        placeholder={placeholder}
        className="field-sizing-content max-h-36 min-h-11 flex-1 resize-none rounded-3xl border border-border bg-surface px-4 py-2.5 text-base placeholder:text-faint focus:border-brand focus:outline-none"
      />
      {text.trim() ? (
        <IconButton label="Send" variant="brand" type="submit" icon={<span aria-hidden>➤</span>} disabled={disabled} />
      ) : (
        <IconButton label="Record a voice note" variant="filled" icon={<span aria-hidden>🎙️</span>} onClick={onMic} disabled={disabled} />
      )}
    </form>
  );
}
