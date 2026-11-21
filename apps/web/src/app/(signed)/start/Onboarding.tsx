'use client';

// /start: sign-up is one calm screen (QuickProfileForm). Invite links sign up on /i/<code> instead.
// Judges see the choice first: one tap into judge mode (/try, guided tour), or the normal sign-up.
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { Logo } from '@/components/brand/Logo';
import { QuickProfileForm } from '@/components/identity/QuickProfileForm';
import { Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { safeNext } from '@/lib/nav';
import { signupRef } from '@/lib/ref';
import { useSession } from '@/lib/session';

export function Onboarding() {
  const { status, setUser } = useSession();
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const fromInvite = next.startsWith('/i/');

  useEffect(() => {
    if (status === 'ready') router.replace(next);
  }, [status, next, router]);

  return (
    <main className="flex min-h-dvh w-full flex-col bg-bg px-safe pt-safe pb-safe text-text">
      <header className="flex items-center justify-between gap-4 px-2 py-4 sm:px-8 sm:py-6">
        <Logo className="text-lg" />
        <p className="text-xs text-faint sm:text-sm">Free · no password · no email</p>
      </header>

      <section aria-labelledby="start-title" className="flex flex-1 flex-col items-center justify-center px-2 py-8 text-center">
        {!fromInvite && (
          <div
            className="mb-10 flex w-full max-w-md flex-col items-center gap-3 rounded-[22px] border border-gold/50 bg-gold/10 p-5 sm:flex-row sm:text-left"
            data-testid="judge-choice"
          >
            <p className="min-w-0 flex-1 text-sm">
              <span className="block font-semibold text-gold">Judging the Nexconn Build Challenge?</span>
              <span className="text-dim">One tap, no name needed, and a guided tour of every feature.</span>
            </p>
            <Link
              href="/try"
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-gold px-5 text-sm font-bold whitespace-nowrap text-bg hover:brightness-110"
            >
              ★ I&apos;m a judge
            </Link>
          </div>
        )}
        {!fromInvite && <p className="mb-4 text-xs font-semibold tracking-[0.2em] text-faint uppercase">Or sign up as a player</p>}
        <h1 id="start-title" className="text-3xl font-semibold tracking-tight text-balance sm:text-[44px] sm:leading-[1.1]">
          What should your crew call you?
        </h1>
        <p className="mt-3 text-base text-dim sm:text-lg">Pixel, Forge and Glitch will use it too.</p>

        {status === 'loading' || status === 'ready' ? (
          <div className="mt-12 flex w-full max-w-md flex-col items-center gap-6" aria-busy>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-14 w-80" />
          </div>
        ) : (
          <div className="mt-10 w-full sm:mt-12">
            <QuickProfileForm
              submitLabel="Start playing"
              onSubmit={async v => {
                const user = await api.signUp({ ...v, referrer: signupRef(fromInvite) });
                setUser(user);
                router.replace(next);
              }}
            />
          </div>
        )}
      </section>

      <footer className="px-2 pb-6 text-center text-sm text-faint sm:pb-8">
        {fromInvite ? 'Next stop: your crew.' : 'Got an invite link? Just open it, your crew is waiting.'}
      </footer>
    </main>
  );
}
