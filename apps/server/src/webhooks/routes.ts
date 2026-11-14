// POST /webhooks/nexconn: the single webhook URL Nexconn calls for every event (Console > Chat >
// Chat settings > Webhooks takes one URL). Flow:
//   1. verify the signature (constant time) and timestamp freshness -> 401 if bad
//   2. *:pre_messaging -> answer synchronously within the 5 s budget (Phase 1: allow all, pass 1)
//   3. other events -> claim the event id in webhook_events (DB unique); duplicates get 200 at once
//   4. reply 200, then process asynchronously (messages_log, connections)
// POST /webhooks/nexconn/pre is an alias for the same handler, kept in case a separate
// pre-messaging URL is ever needed.
import { PreMessagingResponse, WebhookEnvelope } from '@crewarcade/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Ctx } from '../context';
import { routeIncoming } from '../agents/runtime';
import type { AgentServices } from '../agents/runtime-deps';
import { claimWebhookEvent } from '../repo/webhooks';
import { processWebhook } from './process';
import { verifyWebhook } from './verify';

/** Target for the synchronous gate (Phase 4 adds rules); slower answers are logged as warnings. */
export const PRE_MESSAGING_BUDGET_MS = 150;

export const isPreMessaging = (type: string): boolean => type.endsWith(':pre_messaging');

/** Phase 1 shield: deterministic allow-all. Phase 4 adds the prompt-injection/secret/abuse rules. */
export function preMessagingDecision(_event: WebhookEnvelope): PreMessagingResponse {
  return { pass: 1 };
}

export function registerWebhookRoutes(app: FastifyInstance, ctx: Ctx): void {
  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    const t0 = performance.now();
    const { NEXCONN_APP_KEY: appKey, NEXCONN_APP_SECRET: appSecret } = ctx.config;
    if (!appKey || !appSecret) return reply.code(503).send({ error: 'not_configured' });

    const v = verifyWebhook(req.headers, { appKey, appSecret, maxSkewMs: ctx.config.WEBHOOK_MAX_SKEW_MS, now: ctx.now() });
    if (!v.ok) {
      // Header NAMES only (never values) and the timestamp's shape, to diagnose signing mismatches.
      const ts = req.headers.timestamp;
      ctx.log.warn(
        {
          reason: v.reason,
          ip: req.ip,
          headerNames: Object.keys(req.headers).sort(),
          timestampShape: typeof ts === 'string' ? `${ts.length} chars, digits=${/^\d+$/.test(ts)}` : typeof ts,
        },
        'webhook: rejected',
      );
      // An UNSIGNED request (e.g. the console checking the URL on save) gets a 200 so the URL is
      // accepted, but nothing is processed. Signed requests that fail the check still get 401.
      if (v.reason === 'missing_headers') {
        const body = req.body as unknown;
        ctx.log.warn({ bodyShape: body && typeof body === 'object' ? Object.keys(body).sort() : typeof body }, 'webhook: unsigned request ignored');
        return reply.code(200).send({ ok: false, ignored: 'unsigned' });
      }
      return reply.code(401).send({ error: 'invalid_signature' });
    }
    const parsed = WebhookEnvelope.safeParse(req.body);
    if (!parsed.success) {
      ctx.log.warn({ issue: parsed.error.issues[0]?.message }, 'webhook: bad envelope');
      // 2xx: a malformed event will never become valid, so retrying it is pointless.
      return reply.code(200).send({ ok: false });
    }
    const event = parsed.data;

    if (isPreMessaging(event.type)) {
      const decision = PreMessagingResponse.parse(preMessagingDecision(event));
      const ms = Math.round((performance.now() - t0) * 100) / 100;
      const log = { type: event.type, eventId: event.id, pass: decision.pass, ms };
      if (ms > PRE_MESSAGING_BUDGET_MS) ctx.log.warn(log, 'pre-messaging: slow decision');
      else ctx.log.debug(log, 'pre-messaging: decision');
      return reply.code(200).send(decision);
    }

    if (!(await claimWebhookEvent(ctx.db, event.id, event.type))) {
      ctx.log.debug({ type: event.type, eventId: event.id }, 'webhook: duplicate skipped');
      return reply.code(200).send({ ok: true, duplicate: true });
    }
    ctx.runInBackground(`webhook ${event.type}`, async () => {
      const agents = ctx.agents;
      const r = await processWebhook(ctx, event, agents ? m => routeIncoming({ ...ctx, agents } as Ctx & { agents: AgentServices }, m) : undefined);
      ctx.log.debug({ type: event.type, eventId: event.id, ...r }, 'webhook: processed');
    });
    return reply.code(200).send({ ok: true });
  };

  app.post('/webhooks/nexconn', handler);
  app.post('/webhooks/nexconn/pre', handler);
}
