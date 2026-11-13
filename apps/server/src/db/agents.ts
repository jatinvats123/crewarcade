// The three agent users, as rows for the users table. Pure: the seed script and tests share it.
import { AGENTS } from '@crewarcade/shared';
import type { users } from './schema';

export function agentUserRows(webOrigin: string): Array<typeof users.$inferInsert> {
  const origin = webOrigin.replace(/\/+$/, '');
  return Object.values(AGENTS).map(a => ({
    id: a.id,
    displayName: a.displayName,
    avatarEmoji: a.key === 'pixel' ? '🎨' : a.key === 'forge' ? '🔨' : '🧪',
    avatarColor: a.accent,
    avatarUrl: `${origin}${a.avatarPath}`,
    language: 'en',
    isAgent: true,
  }));
}
