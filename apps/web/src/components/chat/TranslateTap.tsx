'use client';

// [Translate] under someone else's message: one tap, one translation into the user's language.
// Never automatic (billed per character); the server caps characters per user per day.
import { useToast } from '@/components/ui';
import { languageName, useTranslation, useTranslationApi } from '@/lib/chat/translations';
import { recordTourFacts } from '@/lib/tour/store';

export function TranslateTap({ messageId, text }: { messageId: string | null | undefined; text: string }) {
  const api = useTranslationApi();
  const entry = useTranslation(messageId ?? undefined);
  const toast = useToast();
  if (!api || !messageId || !text.trim()) return null;

  if (entry?.state === 'done')
    return (
      <div className="mt-1 max-w-full rounded-2xl border border-glitch/30 bg-glitch/8 px-3 py-1.5 text-sm" data-testid="translation">
        <p className="mb-0.5 text-[0.7rem] font-semibold text-glitch">
          <span aria-hidden>文 </span>Translated to {languageName(api.language)}
        </p>
        <p className="break-words whitespace-pre-wrap" lang={api.language}>
          {entry.text}
        </p>
      </div>
    );

  const onTap = async () => {
    recordTourFacts('translate');
    const r = await api.translate(messageId, text);
    // Translation off on the Nexconn app (or down): the judge tour explains instead.
    if (r === 'failed') recordTourFacts('translate-off');
    if (r === 'cap') toast("You've used today's translations. They're back tomorrow!", 'info');
    else if (r === 'failed') toast("Couldn't translate that one. Try again in a bit?", 'danger');
  };
  return (
    <button
      type="button"
      onClick={() => void onTap()}
      disabled={entry?.state === 'pending'}
      className="-my-1 inline-flex min-h-8 items-center gap-1 px-1 text-[0.7rem] font-semibold text-glitch disabled:opacity-60"
      data-testid="translate-tap"
      data-tour="translate-tap"
    >
      <span aria-hidden>文</span>
      {entry?.state === 'pending' ? 'Translating…' : entry?.state === 'error' && entry.reason === 'cap' ? 'Daily limit reached' : 'Translate'}
    </button>
  );
}
