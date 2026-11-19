'use client';

// /start: sign-up is one calm screen (QuickProfileForm). Invite links sign up on /i/<code> instead.
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
