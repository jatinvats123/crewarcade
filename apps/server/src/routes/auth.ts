// Guest identity (no passwords): POST /api/auth/guest, GET/PATCH /api/me, POST /api/auth/logout,
// POST /api/nexconn/token (the browser's own Nexconn access token) and DELETE /api/me (delete my account).
import { GuestSignupBody, nexconnUserId, ProfilePatch } from '@crewarcade/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { clearSession, setSession } from '../auth/session';
import type { Ctx } from '../context';
import { createGuestUser, toProfile, updateUser } from '../repo/users';
import { deleteAccount } from '../services/account';
import { ensureNexconnToken, requireNexconn } from '../services/chat-users';
import { fixedWindowLimiter, rateLimit, requireUser } from './http';

const DeleteAccountBody = z.object({ confirm: z.literal('delete my account') });
const TokenBody = z.object({ refresh: z.boolean().default(false) }).default({ refresh: false });

export function registerAuthRoutes(app: FastifyInstance, ctx: Ctx): void {
  const signupLimit = fixedWindowLimiter({ limit: 10, windowMs: 60_000, now: ctx.now });
  const tokenLimit = fixedWindowLimiter({ limit: 30, windowMs: 60_000, now: ctx.now });
  const deleteLimit = fixedWindowLimiter({ limit: 3, windowMs: 60_000, now: ctx.now });

  app.post('/api/auth/guest', async (req, reply) => {
    rateLimit(signupLimit, `ip:${req.ip}`);
    const body = GuestSignupBody.parse(req.body);
    const user = await createGuestUser(ctx.db, {
      displayName: body.displayName,
      avatarEmoji: body.avatarEmoji,
      avatarColor: body.avatarColor,
      language: body.language ?? 'en',
      referrer: body.referrer ?? null,
    });
    setSession(reply, user.id, ctx.session);
    ctx.log.info({ userId: user.id }, 'guest signed up');
    return reply.code(201).send({ user: toProfile(user) });
  });

  app.get('/api/me', async req => {
    const user = await requireUser(ctx, req);
    return { user: toProfile(user) };
  });

  app.patch('/api/me', async req => {
    const user = await requireUser(ctx, req);
    const patch = ProfilePatch.parse(req.body);
    const updated = (await updateUser(ctx.db, user.id, patch)) ?? user;
    // Nexconn keeps the name for push notifications; re-issuing a token is how it is updated.
    if (patch.displayName && patch.displayName !== user.displayName && ctx.nexconn && user.nexconnTokenEncrypted) {
      await ensureNexconnToken(ctx, updated, { refresh: true }).catch(e => ctx.log.warn({ err: e, userId: user.id }, 'could not refresh Nexconn name'));
    }
    return { user: toProfile(updated) };
  });

  // Delete my account: the body must say so explicitly (no accidental DELETE from a stray request).
  app.delete('/api/me', async (req, reply) => {
    const user = await requireUser(ctx, req);
    rateLimit(deleteLimit, `user:${user.id}`);
    DeleteAccountBody.parse(req.body);
    const result = await deleteAccount(ctx, user);
    clearSession(reply, ctx.session);
    return reply.code(200).send({ deleted: true, ...result });
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    clearSession(reply, ctx.session);
    return reply.code(204).send();
  });

  app.post('/api/nexconn/token', async req => {
    const user = await requireUser(ctx, req);
    rateLimit(tokenLimit, `user:${user.id}`);
    const nexconn = requireNexconn(ctx);
    const { refresh } = TokenBody.parse(req.body ?? undefined);
    const token = await ensureNexconnToken(ctx, user, { refresh });
    return { token, appKey: nexconn.appKey, userId: nexconnUserId(user.id) };
  });
}
