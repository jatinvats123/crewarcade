'use client';

// /i/<code>: one calm screen. The crew's name is the headline, its members sit under it, and a
// visitor without an account picks a name and joins in one tap (QuickProfileForm); the server adds
// them to the Nexconn group, then we open the chat.
import { AGENTS, type InvitePreview } from '@crewarcade/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Logo } from '@/components/brand/Logo';
import { MemberAvatar } from '@/components/identity/MemberAvatar';
import { QuickProfileForm } from '@/components/identity/QuickProfileForm';
import { Skeleton } from '@/components/ui';
import { api, ApiRequestError } from '@/lib/api';
import { signupRef } from '@/lib/ref';
import { useSession } from '@/lib/session';

const FACES = 6;

export function JoinView({ code }: { code: string }) {
  const { status, user, setUser } = useSession();
  const router = useRouter();
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

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
    <main className="flex min-h-dvh w-full flex-col bg-bg px-safe pt-safe pb-safe text-text">
      <header className="flex items-center justify-between gap-4 px-2 py-4 sm:px-8 sm:py-6">
        <Link href="/" aria-label="CrewArcade home">
          <Logo className="text-lg" />
        </Link>
        <p className="text-xs text-faint sm:text-sm">Free · no password · no email</p>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center px-2 py-4 text-center">
        {error ? (
          <Notice title="Can't open this invite" action={<CalmButton onClick={() => void load()}>Try again</CalmButton>}>
            {error}
          </Notice>
        ) : !invite ? (
          <div className="flex w-full max-w-md flex-col items-center gap-5" aria-busy aria-label="Loading invite">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-14 w-64" />
          </div>
        ) : (
          <>
            <section aria-labelledby="join-title" className="flex flex-col items-center">
              <p className="text-sm text-dim">You're invited to</p>
              <h1 id="join-title" className="mt-3 max-w-4xl font-poster text-6xl leading-[0.95] tracking-wide break-words uppercase sm:text-8xl">
                {invite.name}
              </h1>
              <ul className="mt-6 flex items-center" aria-label="Members">
                {invite.members.slice(0, FACES).map((m, i) => (
                  <li key={i} title={m.displayName} className="-ml-3 rounded-full ring-4 ring-bg first:ml-0">
                    <MemberAvatar
                      size="lg"
                      person={{
                        id: m.agent ? AGENTS[m.agent].id : `h${i}`,
                        displayName: m.displayName,
                        avatarEmoji: m.avatarEmoji,
                        avatarColor: m.avatarColor,
                      }}
                    />
                    <span className="sr-only">{m.displayName}</span>
                  </li>
                ))}
                {invite.memberCount > Math.min(FACES, invite.members.length) && (
                  <li className="-ml-3 flex size-14 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold text-dim ring-4 ring-bg">
                    +{invite.memberCount - Math.min(FACES, invite.members.length)}
                  </li>
                )}
              </ul>
              <p className="mt-4 max-w-md text-base text-dim">
                {invite.memberCount} members, including Pixel, Forge and Glitch: the AI agents who design, build and playtest your games.
              </p>
            </section>

            <div className="mt-10 flex w-full flex-col items-center sm:mt-11">
              {invite.full && !invite.alreadyMember ? (
                <Notice title="This crew is full">Crews have room for 30 members. Ask the owner to make a new crew.</Notice>
              ) : invite.alreadyMember ? (
                <CalmButton onClick={() => router.push(`/crews/${invite.crewId}`)}>
                  Open the chat <span aria-hidden>→</span>
                </CalmButton>
              ) : status === 'ready' && user ? (
                <>
                  <CalmButton busy={joining} onClick={() => void join()}>
                    Join crew as {user.avatarEmoji} {user.displayName} <span aria-hidden>→</span>
                  </CalmButton>
                  <p className="mt-4 text-sm text-faint">You'll land straight in the crew chat.</p>
                </>
              ) : (
                <section aria-labelledby="who-title" className="flex w-full flex-col items-center">
                  <h2 id="who-title" className="mb-3 text-xl font-semibold tracking-tight sm:text-2xl">
                    What should your crew call you?
                  </h2>
                  <QuickProfileForm
                    nameSize="md"
                    submitLabel="Join crew"
                    hint="Press Enter to join. Change anything later in Settings."
                    onSubmit={async v => {
                      setUser(await api.signUp({ ...v, referrer: signupRef(true) }));
                      await join();
                    }}
                  />
                </section>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function CalmButton({ onClick, busy, children }: { onClick: () => void; busy?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-busy={busy || undefined}
      className="inline-flex min-h-14 w-full max-w-[380px] items-center justify-center gap-2.5 rounded-2xl bg-brand px-6 text-base font-semibold text-brand-ink transition-[filter,transform] hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
    >
      {busy && <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

function Notice({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div role="alert" className="flex max-w-md flex-col items-center">
      <h1 className="font-poster text-4xl tracking-wide uppercase sm:text-5xl">{title}</h1>
      <p className="mt-3 text-base text-dim">{children}</p>
      {action && <div className="mt-8 flex w-full justify-center">{action}</div>}
    </div>
  );
}
