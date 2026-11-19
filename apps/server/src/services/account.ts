// "Delete my account" (DELETE /api/me). What happens, in one transaction:
//   - crews the user owns pass to the next approver (else the longest-standing member); a crew with
//     no other human is deleted with its games, rooms and history;
//   - games, bug reports and ledger rows they made in surviving crews are credited to one shared
//     "Deleted player" row (so other people's games keep working);
//   - their profile, memberships, scores, usage, message log, moderation and connection rows go;
//   - their bug screenshots are removed from storage.
// Then, best effort: Nexconn removes them from every group and dismisses deleted crews' channels.
import { nexconnUserId } from '@crewarcade/shared';
import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { Ctx } from '../context';
import { bugs, connections, crewMembers, crews, games, ledger, messagesLog, moderationLog, users } from '../db/schema';
import { dismissGroup, kickOutOfAllGroups } from '../nexconn';
import type { UserRow } from '../repo/users';

/** The one row that deleted users' games, bug reports and ledger entries point to. Never signs in. */
export const DELETED_USER_ID = 'udeleteduser';

export interface DeleteAccountResult {
  crewsTransferred: number;
  crewsDeleted: number;
}

export async function deleteAccount(ctx: Ctx, user: UserRow): Promise<DeleteAccountResult> {
  const nxId = nexconnUserId(user.id);
  const dismiss: string[] = [];
  const screenshots: string[] = [];
  let crewsTransferred = 0;
  let crewsDeleted = 0;

  await ctx.db.transaction(async tx => {
    await tx
      .insert(users)
      .values({ id: DELETED_USER_ID, displayName: 'Deleted player', avatarEmoji: '👻', avatarColor: 'violet', language: 'en' })
      .onConflictDoNothing();

    const owned = await tx.select().from(crews).where(eq(crews.ownerId, user.id));
    for (const crew of owned) {
      const [next] = await tx
        .select({ userId: crewMembers.userId })
        .from(crewMembers)
        .innerJoin(users, eq(users.id, crewMembers.userId))
        .where(and(eq(crewMembers.crewId, crew.id), ne(crewMembers.userId, user.id), eq(users.isAgent, false)))
        .orderBy(sql`case when ${crewMembers.role} = 'approver' then 0 else 1 end`, asc(crewMembers.joinedAt))
        .limit(1);
      if (next) {
        await tx.update(crews).set({ ownerId: next.userId }).where(eq(crews.id, crew.id));
        await tx
          .update(crewMembers)
          .set({ role: 'owner' })
          .where(and(eq(crewMembers.crewId, crew.id), eq(crewMembers.userId, next.userId)));
        crewsTransferred++;
      } else {
        const rooms = await tx.select({ room: games.roomChannelId }).from(games).where(eq(games.crewId, crew.id));
        dismiss.push(crew.groupChannelId, ...rooms.map(r => r.room).filter((r): r is string => !!r));
        const shots = await tx.select({ path: bugs.screenshotPath }).from(bugs).innerJoin(games, eq(games.id, bugs.gameId)).where(eq(games.crewId, crew.id));
        screenshots.push(...shots.map(s => s.path).filter((p): p is string => !!p));
        await tx.delete(crews).where(eq(crews.id, crew.id)); // cascades games, versions, bugs, cards, ledger, members
        crewsDeleted++;
      }
    }

    const mine = await tx.select({ id: bugs.id, path: bugs.screenshotPath }).from(bugs).where(eq(bugs.reporterId, user.id));
    screenshots.push(...mine.map(b => b.path).filter((p): p is string => !!p));
    if (mine.length)
      await tx
        .update(bugs)
        .set({ reporterId: DELETED_USER_ID, screenshotPath: null })
        .where(
          inArray(
            bugs.id,
            mine.map(b => b.id),
          ),
        );
    await tx.update(games).set({ createdBy: DELETED_USER_ID }).where(eq(games.createdBy, user.id));
    await tx.update(ledger).set({ actorId: DELETED_USER_ID }).where(eq(ledger.actorId, user.id));
    await tx.delete(messagesLog).where(eq(messagesLog.fromUserId, nxId));
    await tx.delete(moderationLog).where(or(eq(moderationLog.userId, user.id), eq(moderationLog.userId, nxId)));
    await tx.delete(connections).where(or(eq(connections.userId, user.id), eq(connections.userId, nxId)));
    await tx.delete(users).where(eq(users.id, user.id)); // cascades memberships, scores, usage, challenge throttles
  });

  for (const key of screenshots) await ctx.uploads.remove(key).catch(err => ctx.log.warn({ err, key }, 'account delete: screenshot not removed'));
  if (ctx.nexconn) {
    const nexconn = ctx.nexconn;
    await kickOutOfAllGroups(nexconn, { userId: nxId }).catch(err => ctx.log.warn({ err, userId: user.id }, 'account delete: Nexconn kickout failed'));
    for (const channelId of dismiss)
      await dismissGroup(nexconn, { channelId }).catch(err => ctx.log.warn({ err, channelId }, 'account delete: dismiss failed'));
  }
  ctx.log.info({ userId: user.id, crewsTransferred, crewsDeleted }, 'account deleted');
  return { crewsTransferred, crewsDeleted };
}
