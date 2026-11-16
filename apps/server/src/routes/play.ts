// Builds, playing and scores.
//   GET  /play/:slug/v/:version[?t=token]        the game HTML, strict CSP (sandboxed iframe only)
//   GET  /api/games/:id/versions/:version/play   a play URL (signed for unpublished versions; members)
//   GET  /api/games/:id/versions                  versions (members: all; others: published only)
//   POST /api/cards/:messageId/retry              [Try again] on a failed Build card (members)
//   POST /api/scores {gameId, version, score, timeMs}   signed in; rate limited; plausibility checks
//   GET  /api/games/:id/leaderboard               top 20, my best, my rank
//   GET  /api/public/games/:slug                  the public game page (drafts: teaser)
//   POST /api/games/:slug/remix {crewId|newCrewName, idea}   signed in; published games only
import { RemixBody, ScoreBody } from '@crewarcade/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AgentServices } from '../agents/runtime-deps';
import type { Ctx } from '../context';
import { getGameBySlug, getVersion } from '../repo/versions';
import { gamePage, playLink, retryBuild, startRemix, versionsOf } from '../services/builds';
import { frameAncestors, gameHeaders, verifyPlayToken } from '../services/play';
import { leaderboard, submitScore } from '../services/scores';
import { gameHtmlKey } from '../storage';
import { fixedWindowLimiter, HttpError, optionalUser, rateLimit, requireUser } from './http';

const slugRe = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
const PlayParams = z.object({ slug: z.string().regex(slugRe), version: z.coerce.number().int().min(1).max(10_000) });
const PlayQuery = z.object({ t: z.string().max(200).optional() });
const GameParam = z.object({ id: z.string().min(1).max(64) });
const GameVersionParams = z.object({ id: z.string().min(1).max(64), version: z.union([z.literal('latest'), z.coerce.number().int().min(1).max(10_000)]) });
const SlugParam = z.object({ slug: z.string().regex(slugRe) });
const MessageParam = z.object({ messageId: z.string().min(1).max(64) });

const NOT_FOUND_HTML =
  '<!doctype html><meta charset="utf-8"><title>Not found</title><body style="font:16px system-ui;background:#0f0b1e;color:#fff;display:grid;place-items:center;height:100vh;margin:0">This game link expired or does not exist.</body>';

function agentsOf(ctx: Ctx): Ctx & { agents: AgentServices } {
  if (!ctx.agents) throw new HttpError(503, 'agents_unavailable', 'The agents are not running on this server');
  return ctx as Ctx & { agents: AgentServices };
}

export function registerPlayRoutes(app: FastifyInstance, ctx: Ctx): void {
  const ancestors = frameAncestors(ctx.config);
  const playLimit = fixedWindowLimiter({ limit: 120, windowMs: 60_000, now: ctx.now });
  const scoreLimit = fixedWindowLimiter({ limit: 30, windowMs: 60_000, now: ctx.now });
  const actionLimit = fixedWindowLimiter({ limit: 10, windowMs: 60_000, now: ctx.now });
  const remixLimit = fixedWindowLimiter({ limit: 5, windowMs: 60_000, now: ctx.now });

  app.get('/play/:slug/v/:version', async (req, reply) => {
    rateLimit(playLimit, `ip:${req.ip}`);
    const notFound = () =>
      reply
        .code(404)
        .headers({ ...gameHeaders({ ancestors, published: false }), 'cache-control': 'no-store' })
        .send(NOT_FOUND_HTML);
    const p = PlayParams.safeParse(req.params);
    const q = PlayQuery.safeParse(req.query);
    if (!p.success || !q.success) return notFound();
    const game = await getGameBySlug(ctx.db, p.data.slug);
    const v = game ? await getVersion(ctx.db, game.id, p.data.version) : null;
    if (!game || !v?.htmlPath) return notFound();
    const published = game.publishedVersion === v.version;
    if (!published && !verifyPlayToken(ctx.config, q.data.t, { slug: game.slug, version: v.version, now: ctx.now() })) return notFound();
    const html = await ctx.storage.get(gameHtmlKey(game.slug, v.version));
    if (!html) {
      ctx.log.error({ slug: game.slug, version: v.version }, 'play: stored HTML missing');
      return notFound();
    }
    return reply.code(200).headers(gameHeaders({ ancestors, published })).send(html);
  });

  app.get('/api/games/:id/versions/:version/play', async req => {
    const { id, version } = GameVersionParams.parse(req.params);
    return playLink(ctx, await optionalUser(ctx, req), id, version);
  });

  app.get('/api/games/:id/versions', async req => {
    const { id } = GameParam.parse(req.params);
    return { gameId: id, versions: await versionsOf(ctx, await optionalUser(ctx, req), id) };
  });

  app.post('/api/cards/:messageId/retry', async req => {
    const user = await requireUser(ctx, req);
    rateLimit(actionLimit, `user:${user.id}`);
    const { messageId } = MessageParam.parse(req.params);
    return retryBuild(agentsOf(ctx), user, messageId);
  });

  app.post('/api/scores', async (req, reply) => {
    const user = await requireUser(ctx, req);
    rateLimit(scoreLimit, `user:${user.id}`);
    const body = ScoreBody.parse(req.body);
    const res = await submitScore(ctx, user, body);
    return reply.code(res.status).send(res.body);
  });

  app.get('/api/games/:id/leaderboard', async req => {
    const { id } = GameParam.parse(req.params);
    return leaderboard(ctx, id, await optionalUser(ctx, req));
  });

  app.get('/api/public/games/:slug', async (req, reply) => {
    const { slug } = SlugParam.parse(req.params);
    const page = await gamePage(ctx, slug);
    // Short public cache: the page changes when a version is published or remixed.
    reply.header('cache-control', 'public, max-age=30');
    return page;
  });

  app.post('/api/games/:slug/remix', async req => {
    const user = await requireUser(ctx, req);
    rateLimit(remixLimit, `user:${user.id}`);
    const { slug } = SlugParam.parse(req.params);
    const body = RemixBody.parse(req.body);
    return startRemix(agentsOf(ctx), user, slug, body);
  });
}
