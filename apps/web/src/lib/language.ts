// Sign-up picks the chat language from the browser so most people never have to touch it.
import { LANGUAGE_CODES, type LanguageCode } from '@crewarcade/shared';

/** English names, shown next to each language's own script ("हिन्दी · Hindi"). */
export const LANGUAGE_ENGLISH: Record<LanguageCode, string> = {
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

const SUPPORTED = new Set<string>(LANGUAGE_CODES);

/** First supported language in the browser's preference list (`hi-IN` → `hi`), else English. */
export function detectLanguage(preferred: readonly string[] | undefined): LanguageCode {
  for (const tag of preferred ?? []) {
    const base = tag.trim().toLowerCase().split(/[-_]/)[0] ?? '';
    if (SUPPORTED.has(base)) return base as LanguageCode;
  }
  return 'en';
}
