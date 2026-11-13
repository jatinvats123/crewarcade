'use client';

import type { AvatarColor } from '@crewarcade/shared';
import Link from 'next/link';
import { useState } from 'react';
import { ThemeToggle } from '@/components/brand/ThemeToggle';
import { ProfileForm, type ProfileValues } from '@/components/identity/ProfileForm';
import { Button, Sheet, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

export function SettingsView() {
  const { user, setUser, signOut } = useSession();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  if (!user) return null;
  const initial: ProfileValues = {
    displayName: user.displayName,
    avatarEmoji: user.avatarEmoji as ProfileValues['avatarEmoji'],
    avatarColor: user.avatarColor as AvatarColor,
    language: user.language as ProfileValues['language'],
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-1 border-b border-border px-1 py-1.5">
        <Link
          href="/crews"
          aria-label="Back to crews"
          className="inline-flex size-11 items-center justify-center rounded-full text-dim hover:bg-surface-2 md:hidden"
        >
          <span aria-hidden>←</span>
        </Link>
        <h1 className="px-2 font-display text-lg font-bold">Settings</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-lg flex-col gap-8 px-safe py-6 pb-safe">
          <section aria-labelledby="profile-h">
            <h2 id="profile-h" className="mb-3 font-display text-xl font-bold">
              Profile
            </h2>
            <ProfileForm
              initial={initial}
              submitLabel="Save"
              onSubmit={async v => {
                setUser(await api.updateMe(v));
                toast('Saved', 'success');
              }}
            />
          </section>
          <section aria-labelledby="look-h" className="flex items-center justify-between rounded-card border border-border bg-surface p-4">
            <div>
              <h2 id="look-h" className="font-semibold">
                Theme
              </h2>
              <p className="text-sm text-dim">Dark or light. Follows your phone until you pick.</p>
            </div>
            <ThemeToggle />
          </section>
          <section aria-labelledby="account-h" className="rounded-card border border-border bg-surface p-4">
            <h2 id="account-h" className="font-semibold">
              Guest account
            </h2>
            <p className="mb-3 text-sm text-dim">
              You're signed in on this browser only. Signing out can't be undone: this guest account and its crews won't be reachable again.
            </p>
            <Button variant="danger" onClick={() => setConfirm(true)}>
              Sign out
            </Button>
          </section>
        </div>
      </div>
      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Sign out for good?"
        footer={
          <>
            <Button
              variant="danger"
              block
              onClick={() =>
                void signOut().then(() => {
                  // A full reload drops the Nexconn connection and every in-memory message.
                  window.location.replace(window.location.origin);
                })
              }
            >
              Sign out
            </Button>
            <Button variant="secondary" block onClick={() => setConfirm(false)}>
              Stay signed in
            </Button>
          </>
        }
      >
        <p className="text-sm text-dim">Guest accounts have no password, so you won't be able to sign back in as {user.displayName}.</p>
      </Sheet>
    </div>
  );
}
