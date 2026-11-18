'use client';

// /i/<code>: crew preview + "Join crew". A visitor without an account signs up inline and joins in
// one tap; the server adds them to the Nexconn group, then we open the chat.
import { AGENTS, type InvitePreview } from '@crewarcade/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Logo } from '@/components/brand/Logo';
import { MemberAvatar } from '@/components/identity/MemberAvatar';
import { ProfileForm, randomProfile } from '@/components/identity/ProfileForm';
import { Button, ErrorState, Skeleton } from '@/components/ui';
import { api, ApiRequestError } from '@/lib/api';
import { signupRef } from '@/lib/ref';
import { useSession } from '@/lib/session';

export function JoinView({ code }: { code: string }) {
  const { status, user, setUser } = useSession();
  const router = useRouter();
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [initial] = useState(() => ({ displayName: '', ...randomProfile() }));

  const load = useCallback(async () => {
    setError(null);
    try {
      setInvite(await api.invite(code));
    } catch (e) {
      setError(
        e instanceof ApiRequestError && (e.status === 404 || e.status === 400)
          ? 'This invite link is not valid any more. Ask your friend for a new one.'
          : (e as Error).message,
      );
    }
  }, [code]);

  useEffect(() => {
    if (status !== 'loading') void load();
  }, [status, load]);

  const join = async () => {
    setJoining(true);
    try {
      const { crewId } = await api.join(code);
      router.push(`/crews/${crewId}`);
    } catch (e) {
      setError((e as Error).message);
      setJoining(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-safe pt-safe pb-safe">
      <header className="py-3">
        <Link href="/" aria-label="CrewArcade home">
          <Logo className="text-xl" />
        </Link>
      </header>
      <div className="flex flex-1 flex-col justify-center gap-6 py-6">
        {error ? (
          <ErrorState title="Can't open this invite" onRetry={() => void load()}>
            {error}
          </ErrorState>
        ) : !invite ? (
          <div className="space-y-3" aria-busy aria-label="Loading invite">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <>
            <section aria-labelledby="join-title" className="rounded-card border border-border bg-surface p-5 shadow-card">
              <p className="text-sm font-semibold text-brand">You're invited</p>
              <h1 id="join-title" className="mt-1 font-display text-3xl font-bold tracking-tight break-words">
                {invite.name}
              </h1>
              <p className="mt-1 text-sm text-dim">
                {invite.memberCount} members, including Pixel, Forge and Glitch: the AI agents who design, build and playtest your games.
              </p>
              <ul className="mt-4 flex flex-wrap gap-2" aria-label="Members">
                {invite.members.map((m, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-full bg-surface-2 py-1 pr-3 pl-1 text-sm">
                    <MemberAvatar
                      size="sm"
                      person={{
                        id: m.agent ? AGENTS[m.agent].id : `h${i}`,
                        displayName: m.displayName,
                        avatarEmoji: m.avatarEmoji,
                        avatarColor: m.avatarColor,
                      }}
                    />
                    <span className="max-w-32 truncate">{m.displayName}</span>
                  </li>
                ))}
              </ul>
            </section>

            {invite.full && !invite.alreadyMember ? (
              <ErrorState title="This crew is full">Crews have room for 30 members. Ask the owner to make a new crew.</ErrorState>
            ) : invite.alreadyMember ? (
              <Button size="lg" block onClick={() => router.push(`/crews/${invite.crewId}`)}>
                Open the chat
              </Button>
            ) : status === 'ready' && user ? (
              <Button size="lg" block loading={joining} onClick={() => void join()}>
                Join crew as {user.avatarEmoji} {user.displayName}
              </Button>
            ) : (
              <section aria-labelledby="who-title" className="flex flex-col gap-3">
                <h2 id="who-title" className="font-display text-xl font-bold">
                  Who's joining?
                </h2>
                <ProfileForm
                  compact
                  initial={initial}
                  submitLabel="Join crew"
                  onSubmit={async v => {
                    setUser(await api.signUp({ ...v, referrer: signupRef(true) }));
                    await join();
                  }}
                />
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
