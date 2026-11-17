'use client';

// Tap-to-translate (Phase 5). Never automatic: Nexconn translation is billed per character, so a
// tap first reserves characters of the user's daily cap on our server, then asks the SDK.
// Results arrive later on TranslateHandler.onTranslationCompleted; this store keeps them per message.
import { createContext, useContext, useSyncExternalStore } from 'react';

export type TranslationEntry = { state: 'pending' } | { state: 'done'; text: string; from: string | null } | { state: 'error'; reason: 'cap' | 'failed' };

export interface TranslationStore {
  get(messageId: string): TranslationEntry | undefined;
  set(messageId: string, entry: TranslationEntry): void;
  subscribe(fn: () => void): () => void;
}

export function createTranslationStore(): TranslationStore {
  const map = new Map<string, TranslationEntry>();
  const subs = new Set<() => void>();
  return {
    get: id => map.get(id),
    set(id, entry) {
      map.set(id, entry);
      subs.forEach(f => f());
    },
    subscribe(fn) {
      subs.add(fn);
      return () => void subs.delete(fn);
    },
  };
}

export type TranslateOutcome = 'ok' | 'cap' | 'failed';

export interface TranslationApi {
  store: TranslationStore;
  /** The user's language (target). */
  language: string;
  translate: (messageId: string, text: string) => Promise<TranslateOutcome>;
}

export const TranslationContext = createContext<TranslationApi | null>(null);

export function useTranslationApi(): TranslationApi | null {
  return useContext(TranslationContext);
}

export function useTranslation(messageId: string | undefined): TranslationEntry | undefined {
  const api = useContext(TranslationContext);
  return useSyncExternalStore(
    api?.store.subscribe ?? noopSubscribe,
    () => (api && messageId ? api.store.get(messageId) : undefined),
    () => undefined,
  );
}
const noopSubscribe = () => () => {};

const NAMES: Record<string, string> = {
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
/** "Hindi" for "hi" / "hi-IN"; the code itself when unknown. */
export const languageName = (code: string | null | undefined): string => (code ? (NAMES[code.slice(0, 2).toLowerCase()] ?? code) : 'another language');
