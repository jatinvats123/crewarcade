// Judge tour state in the browser. Progress lives in localStorage per user
// (`crewarcade:tour:<userId>`); `crewarcade:tour-user` says whose tour is on, so public pages
// (/impact, /safety, /arcade, game pages) can show it without asking the API. The signed-in app sets
// it only for judges (tourEnabledFor) and clears it for everyone else.
//
// recordTourFacts() is safe to call from anywhere: it does nothing unless a judge's tour is on.
import { useSyncExternalStore } from 'react';
import { parseTourState, tourReducer, type TourAction, type TourCtx, type TourState } from './steps';

const USER_KEY = 'crewarcade:tour-user';
const stateKey = (userId: string) => `crewarcade:tour:${userId}`;

export interface TourSnapshot {
  userId: string;
  state: TourState;
}

let loaded = false;
let snapshot: TourSnapshot | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private mode / storage blocked: the tour still works for this page view.
  }
}

function readSnapshot(): TourSnapshot | null {
  const userId = read(USER_KEY);
  return userId ? { userId, state: parseTourState(read(stateKey(userId))) } : null;
}

function load() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  snapshot = readSnapshot();
  // Another tab moved the tour on: follow it.
  window.addEventListener('storage', e => {
    if (e.key !== USER_KEY && !(snapshot && e.key === stateKey(snapshot.userId))) return;
    snapshot = readSnapshot();
    emit();
  });
}

function getSnapshot(): TourSnapshot | null {
  load();
  return snapshot;
}

/** Turns the tour on for this judge (or off, with null). Called by the session once it knows the user. */
export function setTourUser(userId: string | null) {
  load();
  if ((snapshot?.userId ?? null) === userId) return;
  write(USER_KEY, userId);
  snapshot = readSnapshot();
  emit();
}

export function dispatchTour(action: TourAction) {
  load();
  if (!snapshot) return;
  const next = tourReducer(snapshot.state, action);
  if (next === snapshot.state) return;
  snapshot = { ...snapshot, state: next };
  write(stateKey(snapshot.userId), JSON.stringify(next));
  emit();
}

export function recordTourFacts(...facts: string[]) {
  dispatchTour({ type: 'facts', facts });
}

export function setTourContext(ctx: TourCtx) {
  dispatchTour({ type: 'ctx', ctx });
}

/** True while a judge's tour is on in this browser (cheap; for gating extra work). */
export function tourActive(): boolean {
  return getSnapshot() !== null;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function useTour(): TourSnapshot | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

// ---- slots: where the card renders inside the app shell ----------------------------------------

export type TourSlotKind = 'phone' | 'desktop';
let slots: Partial<Record<TourSlotKind, HTMLElement>> = {};
const slotListeners = new Set<() => void>();

export function setTourSlot(kind: TourSlotKind, el: HTMLElement | null) {
  const next = { ...slots };
  if (el) next[kind] = el;
  else if (slots[kind]) delete next[kind];
  slots = next;
  slotListeners.forEach(l => l());
}

export function useTourSlots(): Partial<Record<TourSlotKind, HTMLElement>> {
  return useSyncExternalStore(
    fn => {
      slotListeners.add(fn);
      return () => void slotListeners.delete(fn);
    },
    () => slots,
    () => NO_SLOTS,
  );
}
const NO_SLOTS: Partial<Record<TourSlotKind, HTMLElement>> = {};

// ---- Show me: type text into the message box -------------------------------------------------

let pendingFill: { text: string; n: number } | null = null;
let fillCount = 0;
const fillListeners = new Set<() => void>();

/** The composer picks this up now, or as soon as it mounts (after Show me navigated). */
export function fillComposer(text: string) {
  pendingFill = { text, n: ++fillCount };
  fillListeners.forEach(l => l());
}

export function takeComposerFill(): string | null {
  const t = pendingFill?.text ?? null;
  pendingFill = null;
  return t;
}

export function subscribeComposerFill(fn: () => void): () => void {
  fillListeners.add(fn);
  return () => void fillListeners.delete(fn);
}
