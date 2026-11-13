// Shared HTTP plumbing for /api routes: auth guard, typed errors, origin check, rate limits.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { sessionUserId } from '../auth/session';
import type { Ctx } from '../context';
import { NexconnApiError, NexconnNotConfiguredError, NexconnUnavailableError } from '../nexconn/errors';
import { getUser, type UserRow } from '../repo/users';
import { CrewRuleError } from '../services/crews';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function requireUser(ctx: Ctx, req: FastifyRequest): Promise<UserRow> {
  const id = sessionUserId(req, ctx.session);
  const user = id ? await getUser(ctx.db, id) : null;
  if (!user || user.isAgent) throw new HttpError(401, 'unauthorized', 'Sign in first');
  return user;
}

export async function optionalUser(ctx: Ctx, req: FastifyRequest): Promise<UserRow | null> {
  const id = sessionUserId(req, ctx.session);
  const user = id ? await getUser(ctx.db, id) : null;
  return user && !user.isAgent ? user : null;
}

/** Fixed-window limiter keyed by IP or user id (in-memory: one server instance in Phase 1). */
export function fixedWindowLimiter({ limit, windowMs, now = Date.now }: { limit: number; windowMs: number; now?: () => number }) {
  const hits = new Map<string, { start: number; n: number }>();
  return (key: string): boolean => {
    const t = now();
    const h = hits.get(key);
    if (!h || t - h.start >= windowMs) {
      if (hits.size > 10_000) hits.clear();
      hits.set(key, { start: t, n: 1 });
      return true;
    }
    h.n++;
    return h.n <= limit;
  };
}

export function rateLimit(check: (key: string) => boolean, key: string): void {
  if (!check(key)) throw new HttpError(429, 'rate_limited', 'Too many requests. Try again in a minute.');
}

/** Origins allowed to send mutating /api requests (the web app; localhost too outside production). */
export function originAllowed(origin: string | undefined, ctx: Pick<Ctx, 'config'>): boolean {
  if (!origin) return true; // same-origin form posts and server-to-server calls carry none; SameSite=Lax covers the cookie
  if (origin === new URL(ctx.config.WEB_ORIGIN).origin) return true;
  return ctx.config.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export function installApiPlumbing(app: FastifyInstance, ctx: Ctx): void {
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    reply.header('cache-control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'HEAD' && !originAllowed(req.headers.origin, ctx)) {
      ctx.log.warn({ origin: req.headers.origin, url: req.url }, 'api: blocked cross-origin request');
      return reply.code(403).send({ error: 'forbidden_origin', message: 'Cross-origin request blocked' });
    }
  });

  app.setErrorHandler((err: unknown, req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof HttpError || err instanceof CrewRuleError) return reply.code(err.status).send({ error: err.code, message: err.message });
    if (err instanceof ZodError) return reply.code(400).send({ error: 'invalid_request', message: err.issues[0]?.message ?? 'Invalid request' });
    if (err instanceof NexconnNotConfiguredError)
      return reply.code(503).send({ error: 'chat_unavailable', message: 'Chat is not configured on this server yet' });
    if (err instanceof NexconnApiError || err instanceof NexconnUnavailableError) {
      req.log.error({ err: { name: err.name, message: err.message } }, 'nexconn call failed');
      return reply.code(502).send({ error: 'chat_error', message: 'The chat service did not accept the request. Try again.' });
    }
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500)
      return reply.code(e.statusCode).send({ error: 'bad_request', message: e.message ?? 'Bad request' });
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'internal', message: 'Something went wrong' });
  });
}
