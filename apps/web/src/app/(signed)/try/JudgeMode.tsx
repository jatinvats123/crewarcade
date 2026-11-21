'use client';

// Judge mode (/try): tap once. Signed-out visitors get a judge account (marked, never counted as a
// real user); signed-in people keep theirs. Then a solo crew opens with three pitch ideas as chips
// above the message box (one in Hindi; nothing is typed for them), and judges get the guided tour:
// 23 steps with Show me, ticked by what actually happens in the app.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Logo } from '@/components/brand/Logo';
import { api } from '@/lib/api';
import { JUDGE_PITCHES } from '@/lib/tour/steps';
import { useSession } from '@/lib/session';

const STEPS = [
  {
    n: '1',
    title: 'Pitch a game',
    text: 'Tap a pitch chip in your crew chat (or write your own) and Send. Pixel replies with a plan card: controls, rules and the checks the game must pass.',
  },
  { n: '2', title: 'Tap Approve', text: 'A game room opens. Forge builds the game as one HTML file (about a minute) and streams its progress.' },
  {
    n: '3',
    title: 'Watch Glitch test it',
    text: 'Glitch plays it in a real headless browser, checks every item and posts PASS or FAIL with a GIF. A FAIL goes back to Forge.',
  },
  {
    n: '4',
    title: 'Play it, then Allow',
    text: 'Tap ▶ Play. Nothing is public until you tap Allow; then it is in the Arcade with a share link and a leaderboard.',
  },
];

const PILL = 'inline-flex min-h-12 items-center justify-center rounded-full px-6 text-sm font-bold tracking-[0.12em] whitespace-nowrap uppercase';

export function JudgeMode() {
  const { status, user, setUser } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      // Signed in already: the same account is switched to judge mode (the tour turns on); otherwise a
      // new judge account. Either way the server marks it as a judge.
      const me = user?.isJudge ? user : await api.signUpJudge({});
      if (me !== user) setUser(me);
      const crew = await api.createCrew({ name: `${me.displayName}'s crew`.slice(0, 40) });
      router.push(`/crews/${crew.id}`);
    } catch (e) {
      setError((e as Error).message || 'Something went wrong. Try again.');
      setBusy(false);
    }
  };

  return (
    <main className="min-h-dvh overflow-x-clip bg-bg pb-safe text-text">
      <header className="pt-safe mx-auto flex max-w-5xl items-center justify-between gap-3 px-safe py-4 md:px-8">
        <Link href="/" aria-label="CrewArcade home" className="min-h-11 content-center">
          <Logo className="text-xl" />
        </Link>
        <p className="text-xs text-faint sm:text-sm">No sign-up · free</p>
      </header>

      <div className="mx-auto flex max-w-5xl flex-col gap-10 px-safe pb-16 md:px-8">
        <section aria-labelledby="try-title" className="pt-4 md:pt-10">
          <p className="mb-3 text-xs font-semibold tracking-[0.2em] text-brand uppercase">Judge mode</p>
          <h1 id="try-title" className="font-poster text-[clamp(3rem,11vw,7.5rem)] leading-[0.95] uppercase">
            See it work
            <br />
            in 3 minutes
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-text/75">
            One tap and you are in a crew chat with Pixel, Forge and Glitch. A guided tour walks you through every feature, with Show me on each step. No name,
            no email, no password.
          </p>
        </section>

        <section aria-label="Start" className="flex flex-col gap-4 rounded-[22px] border border-border bg-surface p-5 md:p-6">
          <p className="text-xs font-bold tracking-[0.14em] text-dim uppercase">Pitch ideas waiting in your chat</p>
          <ul className="flex flex-wrap gap-2" aria-label="Pitch ideas">
            {JUDGE_PITCHES.map(p => (
              <li
                key={p.text}
                className="inline-flex min-h-11 max-w-full items-center gap-1 rounded-full border border-pixel/40 bg-pixel/10 px-4 text-sm font-semibold"
              >
                <span aria-hidden>💡</span>
                <span className="min-w-0 break-words">{p.label}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-dim">They are suggestions, not typed for you: tap one in the chat, or pitch your own idea.</p>
          <button
            type="button"
            onClick={() => void start()}
            disabled={busy || status === 'loading'}
            className={`${PILL} min-h-14 w-full bg-brand text-base text-brand-ink hover:brightness-110 disabled:opacity-60 sm:w-auto sm:self-start sm:px-10`}
            data-testid="judge-start"
          >
            {busy ? 'Opening your crew…' : user?.isJudge ? 'Open a new crew' : 'Start as a judge'}
          </button>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          {!user && (
            <p className="text-sm text-dim">
              Not a judge?{' '}
              <Link href="/start" className="font-semibold text-brand underline-offset-4 hover:underline">
                Sign up as a player
              </Link>{' '}
              (just a name, no tour).
            </p>
          )}
          <p className="text-xs text-dim">
            {user
              ? user.isJudge
                ? `You are signed in as ${user.displayName} (judge); this opens a new solo crew with the tour.`
                : `You are signed in as ${user.displayName}. This keeps your account, switches it to judge mode (guided tour on, left out of our live numbers) and opens a new solo crew.`
              : 'This makes a judge account on this browser only. Judge accounts are marked and never counted in our live numbers.'}
          </p>
        </section>

        <section aria-labelledby="steps-title" className="flex flex-col gap-4">
          <h2 id="steps-title" className="font-poster text-4xl leading-none uppercase md:text-5xl">
            What happens next
          </h2>
          <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {STEPS.map(s => (
              <li key={s.n} className="flex min-w-0 gap-4 rounded-[22px] border border-border bg-surface p-5">
                <span className="font-poster text-4xl leading-none text-brand" aria-hidden>
                  {s.n}
                </span>
                <span className="min-w-0">
                  <span className="block font-bold">{s.title}</span>
                  <span className="mt-1 block text-sm text-dim">{s.text}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="text-sm text-dim">
            Then the tour keeps going: bug reports and hotfixes, the Story with JSON export, remixes, the safety shield, a Hindi pitch, translation, invites,
            the Arcade, live numbers and settings. 23 steps, each with Show me, ticked as you do them.
          </p>
        </section>

        <section aria-label="More" className="flex flex-wrap gap-3">
          <Link href="/arcade" className={`${PILL} border border-text/25 hover:border-brand hover:text-brand`}>
            Play games crews made
          </Link>
          <Link href="/impact" className={`${PILL} border border-text/25 hover:border-brand hover:text-brand`}>
            Live numbers
          </Link>
          <Link href="/safety" className={`${PILL} border border-text/25 hover:border-brand hover:text-brand`}>
            Safety rules
          </Link>
        </section>
      </div>
    </main>
  );
}
