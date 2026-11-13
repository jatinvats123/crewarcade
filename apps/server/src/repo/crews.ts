// Crew and membership rows. Every permission check reads crew_members (docs/SPEC.md §8).
import { AGENT_ID_LIST, nexconnUserId, type AgentId, type CrewDetail, type CrewMember, type CrewRole, type CrewSummary } from '@crewarcade/shared';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/types';
import { crewMembers, crews, users } from '../db/schema';

export type CrewRow = typeof crews.$inferSelect;

export async function insertCrewWithMembers(
  db: Db,
  crew: Pick<CrewRow, 'id' | 'groupChannelId' | 'name' | 'ownerId' | 'inviteCode' | 'kind'>,
  members: Array<{ userId: string; role: CrewRole }>,
): Promise<void> {
  await db.transaction(async tx => {
    await tx.insert(crews).values(crew);
    await tx.insert(crewMembers).values(members.map(m => ({ crewId: crew.id, ...m })));
  });
}

export async function isInviteCodeTaken(db: Db, code: string): Promise<boolean> {
  const [row] = await db.select({ id: crews.id }).from(crews).where(eq(crews.inviteCode, code)).limit(1);
  return !!row;
}

export async function getCrew(db: Db, id: string): Promise<CrewRow | null> {
  const [row] = await db.select().from(crews).where(eq(crews.id, id)).limit(1);
  return row ?? null;
}

export async function getCrewByInvite(db: Db, code: string): Promise<CrewRow | null> {
  const [row] = await db.select().from(crews).where(eq(crews.inviteCode, code)).limit(1);
  return row ?? null;
}

export async function getRole(db: Db, crewId: string, userId: string): Promise<CrewRole | null> {
  const [row] = await db
    .select({ role: crewMembers.role })
    .from(crewMembers)
    .where(and(eq(crewMembers.crewId, crewId), eq(crewMembers.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}

/** Inserts the membership; false when the user was already a member. */
export async function addMember(db: Db, crewId: string, userId: string, role: CrewRole = 'member'): Promise<boolean> {
  const rows = await db.insert(crewMembers).values({ crewId, userId, role }).onConflictDoNothing().returning({ userId: crewMembers.userId });
  return rows.length === 1;
}

export async function setRole(db: Db, crewId: string, userId: string, role: CrewRole): Promise<void> {
  await db
    .update(crewMembers)
    .set({ role })
    .where(and(eq(crewMembers.crewId, crewId), eq(crewMembers.userId, userId)));
}

export async function countMembers(db: Db, crewId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(crewMembers).where(eq(crewMembers.crewId, crewId));
  return row?.n ?? 0;
}

export async function countOwnedCrews(db: Db, userId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(crews).where(eq(crews.ownerId, userId));
  return row?.n ?? 0;
}

function summary(c: CrewRow, role: CrewRole, memberCount: number): CrewSummary {
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    groupChannelId: c.groupChannelId,
    inviteCode: c.inviteCode,
    role,
    memberCount,
    createdAt: c.createdAt.toISOString(),
  };
}

export async function listCrewsForUser(db: Db, userId: string): Promise<CrewSummary[]> {
  const mine = await db
    .select({ crew: crews, role: crewMembers.role })
    .from(crewMembers)
    .innerJoin(crews, eq(crews.id, crewMembers.crewId))
    .where(eq(crewMembers.userId, userId))
    .orderBy(asc(crews.createdAt));
  if (mine.length === 0) return [];
  const counts = await db
    .select({ crewId: crewMembers.crewId, n: count() })
    .from(crewMembers)
    .where(
      inArray(
        crewMembers.crewId,
        mine.map(m => m.crew.id),
      ),
    )
    .groupBy(crewMembers.crewId);
  const byId = new Map(counts.map(c => [c.crewId, c.n]));
  return mine.map(m => summary(m.crew, m.role, byId.get(m.crew.id) ?? 0));
}

export async function listMembers(db: Db, crewId: string): Promise<CrewMember[]> {
  const rows = await db
    .select({ user: users, role: crewMembers.role, joinedAt: crewMembers.joinedAt })
    .from(crewMembers)
    .innerJoin(users, eq(users.id, crewMembers.userId))
    .where(eq(crewMembers.crewId, crewId))
    // Owner first, then approvers, then members; agents after humans; then by join time.
    .orderBy(sql`case ${crewMembers.role} when 'owner' then 0 when 'approver' then 1 else 2 end`, asc(users.isAgent), asc(crewMembers.joinedAt));
  // Agents always in their canonical order (Pixel, Forge, Glitch); Array.sort is stable.
  rows.sort((a, b) => (a.user.isAgent && b.user.isAgent ? AGENT_ID_LIST.indexOf(a.user.id as AgentId) - AGENT_ID_LIST.indexOf(b.user.id as AgentId) : 0));
  return rows.map(r => ({
    id: r.user.id,
    nexconnId: nexconnUserId(r.user.id),
    displayName: r.user.displayName,
    avatarEmoji: r.user.avatarEmoji,
    avatarColor: r.user.avatarColor,
    avatarUrl: r.user.avatarUrl,
    isAgent: r.user.isAgent,
    role: r.role,
    joinedAt: r.joinedAt.toISOString(),
  }));
}

export async function getCrewDetail(db: Db, crew: CrewRow, viewerRole: CrewRole): Promise<CrewDetail> {
  const members = await listMembers(db, crew.id);
  return { ...summary(crew, viewerRole, members.length), ownerId: crew.ownerId, members };
}
