'use client';

// Name + emoji avatar + ring colour (+ optional language). Used by onboarding, the invite screen and
// settings. Validation is the same zod schema the server uses.
import { AVATAR_COLORS, AVATAR_EMOJIS, DisplayName, LANGUAGES, type AvatarColor } from '@crewarcade/shared';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Avatar, Button } from '@/components/ui';
import { cn } from '@/lib/cn';

export interface ProfileValues {
  displayName: string;
  avatarEmoji: (typeof AVATAR_EMOJIS)[number];
  avatarColor: AvatarColor;
  language: (typeof LANGUAGES)[number]['code'];
}

/** Solid swatches so the six colours are easy to tell apart (the avatar itself uses the soft ring). */
const SWATCH: Record<AvatarColor, string> = {
  violet: 'bg-pixel',
  amber: 'bg-forge',
  cyan: 'bg-glitch',
  pink: 'bg-brand',
  green: 'bg-success',
  gold: 'bg-gold',
};
const COLOR_LABEL: Record<AvatarColor, string> = { violet: 'Violet', amber: 'Amber', cyan: 'Cyan', pink: 'Pink', green: 'Green', gold: 'Gold' };

export function randomProfile(): Omit<ProfileValues, 'displayName'> {
  return {
    avatarEmoji: AVATAR_EMOJIS[Math.floor(Math.random() * AVATAR_EMOJIS.length)]!,
    avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]!,
    language: 'en',
  };
}

export function ProfileForm({
  initial,
  submitLabel,
  onSubmit,
  compact,
  footer,
}: {
  initial: ProfileValues;
  submitLabel: string;
  onSubmit: (v: ProfileValues) => Promise<void>;
  /** Hide the language picker behind a disclosure (onboarding). */
  compact?: boolean;
  footer?: ReactNode;
}) {
  const [v, setV] = useState<ProfileValues>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const ids = { name: useId(), err: useId(), lang: useId() };
  const nameCheck = DisplayName.safeParse(v.displayName);
  const nameError = touched && !nameCheck.success ? nameCheck.error.issues[0]?.message : null;

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
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <div className="flex items-center gap-4">
        <Avatar kind="human" emoji={v.avatarEmoji} color={v.avatarColor} name={v.displayName || 'You'} size="lg" />
        <div className="min-w-0 flex-1">
          <label htmlFor={ids.name} className="mb-1 block text-sm font-semibold">
            Your name
          </label>
          <input
            id={ids.name}
            value={v.displayName}
            onChange={e => setV({ ...v, displayName: e.target.value })}
            onBlur={() => setTouched(true)}
            maxLength={24}
            autoComplete="nickname"
            enterKeyHint="go"
            placeholder="e.g. Riya"
            aria-invalid={!!nameError}
            aria-describedby={nameError ? ids.err : undefined}
            className={cn(
              'min-h-12 w-full rounded-2xl border bg-surface px-4 text-base placeholder:text-faint focus:outline-none',
              nameError ? 'border-danger' : 'border-border focus:border-brand',
            )}
          />
          {nameError && (
            <p id={ids.err} className="mt-1 text-sm text-danger" role="alert">
              {nameError}
            </p>
          )}
        </div>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Pick an avatar</legend>
        <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8" role="radiogroup" aria-label="Avatar emoji">
          {AVATAR_EMOJIS.map(emoji => (
            <button
              key={emoji}
              type="button"
              role="radio"
              aria-checked={v.avatarEmoji === emoji}
              aria-label={`Avatar ${emoji}`}
              onClick={() => setV({ ...v, avatarEmoji: emoji })}
              className={cn(
                'flex aspect-square min-h-11 items-center justify-center rounded-2xl border text-2xl transition-transform active:scale-90',
                v.avatarEmoji === emoji ? 'border-brand bg-brand/12' : 'border-transparent bg-surface-2 hover:bg-surface-3',
              )}
            >
              <span aria-hidden>{emoji}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Ring colour</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Avatar ring colour">
          {AVATAR_COLORS.map(c => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={v.avatarColor === c}
              aria-label={COLOR_LABEL[c]}
              title={COLOR_LABEL[c]}
              onClick={() => setV({ ...v, avatarColor: c })}
              className={cn(
                'size-11 rounded-full',
                SWATCH[c],
                v.avatarColor === c ? 'outline-3 outline-offset-2 outline-text' : 'opacity-80 hover:opacity-100',
              )}
            />
          ))}
        </div>
      </fieldset>

      {compact ? (
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-dim">
            <span aria-hidden className="transition-transform group-open:rotate-90">
              ▸
            </span>
            Language: {LANGUAGES.find(l => l.code === v.language)?.label}
          </summary>
          <LanguageSelect id={ids.lang} value={v.language} onChange={language => setV({ ...v, language })} />
        </details>
      ) : (
        <div>
          <label htmlFor={ids.lang} className="mb-1 block text-sm font-semibold">
            Language
          </label>
          <LanguageSelect id={ids.lang} value={v.language} onChange={language => setV({ ...v, language })} />
        </div>
      )}

      {error && (
        <p className="rounded-2xl border border-danger/40 bg-danger/8 px-4 py-3 text-sm" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" block loading={busy}>
        {submitLabel}
      </Button>
      {footer}
    </form>
  );
}

function LanguageSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: ProfileValues['language']) => void }) {
  return (
    <select
      id={id}
      data-tour="reply-language"
      value={value}
      onChange={e => onChange(e.target.value as ProfileValues['language'])}
      className="min-h-12 w-full rounded-2xl border border-border bg-surface px-4 text-base focus:border-brand focus:outline-none"
    >
      {LANGUAGES.map(l => (
        <option key={l.code} value={l.code} lang={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}
