'use client';

import type { CrewMember } from '@crewarcade/shared';
import { useEffect, useState } from 'react';
import { MemberAvatar } from '@/components/identity/MemberAvatar';
import { Sheet, Skeleton } from '@/components/ui';
import { clockTime } from '@/lib/chat/grouping';
import type { SeenByUser } from '@/lib/nexconn/NexconnProvider';

/** "Seen by" for a group message (BaseChannel.createMessagesReadReceiptUsersQuery, RESPONDED). */
export function SeenBySheet({
  messageId,
  onClose,
  load,
  members,
}: {
  messageId: string | null;
  onClose: () => void;
  load: (id: string) => Promise<SeenByUser[]>;
  members: Map<string, CrewMember>;
}) {
  const [users, setUsers] = useState<SeenByUser[] | null>(null);
  useEffect(() => {
    if (!messageId) return;
    setUsers(null);
    let live = true;
    void load(messageId).then(u => live && setUsers(u));
    return () => {
      live = false;
    };
  }, [messageId, load]);
  return (
    <Sheet open={!!messageId} onClose={onClose} title="Seen by">
      {!users ? (
        <Skeleton className="h-12 w-full" />
      ) : users.length === 0 ? (
        <p className="text-sm text-dim">Nobody has opened it yet.</p>
      ) : (
        <ul className="flex flex-col gap-1 pb-2">
          {users.map(u => {
            const m = members.get(u.userId);
            return (
              <li key={u.userId} className="flex min-h-12 items-center gap-3">
                <MemberAvatar person={m ?? { id: u.userId, displayName: 'Someone', avatarEmoji: '🙂', avatarColor: 'violet' }} size="sm" />
                <span className="flex-1 font-semibold">{m?.displayName ?? 'Someone'}</span>
                {u.timestamp > 0 && <span className="text-xs text-faint">{clockTime(u.timestamp)}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
