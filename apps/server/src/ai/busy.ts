// "The model is busy" notices. AI clients retry busy answers (free tiers see them at peaks) and fall
// back to another model; instead of going silent meanwhile, they report each retry to whoever runs
// the current job (an AsyncLocalStorage scope set by the agent worker), which shows it as the agent's
// live state: "model busy, retrying (2/3)…". Pure helpers here; tested.
import { AsyncLocalStorage } from 'node:async_hooks';

export interface AiBusy {
  /** 1-based retry about to happen (after a backoff). */
  retry: number;
  /** Retries allowed on this model. */
  of: number;
  model: string;
  /** Set when this model stayed busy and the client switches to another one. */
  next?: string;
}

export type BusyNotify = (purpose: string, b: AiBusy) => void;

const scope = new AsyncLocalStorage<BusyNotify>();

/** Runs `fn` so AI calls inside it report busy retries to `notify`. */
export function withBusyNotify<T>(notify: BusyNotify, fn: () => Promise<T>): Promise<T> {
  return scope.run(notify, fn);
}

/** Called by AI clients before each busy retry or model switch. Never throws. */
export function reportBusy(purpose: string, b: AiBusy): void {
  try {
    scope.getStore()?.(purpose, b);
  } catch {
    /* a notice must never break the call */
  }
}

/** Short state detail for a busy retry (the agent state detail is max 120 chars). */
export function busyDetail(b: AiBusy): string {
  return (b.next ? `AI model busy, switching to ${b.next}…` : `AI model busy, retrying (${b.retry}/${b.of})…`).slice(0, 120);
}

/** The agent behind an AI purpose ("forge.build" → forge). */
export function agentOfPurpose(purpose: string): 'pixel' | 'forge' | 'glitch' | null {
  const a = purpose.split('.')[0];
  return a === 'pixel' || a === 'forge' || a === 'glitch' ? a : null;
}
