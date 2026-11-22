'use client';

// The judge tour (judges only; docs/STATUS.md "Judge tour"). One persistent card that updates in
// place: on phones and tablets a bottom bar ("Next step · 3 of 23" + Show me) that opens the full
// checklist; on desktop the checklist with a progress bar in the right panel (floating on pages
// without one). Show me puts a pulsing ring on the exact button with a small hint, typing a test
// message first where the step needs one, and goes to the right page first. Ticks come from real
// app events (lib/tour/steps.ts); progress lives in localStorage per user (lib/tour/store.ts).
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sheet } from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  doneSteps,
  factsForPath,
  samePath,
  STEPS,
  stepById,
  tourHiddenOn,
  tourReducer,
  tourView,
  stepLabel,
  type StepId,
  type TourState,
  type TourStep,
  type TourTarget,
  type TourView,
} from '@/lib/tour/steps';
import { dispatchTour, fillComposer, recordTourFacts, useTour, useTourSlots } from '@/lib/tour/store';

const TRANSLATE_OFF =
  'Translation is switched off on our Nexconn plan right now, so the tap can’t finish. When it’s on, the translation appears right under the message.';

type Ring = { el: Element; hint: string };

const HIDE_KEY = 'crewarcade:tour-hidden';

/**
 * The visible element for the first target that has one. In the chat timeline that's the newest
 * (a revised plan's Approve, the latest test card); elsewhere the first on the page (the header's
 * Invite friends before Crew HQ's Invite).
 */
function findTarget(targets: readonly TourTarget[]): Ring | null {
  for (const t of targets) {
    const visible = [...document.querySelectorAll(`[data-tour="${t.id}"]`)].filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (typeof (el as HTMLElement).checkVisibility !== 'function' || (el as HTMLElement).checkVisibility());
    });
    const inTimeline = visible.filter(el => el.closest('[role="log"]'));
    const el = inTimeline[inTimeline.length - 1] ?? visible[0];
    if (el) return { el, hint: t.hint };
  }
  return null;
}

