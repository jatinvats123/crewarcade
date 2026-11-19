'use client';
/* eslint-disable @next/next/no-img-element -- agent portraits are small static SVGs */

// The crews index (middle column, tablet and up): a launch pad instead of "Pick a crew". The three
// agents wait, a giant call to action, and one-tap pitch ideas: a tap makes a solo crew and opens it
// with the pitch typed in the composer (the user still taps Send). First visit opens "How it works".
import { AGENTS, type AgentKey } from '@crewarcade/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useCrews } from '@/lib/crews';
import { useSession } from '@/lib/session';
import { HowItWorks, howToPending } from './HowItWorks';
import { NewCrewSheet } from './NewCrewSheet';

const IDEAS = ['a mango dodging crows on a rooftop', 'a chai cup racing a scooter', 'a kite avoiding birds', 'a penguin delivering pizza'];
const ORBS: Array<{ k: AgentKey; size: string; delay: string }> = [
  { k: 'pixel', size: 'size-24', delay: '0s' },
  { k: 'forge', size: 'size-28 mb-5', delay: '0.3s' },
  { k: 'glitch', size: 'size-24', delay: '0.6s' },
];
const PILL = 'inline-flex min-h-13 items-center justify-center rounded-full px-8 text-xs font-bold tracking-[0.18em] uppercase';

export function LaunchPad() {
  const { user } = useSession();
  const { crews, upsert } = useCrews();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState(false);
  const [howto, setHowto] = useState(false);
  const first = crews !== null && crews.length === 0;

  useEffect(() => setHowto(howToPending()), []);

  const start = async (pitch?: string) => {
    setBusy(pitch ?? 'solo');
    setError(null);
    try {
      const crew = await api.createCrew({ name: `${user?.displayName ?? 'My'}'s crew`.slice(0, 40) });
      upsert(crew);
      router.push(pitch ? `/crews/${crew.id}?pitch=${encodeURIComponent(pitch)}` : `/crews/${crew.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-7 overflow-y-auto px-8 py-12 text-center">
      <div className="flex items-end gap-6" aria-hidden>
        {ORBS.map(o => (
          <img
            key={o.k}
            src={AGENTS[o.k].avatarPath}
            alt=""
            width={112}
            height={112}
            className={cn(o.size, 'animate-[scene-hop_1.8s_ease-in-out_infinite_alternate] drop-shadow-[0_18px_30px_rgba(0,0,0,0.6)]')}
            style={{ animationDelay: o.delay }}
          />
        ))}
      </div>
      <p className="text-xs font-semibold tracking-[0.25em] text-brand uppercase">Pixel · Forge · Glitch are ready</p>
      <h1 className="font-poster text-[clamp(3.5rem,6.5vw,7rem)] leading-[0.9] uppercase">
        {first ? 'Start your' : 'Pitch your'}
        <br />
        {first ? 'first crew' : 'next game'}
      </h1>
      <p className="max-w-lg text-lg text-text/80">
        Tap an idea or type your own. Pixel plans it, Forge builds it, Glitch playtests it, and you play it in minutes.
      </p>

      <ul className="flex max-w-2xl flex-wrap justify-center gap-2.5" aria-label="Pitch ideas">
        {IDEAS.map(idea => (
          <li key={idea}>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void start(idea)}
              className="inline-flex min-h-11 items-center rounded-full border border-text/20 bg-text/5 px-5 text-sm transition-colors hover:border-brand hover:text-brand disabled:opacity-60"
            >
              {busy === idea ? 'Starting…' : idea}
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap justify-center gap-3">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void start()}
          className={cn(PILL, 'bg-brand text-brand-ink hover:brightness-110 disabled:opacity-60')}
        >
          {busy === 'solo' ? 'Starting…' : 'Start a solo crew'}
        </button>
        <button type="button" onClick={() => setInvite(true)} className={cn(PILL, 'border border-text/30 hover:border-text')}>
          Invite friends
        </button>
      </div>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <p className="text-sm text-dim">
        New here?{' '}
        <button type="button" onClick={() => setHowto(true)} className="min-h-11 font-semibold text-brand underline-offset-4 hover:underline">
          See how it works in 3 steps
        </button>
      </p>

      <NewCrewSheet open={invite} onClose={() => setInvite(false)} />
      <HowItWorks open={howto} onClose={() => setHowto(false)} />
    </div>
  );
}
