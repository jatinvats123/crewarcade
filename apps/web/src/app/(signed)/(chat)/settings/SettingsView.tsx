'use client';

import type { AvatarColor } from '@crewarcade/shared';
import Link from 'next/link';
import { useState } from 'react';
import { ThemeToggle } from '@/components/brand/ThemeToggle';
import { ProfileForm, type ProfileValues } from '@/components/identity/ProfileForm';
import { Button, Sheet, useToast } from '@/components/ui';
import { api, ApiRequestError } from '@/lib/api';
import { useSession } from '@/lib/session';

export function SettingsView() {
  const { user, setUser, signOut } = useSession();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
            <p className="mt-3 text-xs break-all text-dim">
              Your user id: <code className="select-all">{user.id}</code>
            </p>
          </section>
          <section aria-labelledby="privacy-h" className="rounded-card border border-border bg-surface p-4">
            <h2 id="privacy-h" className="font-semibold">
              Privacy
            </h2>
            <p className="mb-3 text-sm text-dim">
              What we store and for how long is on the{' '}
              <Link href="/privacy" className="font-semibold text-brand underline">
                privacy page
              </Link>
              . Deleting your account removes your profile, scores and chat logs. Crews you own pass to another member.
            </p>
            <Button variant="danger" onClick={() => setDeleting(true)} data-testid="delete-account" data-tour="delete-account">
              Delete my account
            </Button>
          </section>
        </div>
      </div>
      <DeleteAccountSheet open={deleting} onClose={() => setDeleting(false)} />

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

/** Type DELETE to confirm; then the account is gone and the app reloads signed out. */
function DeleteAccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = typed.trim().toUpperCase() === 'DELETE';
  const go = async () => {
    setBusy(true);
    try {
      await api.deleteAccount();
      window.location.replace(window.location.origin);
    } catch (e) {
      toast(e instanceof ApiRequestError ? e.message : "Couldn't delete the account. Try again.", 'danger');
      setBusy(false);
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Delete your account?"
      footer={
        <>
          <Button variant="danger" block loading={busy} disabled={!ok} onClick={() => void go()} data-testid="delete-account-confirm">
            Delete for good
          </Button>
          <Button variant="secondary" block onClick={onClose}>
            Keep my account
          </Button>
        </>
      }
    >
      <p className="text-sm text-dim">
        This can&apos;t be undone. Your profile, scores and chat logs are deleted. Crews you own pass to another member; a crew with only you in it is deleted
        with its games. Games you helped make in other crews stay, credited to &ldquo;Deleted player&rdquo;.
      </p>
      <label htmlFor="delete-confirm" className="mt-4 block text-sm font-semibold">
        Type DELETE to confirm
      </label>
      <input
        id="delete-confirm"
        value={typed}
        onChange={e => setTyped(e.target.value)}
        autoComplete="off"
        className="mt-2 w-full rounded-2xl border border-border bg-surface-2 p-3 text-base outline-none focus:border-brand"
      />
    </Sheet>
  );
}