export function JudgeTour() {
  const tour = useTour();
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const slots = useTourSlots();
  const [ring, setRing] = useState<Ring | null>(null);
  const [miss, setMiss] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Hide: a per-viewer convenience, remembered in this browser.
  const [hidden, setHiddenState] = useState(false);
  useEffect(() => {
    try {
      setHiddenState(localStorage.getItem(HIDE_KEY) === '1');
    } catch {
      // storage blocked: the tour just starts shown
    }
  }, []);
  const setHidden = useCallback((h: boolean) => {
    setHiddenState(h);
    try {
      if (h) localStorage.setItem(HIDE_KEY, '1');
      else localStorage.removeItem(HIDE_KEY);
    } catch {
      // storage blocked: hidden for this page view only
    }
  }, []);
  const search = useRef(0);

  // Pages opened count as ticks (/impact, /safety, /settings, game pages).
  useEffect(() => {
    if (tour) {
      const f = factsForPath(pathname);
      if (f.length) recordTourFacts(...f);
    }
  }, [pathname, tour]);

  // A new step on the card clears an old "not on screen" note.
  const focus = tour?.state.focus ?? null;
  useEffect(() => setMiss(null), [focus]);

  // Navigating away drops the ring.
  useEffect(() => {
    setRing(null);
  }, [pathname]);

  const go = useCallback(
    (step: TourStep, state: TourState) => {
      const dest = step.where(state.ctx, new Set(state.facts));
      if (dest && !samePath(pathname, dest)) router.push(dest);
    },
    [pathname, router],
  );

  const showMe = useCallback(
    (step: TourStep, state: TourState) => {
      setSheetOpen(false);
      setMiss(null);
      setRing(null);
      const here = step.stayIfTarget && step.targets[0] ? findTarget([step.targets[0]]) : null;
      if (!here) go(step, state);
      if (step.fill) fillComposer(step.fill);
      if (step.targets.length === 0) return;
      const id = ++search.current;
      const started = Date.now();
      const look = () => {
        if (id !== search.current) return;
        const found = findTarget(step.targets);
        if (found) {
          // 'nearest': scroll only the element's own scroller; 'center' would also shift the fixed-height app shell.
          found.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          setRing(found);
        } else if (Date.now() - started < 7000) setTimeout(look, 200);
        else setMiss(`Not on screen yet. ${step.press}`);
      };
      setTimeout(look, 120);
    },
    [go],
  );

  const clearRing = useCallback(() => setRing(null), []);

  if (!tour || tourHiddenOn(pathname)) return null;
  const state = tour.state;
  const view = tourView(state);

  const actions: CardActions = {
    showMe: step => showMe(step, state),
    skip: id => dispatchTour({ type: 'skip', id }),
    ack: id => dispatchTour({ type: 'ack', id }),
    next: () => {
      const after = tourReducer(state, { type: 'next' });
      dispatchTour({ type: 'next' });
      if (after.focus) go(stepById(after.focus), after);
    },
    focus: (id, navigate) => {
      dispatchTour({ type: 'focus', id });
      // Tapped low in a long checklist: bring the step's card (above the list) back into view.
      requestAnimationFrame(() => {
        const cards = '[data-testid="tour-step"], [data-testid="tour-done"], [data-testid="tour-complete"]';
        for (const el of document.querySelectorAll(cards))
          if ((el as HTMLElement).offsetParent !== null) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
      if (navigate) {
        setSheetOpen(false);
        go(stepById(id), state);
      }
    },
  };

  const desktop = <TourPanel state={state} view={view} miss={miss} actions={actions} onHide={() => setHidden(true)} />;
  const phoneBar = <PhoneBar view={view} actions={actions} onOpen={() => setSheetOpen(true)} onHide={() => setHidden(true)} />;

  return (
    <>
      {hidden ? (
        // Hidden: one small pill brings it back (above the composer on phones).
        <div className="fixed right-3 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-40 lg:right-4 lg:bottom-4">
          <button
            type="button"
            onClick={() => setHidden(false)}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-brand/50 bg-surface px-4 text-sm font-semibold shadow-card"
            data-testid="tour-pill"
          >
            <span aria-hidden className="text-brand">
              ★
            </span>
            {view.core.done < view.core.total ? `Judge tour · Core ${view.core.done}/${view.core.total}` : `Judge tour · ${view.doneCount}/${view.total}`}
          </button>
        </div>
      ) : (
        <>
          {slots.phone ? (
            createPortal(phoneBar, slots.phone)
          ) : (
            <>
              {/* Page spacer so the fixed bar never hides the end of the page. */}
              <div aria-hidden className="h-20 lg:hidden" />
              <div className="fixed inset-x-0 bottom-0 z-40 lg:hidden">{phoneBar}</div>
            </>
          )}
          {slots.desktop ? (
            createPortal(desktop, slots.desktop)
          ) : (
            <div className="fixed right-4 bottom-4 z-40 hidden max-h-[calc(100dvh-2rem)] w-[360px] overflow-y-auto rounded-[24px] border border-border bg-surface shadow-card lg:block">
              {desktop}
            </div>
          )}
        </>
      )}
      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={`Judge tour · Core ${view.core.done} of ${view.core.total}`}>
        <div className="flex flex-col gap-4 pb-2" data-testid="tour-sheet">
          <TourProgress view={view} />
          {view.kind === 'step' ? <StepBody view={view} state={state} miss={miss} actions={actions} /> : <Complete view={view} actions={actions} />}
          <Checklist state={state} view={view} actions={actions} />
          <button
            type="button"
            onClick={() => {
              setSheetOpen(false);
              setHidden(true);
            }}
            className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-dim hover:text-text"
          >
            Hide the tour
          </button>
        </div>
      </Sheet>
      {ring && <ShowMeRing ring={ring} onDone={clearRing} />}
    </>
  );
}

interface CardActions {
  showMe: (step: TourStep) => void;
  skip: (id: StepId) => void;
  ack: (id: StepId) => void;
  next: () => void;
  focus: (id: StepId, navigate?: boolean) => void;
}

/** The core loop's bar (every judge's goal), then the four Explore themes with their own counts. */
function TourProgress({ view }: { view: TourView }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <div className="flex items-baseline justify-between gap-2 text-xs">
          <span className="font-semibold">Core loop</span>
          <span className="text-dim">
            {view.core.done} of {view.core.total}
          </span>
        </div>
        <div
          className="mt-1 h-2 overflow-hidden rounded-full bg-text/10"
          role="progressbar"
          aria-label="Core loop progress"
          aria-valuemin={0}
          aria-valuemax={view.core.total}
          aria-valuenow={view.core.done}
        >
          <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${(view.core.done / view.core.total) * 100}%` }} />
        </div>
      </div>
      <ul className="grid grid-cols-2 gap-1.5" aria-label="Explore">
        {view.groups.slice(1).map(g => (
          <li
            key={g.id}
            className={cn('min-w-0 rounded-xl border px-2.5 py-1.5 text-xs', g.done === g.total ? 'border-success/50 bg-success/10' : 'border-text/15')}
          >
            <span className="block truncate font-semibold">{g.title}</span>
            <span className="text-dim">
              {g.done}/{g.total}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const PILL = 'inline-flex min-h-11 items-center justify-center rounded-full px-4 text-sm font-bold whitespace-nowrap';

function StepBody({ view, state, miss, actions }: { view: Extract<TourView, { kind: 'step' }>; state: TourState; miss: string | null; actions: CardActions }) {
  const { step, done } = view;
  const facts = new Set(state.facts);
  const canShow = step.targets.length > 0 || !!step.where(state.ctx, facts) || !!step.fill;
  const explore = view.total - view.core.total;
  if (done)
    return (
      <div className="flex flex-col gap-3 rounded-[18px] border border-success/40 bg-success/10 p-4" data-testid="tour-done" aria-live="polite">
        <p className="flex items-start gap-2 font-semibold">
          <span aria-hidden className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-success text-sm text-[#06261a]">
            ✓
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-semibold tracking-[0.14em] text-success uppercase">
              {stepLabel(view)} · {step.title}
            </span>
            {step.done}
          </span>
        </p>
        {view.coreJustDone && (
          <p className="text-sm" data-testid="tour-core-done">
            <strong>Core loop done!</strong> {explore} more to explore: fixes and hotfixes, safety, languages and the Arcade. Next → keeps going.
          </p>
        )}
        <button type="button" onClick={actions.next} className={`${PILL} self-start bg-brand text-brand-ink hover:brightness-110`} data-testid="tour-next">
          Next →
        </button>
      </div>
    );
  return (
    <div className="flex flex-col gap-3" data-testid="tour-step">
      <div>
        <p className="text-xs font-semibold tracking-[0.14em] text-brand uppercase">
          {stepLabel(view)}
          {step.info ? ' · Info' : ''}
        </p>
        <h3 className="mt-1 font-poster text-2xl leading-tight tracking-wide uppercase">{step.title}</h3>
      </div>
      <dl className={cn('flex flex-col gap-2 text-sm', step.info && 'rounded-[18px] border border-glitch/30 bg-glitch/8 p-3')}>
        <div>
          <dt className="text-[11px] font-semibold tracking-[0.14em] text-faint uppercase">Press</dt>
          <dd className="break-words">{step.press}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold tracking-[0.14em] text-faint uppercase">What happens</dt>
          <dd className="break-words">{step.next}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold tracking-[0.14em] text-faint uppercase">Why it matters</dt>
          <dd className="break-words text-dim">{step.why}</dd>
        </div>
      </dl>
      {step.id === 'translate' && facts.has('translate-off') && (
        <p className="rounded-[18px] border border-gold/40 bg-gold/10 p-3 text-sm" data-testid="tour-translate-off">
          {TRANSLATE_OFF}
        </p>
      )}
      {miss && (
        <p role="status" className="text-sm text-gold">
          {miss}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {step.info && (
          <button type="button" onClick={() => actions.ack(step.id)} className={`${PILL} bg-brand text-brand-ink hover:brightness-110`} data-testid="tour-ack">
            Got it
          </button>
        )}
        {canShow && (
          <button
            type="button"
            onClick={() => actions.showMe(step)}
            className={cn(PILL, step.info ? 'border border-text/25 hover:border-brand hover:text-brand' : 'bg-brand text-brand-ink hover:brightness-110')}
            data-testid="tour-show-me"
          >
            Show me
          </button>
        )}
        <button type="button" onClick={() => actions.skip(step.id)} className={`${PILL} text-dim hover:text-text`} data-testid="tour-skip">
          Skip
        </button>
      </div>
    </div>
  );
}

function Complete({ view, actions }: { view: Extract<TourView, { kind: 'complete' }>; actions: CardActions }) {
  return (
    <div className="flex flex-col gap-3 rounded-[18px] border border-brand/40 bg-brand/10 p-4" data-testid="tour-complete">
      <h3 className="font-poster text-2xl tracking-wide uppercase">Tour complete</h3>
      <p className="text-sm">
        {view.doneCount} of {view.total} done. Thanks for judging CrewArcade!
      </p>
      {view.skipped.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold tracking-[0.14em] text-dim uppercase">You skipped</p>
          <ul className="flex flex-col">
            {view.skipped.map(s => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => actions.focus(s.id, true)}
                  className="inline-flex min-h-11 items-center gap-2 text-left text-sm font-semibold text-brand underline-offset-4 hover:underline"
                >
                  {STEPS.indexOf(s) + 1}. {s.title} →
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Every step, under its group (Core loop first, then the four Explore themes), each with its tick. */
function Checklist({ state, view, actions }: { state: TourState; view: TourView; actions: CardActions }) {
  const done = doneSteps(new Set(state.facts));
  const current = view.kind === 'step' ? view.step.id : null;
  return (
    <div className="flex flex-col gap-3" data-testid="tour-checklist">
      {view.groups.map(g => (
        <section key={g.id} aria-label={`${g.title}, ${g.done} of ${g.total} done`}>
          <h4 className="flex items-baseline justify-between gap-2 px-2 text-[11px] font-semibold tracking-[0.14em] text-faint uppercase">
            <span>{g.id === 'core' ? 'Core loop' : `Explore · ${g.title}`}</span>
            <span>
              {g.done}/{g.total}
            </span>
          </h4>
          <ol className="flex flex-col">
            {g.steps.map(s => {
              const isDone = done.has(s.id);
              const skipped = !isDone && state.skipped.includes(s.id);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => actions.focus(s.id)}
                    aria-current={s.id === current ? 'step' : undefined}
                    className={cn(
                      'flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-xl px-2 text-left text-sm hover:bg-text/5',
                      s.id === current && 'bg-brand/10 font-semibold',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px]',
                        isDone ? 'border-success bg-success text-[#06261a]' : skipped ? 'border-faint text-faint' : 'border-text/30',
                      )}
                    >
                      {isDone ? '✓' : skipped ? '–' : ''}
                    </span>
                    <span className={cn('min-w-0 flex-1 truncate', skipped && 'text-faint line-through')}>
                      {STEPS.indexOf(s) + 1}. {s.title}
                    </span>
                    <span className="sr-only">{isDone ? 'done' : skipped ? 'skipped' : 'to do'}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

/** Desktop: progress, the step card and the grouped checklist (right panel, or floating). */
function TourPanel({
  state,
  view,
  miss,
  actions,
  onHide,
}: {
  state: TourState;
  view: TourView;
  miss: string | null;
  actions: CardActions;
  onHide: () => void;
}) {
  return (
    <section aria-label="Judge tour" className="flex flex-col gap-4 p-5" data-testid="tour-panel">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.2em] text-brand uppercase">Judges only</p>
          <h2 className="font-poster text-3xl tracking-wide uppercase">Judge tour</h2>
        </div>
        <button
          type="button"
          onClick={onHide}
          className="inline-flex min-h-11 items-center rounded-full px-3 text-xs font-semibold text-dim hover:text-text"
          data-testid="tour-hide"
        >
          Hide
        </button>
      </div>
      <TourProgress view={view} />
      {view.kind === 'step' ? <StepBody view={view} state={state} miss={miss} actions={actions} /> : <Complete view={view} actions={actions} />}
      <details className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm font-semibold text-dim hover:text-text">
          All 23 steps{' '}
          <span aria-hidden className="transition-transform group-open:rotate-180">
            ⌄
          </span>
        </summary>
        <div className="max-h-80 overflow-y-auto">
          <Checklist state={state} view={view} actions={actions} />
        </div>
      </details>
    </section>
  );
}

/** Phones and tablets: one bar; tap it for the full checklist; ✕ hides it. */
function PhoneBar({ view, actions, onOpen, onHide }: { view: TourView; actions: CardActions; onOpen: () => void; onHide: () => void }) {
  const label = view.kind === 'complete' ? `Tour complete · ${view.doneCount} of ${view.total}` : view.done ? `✓ Done · ${stepLabel(view)}` : stepLabel(view);
  const title =
    view.kind === 'complete'
      ? view.skipped.length
        ? `${view.skipped.length} skipped: tap to go back`
        : 'Every step done'
      : view.done
        ? view.step.done
        : view.step.title;
  // The thin line: the core loop until it's done, then everything.
  const coreOpen = view.core.done < view.core.total;
  const progress = coreOpen ? view.core.done / view.core.total : view.doneCount / view.total;
  return (
    <div className="pb-safe relative border-t border-border bg-surface pt-2 pr-1 pl-3" data-testid="tour-bar">
      <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-text/10">
        <span className="block h-full bg-brand transition-[width] duration-500" style={{ width: `${progress * 100}%` }} />
      </span>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={onOpen} className="min-h-11 min-w-0 flex-1 text-left" aria-label={`${label}: ${title}. Open the judge tour checklist`}>
          <span
            className={cn(
              'block truncate text-[11px] font-semibold tracking-[0.14em] uppercase',
              view.kind === 'step' && view.done ? 'text-success' : 'text-brand',
            )}
          >
            {label}
          </span>
          <span className="block truncate text-sm font-semibold">{title}</span>
        </button>
        {view.kind === 'step' &&
          (view.done ? (
            <button type="button" onClick={actions.next} className={`${PILL} shrink-0 bg-brand text-brand-ink`} data-testid="tour-bar-next">
              Next →
            </button>
          ) : view.step.info ? (
            <button type="button" onClick={() => actions.ack(view.step.id)} className={`${PILL} shrink-0 bg-brand text-brand-ink`} data-testid="tour-bar-ack">
              Got it
            </button>
          ) : (
            <button
              type="button"
              onClick={() => actions.showMe(view.step)}
              className={`${PILL} shrink-0 bg-brand text-brand-ink`}
              data-testid="tour-bar-show-me"
            >
              Show me
            </button>
          ))}
        <button
          type="button"
          onClick={onHide}
          aria-label="Hide the judge tour"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-dim hover:bg-surface-2 hover:text-text"
          data-testid="tour-bar-hide"
        >
          <span aria-hidden>✕</span>
        </button>
      </div>
    </div>
  );
}

/** The pulsing ring around the exact button, with a small hint. Ends on any tap, Escape or after 12 s. */
function ShowMeRing({ ring, onDone }: { ring: Ring; onDone: () => void }) {
  const [rect, setRect] = useState(() => ring.el.getBoundingClientRect());
  const [vw, setVw] = useState(() => window.innerWidth);
  const [vh, setVh] = useState(() => window.innerHeight);
  useEffect(() => {
    let raf = 0;
    let last = '';
    const tick = () => {
      if (!ring.el.isConnected) return onDone();
      const r = ring.el.getBoundingClientRect();
      const key = `${r.x},${r.y},${r.width},${r.height},${window.innerWidth},${window.innerHeight}`;
      if (key !== last) {
        last = key;
        setRect(r);
        setVw(window.innerWidth);
        setVh(window.innerHeight);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const end = () => onDone();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onDone();
    const timer = setTimeout(end, 12_000);
    // Capture, without preventing: the tap still reaches the button.
    window.addEventListener('pointerdown', end, true);
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      window.removeEventListener('pointerdown', end, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [ring, onDone]);

  const pad = 6;
  const width = Math.min(260, vw - 32);
  const left = Math.max(16, Math.min(rect.left + rect.width / 2 - width / 2, vw - 16 - width));
  // Above targets in the lower half (the composer, the tour bar), below the rest; never off screen.
  const below = (rect.top + rect.bottom) / 2 < vh / 2 ? rect.bottom + 72 < vh : rect.top - 72 < 0;
  return createPortal(
    <div aria-live="polite" className="pointer-events-none fixed inset-0 z-[80]" data-testid="tour-ring">
      <span
        className="animate-tour-pulse absolute rounded-2xl border-[3px] border-brand"
        style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
      />
      <p
        className="absolute rounded-2xl bg-brand px-3 py-2 text-sm font-bold text-brand-ink shadow-card"
        style={{ left, width, ...(below ? { top: rect.bottom + pad + 10 } : { top: rect.top - pad - 10, transform: 'translateY(-100%)' }) }}
        data-testid="tour-hint"
      >
        {ring.hint}
      </p>
    </div>,
    document.body,
  );
}
