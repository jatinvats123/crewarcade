'use client';

// Guest sign-in: pick a name (+ emoji, ring colour, optional language) and go. No passwords.
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/brand/Logo';
import { ProfileForm, randomProfile } from '@/components/identity/ProfileForm';
import { Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { safeNext } from '@/lib/nav';
import { useSession } from '@/lib/session';

export function Onboarding() {
  const { status, setUser } = useSession();
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const [initial] = useState(() => ({ displayName: '', ...randomProfile() }));

  useEffect(() => {
    if (status === 'ready') router.replace(next);
  }, [status, next, router]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-safe pt-safe pb-safe">
      <header className="py-3">
        <Logo className="text-xl" />
      </header>
      <section aria-labelledby="start-title" className="flex flex-1 flex-col justify-center gap-6 py-6">
        <div>
          <h1 id="start-title" className="font-display text-3xl font-bold tracking-tight">
            Who's playing?
          </h1>
          <p className="mt-1 text-dim">Pick a name and an avatar. No password, no email.</p>
        </div>
        {status === 'loading' || status === 'ready' ? (
          <div className="space-y-3" aria-busy>
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <ProfileForm
            compact
            initial={initial}
            submitLabel="Let's go"
            onSubmit={async v => {
              const user = await api.signUp(v);
              setUser(user);
              router.replace(next);
            }}
            footer={<p className="text-center text-xs text-faint">Your guest account lives in this browser. You can rename yourself any time.</p>}
          />
        )}
      </section>
    </main>
  );
}
