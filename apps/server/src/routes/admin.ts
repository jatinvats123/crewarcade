// GET /api/admin/stats: the owner dashboard. Only user ids in ADMIN_USER_IDS; everyone else gets the
// same 404 as an unknown route (the page's existence isn't advertised).
import type { AdminStats } from '@crewarcade/shared';
import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context';
import { costPerDay, gameStats, signupStats, stageStats } from '../repo/admin';
import { fixedWindowLimiter, HttpError, rateLimit, requireUser } from './http';

const WINDOW_DAYS = 30;

export function isAdmin(ctx: Pick<Ctx, 'config'>, userId: string): boolean {
  return ctx.config.ADMIN_USER_IDS.includes(userId);
}

export function registerAdminRoutes(app: FastifyInstance, ctx: Ctx): void {
  const limit = fixedWindowLimiter({ limit: 20, windowMs: 60_000, now: ctx.now });
  app.get('/api/admin/stats', async (req, reply): Promise<AdminStats> => {
    const user = await requireUser(ctx, req).catch(() => null);
    if (!user || !isAdmin(ctx, user.id)) throw new HttpError(404, 'not_found', 'Not found');
    rateLimit(limit, `user:${user.id}`);
    const now = ctx.now();
    const since = new Date(now - WINDOW_DAYS * 86_400_000);
    reply.header('cache-control', 'no-store');
    return {
      windowDays: WINDOW_DAYS,
      stages: await stageStats(ctx.db, since),
      costPerDay: await costPerDay(ctx.db, new Date(now - 14 * 86_400_000)),
      queue: ctx.agents ? await ctx.agents.queue.depth().catch(() => null) : null,
      signups: await signupStats(ctx.db, since),
      games: await gameStats(ctx.db),
    };
  });
}
