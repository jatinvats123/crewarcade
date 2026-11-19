'use client';

// Signed-in shell. Phones: one screen at a time (crew list, or a chat, or settings). Tablet: crew
// list | main. Desktop (>= 1024 px): crew list (280) | chat (fluid) | context panel (360).
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { CrewList } from '@/components/crews/CrewList';
import { PlayerProvider } from '@/components/player/PlayerProvider';
import { MessageSkeleton } from '@/components/ui';
import { cn } from '@/lib/cn';
import { CrewsProvider } from '@/lib/crews';
import { NexconnProvider } from '@/lib/nexconn/NexconnProvider';
import { useSession } from '@/lib/session';
import { ConnectionBanner } from './ConnectionBanner';
import { ContextPanel } from './ContextPanel';

export function AppShell({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'anonymous') router.replace(`/start?next=${encodeURIComponent(pathname)}`);
  }, [status, pathname, router]);

  if (status !== 'ready')
    return (
      <div className="mx-auto max-w-md space-y-4 p-6" aria-busy>
        <MessageSkeleton />
        <MessageSkeleton />
      </div>
    );

  const inCrewIndex = pathname === '/crews';
  return (
    <CrewsProvider>
      <NexconnProvider>
        <PlayerProvider reportBugs>
          <div className="flex h-dvh flex-col overflow-hidden pt-[env(safe-area-inset-top)]">
            <ConnectionBanner />
            <div className="flex min-h-0 flex-1">
              <aside
                aria-label="Your crews"
                className={cn('min-h-0 w-full flex-col border-border md:flex md:w-[280px] md:shrink-0 md:border-r', inCrewIndex ? 'flex' : 'hidden')}
              >
                <CrewList />
              </aside>
              <main className={cn('min-w-0 flex-1 flex-col', inCrewIndex ? 'hidden md:flex' : 'flex')}>{children}</main>
              <aside aria-label="Crew HQ" className="hidden w-[360px] shrink-0 flex-col border-l border-border lg:flex">
                <ContextPanel />
              </aside>
            </div>
          </div>
        </PlayerProvider>
      </NexconnProvider>
    </CrewsProvider>
  );
}
