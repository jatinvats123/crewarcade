'use client';

// Crew info: invite link + share, members with presence and roles; the owner promotes/demotes approvers.
import type { CrewDetail, CrewMember } from '@crewarcade/shared';
import { useState } from 'react';
import { agentKeyOf, MemberAvatar } from '@/components/identity/MemberAvatar';
import { AiBadge, Button, RoleBadge, Sheet, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { useCrews } from '@/lib/crews';
import { inviteUrl, shareInvite } from '@/lib/share';

export function CrewInfoSheet({
  open,
  onClose,
  crew,
  myDbId,
  presence,
}: {
  open: boolean;
  onClose: () => void;
  crew: CrewDetail;
  myDbId: string;
  presence: Record<string, boolean>;
}) {
  const { upsert } = useCrews();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const link = typeof window === 'undefined' ? '' : inviteUrl(window.location.origin, crew.inviteCode);
  const isOwner = crew.role === 'owner';

  const share = async () => {
    const r = await shareInvite(crew.name, link);
    if (r === 'copied') toast('Invite link copied', 'success');
    if (r === 'failed') toast("Couldn't share. Copy the link instead.", 'danger');
  };

  const setRole = async (m: CrewMember, role: 'approver' | 'member') => {
    setBusy(m.id);
    try {
      const updated = await api.setRole(crew.id, m.id, role);
      upsert({ ...crew, members: crew.members.map(x => (x.id === m.id ? updated : x)) });
      toast(role === 'approver' ? `${m.displayName} can now approve` : `${m.displayName} is a member again`, 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={crew.name}>
      <section aria-labelledby="invite-h" className="mb-5">
        <h3 id="invite-h" className="mb-2 text-sm font-semibold">
          Invite friends
        </h3>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={link}
            aria-label="Invite link"
            onFocus={e => e.currentTarget.select()}
            className="min-h-11 min-w-0 flex-1 rounded-2xl border border-border bg-surface-2 px-3 text-sm text-dim"
          />
          <Button onClick={() => void share()} icon={<span aria-hidden>📤</span>}>
            Share
          </Button>
        </div>
      </section>
      <section aria-labelledby="members-h">
        <h3 id="members-h" className="mb-2 text-sm font-semibold">
          {crew.members.length} members
        </h3>
        <ul className="flex flex-col gap-1">
          {crew.members.map(m => {
            const agent = agentKeyOf(m.id);
            const online = agent ? true : m.id === myDbId ? true : presence[m.nexconnId];
            return (
              <li key={m.id} className="flex min-h-14 items-center gap-3 rounded-2xl px-1">
                <MemberAvatar person={m} presence={online === undefined ? undefined : online ? 'online' : 'offline'} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 font-semibold">
                    <span className="truncate">{m.displayName}</span>
                    {m.id === myDbId && <span className="text-xs font-normal text-faint">(you)</span>}
                    <RoleBadge role={m.role} />
                    {m.isAgent && <AiBadge />}
                  </p>
                  <p className="text-xs text-faint">{agent ? 'Always here' : online ? 'Online' : 'Offline'}</p>
                </div>
                {isOwner && !m.isAgent && m.role !== 'owner' && (
                  <Button size="sm" variant="secondary" loading={busy === m.id} onClick={() => void setRole(m, m.role === 'approver' ? 'member' : 'approver')}>
                    {m.role === 'approver' ? 'Remove approver' : 'Make approver'}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-faint">The owner and approvers approve plans and decide what gets published. Agents can never approve.</p>
      </section>
    </Sheet>
  );
}
