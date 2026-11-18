// The free Render server sleeps after 15 idle minutes and takes up to a minute to wake. Vercel's
// /api proxy gives up sooner and answers 502/503/504. Instead of failing, the API client waits for
// the server (pinging a cheap route), shows "Waking up the server…", then retries the request once.
// All requests share one wait, so a page with several calls pings only once.

/** Proxy answers that mean "the server isn't up (yet)". */
export const isWakeStatus = (status: number): boolean => status === 502 || status === 503 || status === 504;

type Listener = (waking: boolean) => void;
const listeners = new Set<Listener>();
let current: Promise<boolean> | null = null;

/** Subscribe to the waking state (for the banner). Returns an unsubscribe function. */
export function onWaking(fn: Listener): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
const emit = (waking: boolean) => listeners.forEach(fn => fn(waking));

export interface WaitOptions {
  /** Resolves with the status of a cheap request (0 for a network error). */
  ping: () => Promise<number>;
  timeoutMs?: number;
  intervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Pings until the server answers with anything but a wake status, or the time runs out (pure; tested). */
export async function pollUntilAwake(o: WaitOptions): Promise<boolean> {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)));
  const deadline = now() + (o.timeoutMs ?? 120_000);
  while (now() < deadline) {
    const status = await o.ping();
    if (status !== 0 && !isWakeStatus(status)) return true;
    await sleep(o.intervalMs ?? 3_000);
  }
  return false;
}

/** One shared wait for every caller; the banner shows while it runs. */
export function waitForServer(o: WaitOptions): Promise<boolean> {
  if (!current) {
    emit(true);
    current = pollUntilAwake(o).finally(() => {
      current = null;
      emit(false);
    });
  }
  return current;
}

/** The browser's ping: GET /api/me answers 401 (or 200) as soon as the server is up. */
export const pingServer = (): Promise<number> =>
  fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' }).then(
    r => r.status,
    () => 0,
  );
