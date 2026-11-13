// Nexconn identities for our users (humans and agents). A user must hold a token before they can be
// added to a group or send through the server API ("400: user ID does not exist"), so every flow
// that touches Nexconn calls ensureNexconnToken first. Tokens are cached AES-256-GCM-encrypted in
// users.nexconn_token_encrypted and never logged.
import { nexconnUserId } from '@crewarcade/shared';
import type { Ctx } from '../context';
import { decryptSecret, encryptSecret } from '../crypto';
import { issueToken } from '../nexconn/api';
import type { NexconnClient } from '../nexconn/client';
import { NexconnNotConfiguredError } from '../nexconn/errors';
import { getUser, updateUser, type UserRow } from '../repo/users';

export function requireNexconn(ctx: Pick<Ctx, 'nexconn'>): NexconnClient {
  if (!ctx.nexconn) throw new NexconnNotConfiguredError();
  return ctx.nexconn;
}

/** Push-notification name: Nexconn allows <= 64 chars; agents use their display name. */
const pushName = (u: UserRow) => u.displayName.slice(0, 64);
const pushAvatar = (u: UserRow) => (u.avatarUrl && /^https?:\/\//.test(u.avatarUrl) && u.avatarUrl.length <= 1024 ? u.avatarUrl : undefined);

export async function ensureNexconnToken(
  ctx: Pick<Ctx, 'nexconn' | 'db' | 'config' | 'log'>,
  user: UserRow,
  opts: { refresh?: boolean } = {},
): Promise<string> {
  const key = ctx.config.TOKEN_ENCRYPTION_KEY;
  if (!opts.refresh && key && user.nexconnTokenEncrypted) {
    try {
      return decryptSecret(user.nexconnTokenEncrypted, key);
    } catch {
      ctx.log.warn({ userId: user.id }, 'stored Nexconn token could not be decrypted; issuing a new one');
    }
  }
  const avatarUrl = pushAvatar(user);
  const { accessToken } = await issueToken(requireNexconn(ctx), { userId: nexconnUserId(user.id), name: pushName(user), ...(avatarUrl && { avatarUrl }) });
  // Without TOKEN_ENCRYPTION_KEY (dev only) tokens are simply not cached.
  if (key) await updateUser(ctx.db, user.id, { nexconnTokenEncrypted: encryptSecret(accessToken, key) });
  return accessToken;
}

/** Makes sure each user id is registered with Nexconn (issues a token if none is cached). */
export async function ensureRegistered(ctx: Pick<Ctx, 'nexconn' | 'db' | 'config' | 'log'>, userIds: string[]): Promise<void> {
  for (const id of userIds) {
    const user = await getUser(ctx.db, id);
    if (!user) throw new Error(`unknown user ${id}`);
    // Without a key there is no cache, so re-issuing is the only way to be sure.
    if (!user.nexconnTokenEncrypted || !ctx.config.TOKEN_ENCRYPTION_KEY) await ensureNexconnToken(ctx, user);
  }
}
