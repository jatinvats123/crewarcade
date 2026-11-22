'use client';

// The calm one-screen profile form used by sign-up (/start) and the invite screen (/i/<code>): a big
// name, 8 players (one preselected, the rest on demand) and the chat language picked from the
// browser. The ring colour is chosen at random; Settings (ProfileForm) changes everything later.
import { AVATAR_COLORS, AVATAR_EMOJIS, DisplayName, LANGUAGES } from '@crewarcade/shared';
import { useEffect, useId, useState, type FormEvent } from 'react';
import type { ProfileValues } from '@/components/identity/ProfileForm';
import { cn } from '@/lib/cn';
import { LANGUAGE_ENGLISH, detectLanguage } from '@/lib/language';

const SHOWN = 8;
const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;

export function QuickProfileForm({
  onSubmit,
  submitLabel,
  nameSize = 'hero',
  hint = 'Press Enter to start. Change anything later in Settings.',
}: {
  onSubmit: (v: ProfileValues) => Promise<void>;
  submitLabel: string;
  /** 'hero' on /start; 'md' when something else (the crew name on an invite) is the headline. */
  nameSize?: 'hero' | 'md';
  hint?: string;
}) {
  const [v, setV] = useState<ProfileValues>(() => ({
    displayName: '',
    avatarEmoji: pick(AVATAR_EMOJIS.slice(0, SHOWN)),
    avatarColor: pick(AVATAR_COLORS),
    language: 'en',
  }));
  const [allPlayers, setAllPlayers] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { name: useId(), err: useId(), lang: useId() };

  // The browser's language is only known on the client, after hydration.
  useEffect(() => {
    const language = detectLanguage(navigator.languages?.length ? navigator.languages : [navigator.language]);
    setV(cur => ({ ...cur, language }));
  }, []);

  const nameCheck = DisplayName.safeParse(v.displayName);
  const nameError = touched && !nameCheck.success ? nameCheck.error.issues[0]?.message : null;
  const players = allPlayers ? AVATAR_EMOJIS : AVATAR_EMOJIS.slice(0, SHOWN);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!nameCheck.success) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ ...v, displayName: nameCheck.data });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="mx-auto flex w-full max-w-2xl flex-col items-center">
      <label htmlFor={ids.name} className="sr-only">
        Your name
      </label>
      <input
        id={ids.name}
        value={v.displayName}
        onChange={e => setV({ ...v, displayName: e.target.value })}
        onBlur={() => v.displayName && setTouched(true)}
        maxLength={24}
        autoFocus
        autoComplete="nickname"
        enterKeyHint="go"
        spellCheck={false}
        placeholder="Your name"
        aria-invalid={!!nameError}
        aria-describedby={nameError ? ids.err : undefined}
        className={cn(
          'w-full max-w-[460px] border-0 border-b-2 bg-transparent px-0 pt-1 pb-3 text-center font-poster tracking-wide uppercase placeholder:text-text/15 focus:outline-none focus-visible:outline-none',
          nameSize === 'hero' ? 'text-5xl sm:text-[68px]' : 'text-4xl sm:text-5xl',
          nameError ? 'border-danger' : 'border-text/20 focus:border-brand',
        )}
      />
      <p id={ids.err} role="alert" className="mt-2 min-h-5 text-sm text-danger">
        {nameError}
      </p>

      <fieldset className={nameSize === 'hero' ? 'mt-6 sm:mt-8' : 'mt-3'}>
        <legend className="mx-auto mb-3.5 text-sm text-dim">Your player</legend>
        <div role="radiogroup" aria-label="Your player" className="flex max-w-[680px] flex-wrap justify-center gap-2.5">
          {players.map(emoji => (
            <button
              key={emoji}
              type="button"
              role="radio"
              aria-checked={v.avatarEmoji === emoji}
              aria-label={`Player ${emoji}`}
              onClick={() => setV({ ...v, avatarEmoji: emoji })}
              className={cn(
                'flex size-14 items-center justify-center rounded-2xl border bg-surface text-[28px] transition-transform active:scale-90 sm:size-16 sm:text-3xl',
                v.avatarEmoji === emoji ? 'border-2 border-brand' : 'border-border hover:border-text/25',
              )}
            >
              <span aria-hidden>{emoji}</span>
            </button>
          ))}
          {!allPlayers && (
            <button
              type="button"
              onClick={() => setAllPlayers(true)}
              aria-label={`Show ${AVATAR_EMOJIS.length - SHOWN} more players`}
              className="flex size-14 items-center justify-center rounded-2xl border border-border bg-surface text-sm font-semibold text-dim hover:border-text/25 hover:text-text sm:size-16"
            >
              +{AVATAR_EMOJIS.length - SHOWN}
            </button>
          )}
        </div>
      </fieldset>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-sm text-dim">
        <label htmlFor={ids.lang}>They reply in</label>
        <span className="relative">
          <select
            id={ids.lang}
            value={v.language}
            onChange={e => setV({ ...v, language: e.target.value as ProfileValues['language'] })}
            className="min-h-11 cursor-pointer appearance-none rounded-full field-sizing-content border border-border bg-surface py-0 pr-9 pl-4 font-semibold text-text hover:border-text/25 focus:border-brand focus:outline-none"
          >
            {LANGUAGES.map(l => (
              <option key={l.code} value={l.code} lang={l.code}>
                {l.code === 'en' ? l.label : `${l.label} · ${LANGUAGE_ENGLISH[l.code]}`}
              </option>
            ))}
          </select>
          <span aria-hidden className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-xs text-dim">
            ▾
          </span>
        </span>
        <span className="text-xs text-faint">picked from your browser</span>
      </div>

      {error && (
        <p className="mt-6 rounded-2xl border border-danger/40 bg-danger/8 px-4 py-3 text-sm" role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        aria-busy={busy || undefined}
        className="mt-8 inline-flex min-h-14 w-full max-w-[340px] items-center justify-center gap-2.5 rounded-2xl bg-brand text-base font-semibold text-brand-ink transition-[filter,transform] hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
      >
        {busy && <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
        {submitLabel} <span aria-hidden>→</span>
      </button>
      <p className="mt-4 text-sm text-faint">{hint}</p>
    </form>
  );
}
