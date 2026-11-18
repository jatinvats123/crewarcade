// User rows. Pure data access: no Nexconn, no HTTP.
import { newId, nexconnUserId, type Profile } from '@crewarcade/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/types';
import { users } from '../db/schema';

export type UserRow = typeof users.$inferSelect;

export async function createGuestUser(db: Db, input: { displayName: string; avatarEmoji: string; avatarColor: string; language: string; referrer?: string | null }): Promise<UserRow> {
  const [row] = await db
    .insert(users)
    .values({ id: newId('user'), ...input, lastSeenAt: new Date() })
    .returning();
  if (!row) throw new Error('user insert returned nothing');
  return row;
}

export async function getUser(db: Db, id: string): Promise<UserRow | null> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

export async function updateUser(
  db: Db,
  id: string,
  patch: Partial<Pick<UserRow, 'displayName' | 'avatarEmoji' | 'avatarColor' | 'language' | 'nexconnTokenEncrypted' | 'lastSeenAt'>>,
): Promise<UserRow | null> {
  if (Object.keys(patch).length === 0) return getUser(db, id);
  const [row] = await db.update(users).set(patch).where(eq(users.id, id)).returning();
  return row ?? null;
}

export function toProfile(u: UserRow): Profile {
  return {
    id: u.id,
    nexconnId: nexconnUserId(u.id),
    displayName: u.displayName,
    avatarEmoji: u.avatarEmoji,
    avatarColor: u.avatarColor,
    avatarUrl: u.avatarUrl,
    language: u.language,
    isAgent: u.isAgent,
    isJudge: u.isJudge,
  };
}
