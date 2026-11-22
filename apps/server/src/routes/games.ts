// Cards, rooms, games and the Decision Ledger.
//   POST /api/cards/:messageId/vote      {vote: yes|no}   any human crew member
//   POST /api/cards/:messageId/approve                    owner or approver
//   POST /api/cards/:messageId/change    {text}           any human crew member (plan: revise; build: next version)
//   POST /api/cards/:messageId/publish   {decision}       owner or approver (Allow / Block); agents never
//   POST /api/cards/:messageId/fix                        any human crew member ([Ask for fix] / [Try again] on a FAIL)
//   GET  /api/rooms/:channelId                            which crew/game a channel is (members only)
//   GET  /api/rooms/:channelId/agents                     live agent states in that room
//   GET  /api/games/:id/ledger                            the game's Decision Ledger (members; public once published)
//   GET  /api/crews/:id/agents/:agent/activity            an agent's last 5 ledger actions in a crew
//   POST /api/games/:id/bugs             {description, version?, screenshot?}  any human crew member (Phase 5)
//   GET  /api/bugs/:id/screenshot                         the report's screenshot (crew members only)
//   POST /api/translate/quota            {chars}          reserve today's tap-to-translate allowance
import {
  AGENTS,
  BugReportBody,
  BUILTIN_MESSAGE_TYPES,
  ChangeRequestBody,
  LIMITS,
  nexconnUserId,
  PublishDecisionBody,
  TranslateQuotaBody,
  VoteBody,
  type LedgerResponse,
  type RoomInfo,
} from '@crewarcade/shared';
import { routeIncoming } from '../agents/runtime';
import { logMessage } from '../repo/webhooks';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AgentServices } from '../agents/runtime-deps';
import type { Ctx } from '../context';
import { getCrew, getRole } from '../repo/crews';
import { getCard, getGame, listLedgerForActor, listLedgerForGame, toGameSummary, toLedgerEntry } from '../repo/games';
import { requestBuildChange } from '../services/builds';
import { approvePlan, requestChange, votePlan } from '../services/plans';
import { shieldRelayed } from '../safety/runtime';
import { bugScreenshot, reportBug, reserveTranslation } from '../services/bugs';
import { askForFix, decidePublish } from '../services/publish';
import { resolveRoom } from '../services/rooms';
import { fixedWindowLimiter, HttpError, optionalUser, rateLimit, requireUser } from './http';

const MessageParam = z.object({ messageId: z.string().min(1).max(64) });
const ChannelParam = z.object({ channelId: z.string().regex(/^[A-Za-z0-9]{1,64}$/) });
const IdParam = z.object({ id: z.string().min(1).max(64) });
const ActivityParams = z.object({ id: z.string().min(1).max(64), agent: z.enum(['pixel', 'forge', 'glitch']) });
const RelayBody = z
  .object({
    channelId: z.string().regex(/^[A-Za-z0-9]{1,64}$/),
    messageId: z.string().min(1).max(128),
    text: z
      .string()
      .min(1)
      .max(LIMITS.chatTextChars * 2)
      .optional(),
    /** Phase 5: a voice note (its uploaded URL); routed after transcription. */
    voice: z.object({ url: z.string().url().max(2048), durationS: z.number().min(0).max(3600) }).optional(),
    mentionedUserIds: z.array(z.string().max(64)).max(30).default([]),
  })
  .refine(b => !!b.text !== !!b.voice, 'Send text or a voice note');

function agentsOf(ctx: Ctx): Ctx & { agents: AgentServices } {
  if (!ctx.agents) throw new HttpError(503, 'agents_unavailable', 'The agents are not running on this server');
  return ctx as Ctx & { agents: AgentServices };
}

export function registerGameRoutes(app: FastifyInstance, ctx: Ctx): void {
  const voteLimit = fixedWindowLimiter({ limit: 60, windowMs: 60_000, now: ctx.now });
  const actionLimit = fixedWindowLimiter({ limit: 10, windowMs: 60_000, now: ctx.now });

  app.post('/api/cards/:messageId/vote', async req => {
    const user = await requireUser(ctx, req);
    rateLimit(voteLimit, `user:${user.id}`);
    const { messageId } = MessageParam.parse(req.params);
    const { vote } = VoteBody.parse(req.body);
    return { messageId, metadata: await votePlan(agentsOf(ctx), user, messageId, vote) };
  });

  app.post('/api/cards/:messageId/approve', async req => {
    const user = await requireUser(ctx, req);
    rateLimit(actionLimit, `user:${user.id}`);
    const { messageId } = MessageParam.parse(req.params);
    return { messageId, metadata: await approvePlan(agentsOf(ctx), user, messageId) };
  });

  app.post('/api/cards/:messageId/change', async req => {
    const user = await requireUser(ctx, req);
    rateLimit(actionLimit, `user:${user.id}`);
    const { messageId } = MessageParam.parse(req.params);
    const { text } = ChangeRequestBody.parse(req.body);
    // [Change] on a Build card asks for the next version; on a plan card it revises the plan.
    const card = await getCard(ctx.db, messageId);
    if (card?.cardType === 'build') {
      await requestBuildChange(agentsOf(ctx), user, messageId, text);
      return { messageId, metadata: {} };
    }
    return { messageId, metadata: await requestChange(agentsOf(ctx), user, messageId, text) };
  });

  app.post('/api/cards/:messageId/publish', async req => {
    const user = await requireUser(ctx, req);
    rateLimit(actionLimit, `user:${user.id}`);
    const { messageId } = MessageParam.parse(req.params);
    const { decision } = PublishDecisionBody.parse(req.body);
    return { messageId, metadata: await decidePublish(agentsOf(ctx), user, messageId, decision) };
  });

  app.post('/api/cards/:messageId/fix', async req => {
    const user = await requireUser(ctx, req);
    rateLimit(actionLimit, `user:${user.id}`);
    const { messageId } = MessageParam.parse(req.params);
    const { version } = await askForFix(agentsOf(ctx), user, messageId);
    return { messageId, version };
  });

  // Backup trigger for the agents: the app reports a text message it just sent, and the server
  // routes it exactly as the message:send webhook would (only as the signed-in user, only in rooms
  // they belong to), after the same shield. Job ids come from the messageId, so webhook + relay never
  // run a job twice.
  const relayLimit = fixedWindowLimiter({ limit: 30, windowMs: 60_000, now: ctx.now });
  app.post('/api/chat/relay', async req => {
    const user = await requireUser(ctx, req);
    rateLimit(relayLimit, `user:${user.id}`);
    const body = RelayBody.parse(req.body);
    await memberRoom(user.id, body.channelId);
    const mentions = body.mentionedUserIds.length > 0 ? { mentionedInfo: { type: 2, userIdList: body.mentionedUserIds } } : {};
    // A relayed voice URL comes from the browser: only hosts in NEXCONN_MEDIA_HOSTS are fetched;
    // without that list the signed webhook (same messageId) is the only trigger.
    if (body.voice && ctx.config.NEXCONN_MEDIA_HOSTS.length === 0) return { routed: false };
    const messageType = body.voice ? BUILTIN_MESSAGE_TYPES.hdVoice : BUILTIN_MESSAGE_TYPES.text;
    const content = JSON.stringify(
      body.voice ? { remoteUrl: body.voice.url, duration: body.voice.durationS, ...mentions } : { content: body.text, ...mentions },
    );
    // Not logged either: the agents read the log (the webhook keeps its own record).
    const incoming = { messageId: body.messageId, channelId: body.channelId, userId: nexconnUserId(user.id), messageType, content };
    if (await shieldRelayed(ctx, { ...incoming, channelType: 3 })) return { routed: false };
    await logMessage(ctx.db, {
      nexconnMessageId: body.messageId,
      channelId: body.channelId,
      channelType: 3,
      fromUserId: user.id,
      messageType,
      text: body.text?.slice(0, 2000) ?? null,
      createdAt: new Date(ctx.now()),
    });
    const key = ctx.agents
      ? await routeIncoming(ctx as Ctx & { agents: AgentServices }, {
          ...incoming,
          relayed: true,
        })
      : null;
    return { routed: key !== null };
  });

  // ---- Phase 5: bug reports, screenshots, translation allowance

  const bugLimit = fixedWindowLimiter({ limit: 5, windowMs: 60_000, now: ctx.now });
  app.post('/api/games/:id/bugs', { bodyLimit: 6 * 1024 * 1024 }, async req => {
    const user = await requireUser(ctx, req);
    rateLimit(bugLimit, `user:${user.id}`);
    const { id } = IdParam.parse(req.params);
    const body = BugReportBody.parse(req.body);
    return reportBug(agentsOf(ctx), user, id, body, 'player');
  });

  app.get('/api/bugs/:id/screenshot', async (req, reply) => {
    const user = await requireUser(ctx, req);
    const { id } = IdParam.parse(req.params);
    const shot = await bugScreenshot(ctx, user, id);
    return reply
      .code(200)
      .headers({ 'content-type': shot.contentType, 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff' })
      .send(shot.body);
  });

  const translateLimit = fixedWindowLimiter({ limit: 30, windowMs: 60_000, now: ctx.now });
  app.post('/api/translate/quota', async req => {
    const user = await requireUser(ctx, req);
    rateLimit(translateLimit, `user:${user.id}`);
    const { chars } = TranslateQuotaBody.parse(req.body);
    return reserveTranslation(ctx, user, chars);
  });

  async function memberRoom(userId: string, channelId: string) {
    const room = await resolveRoom(ctx, channelId);
    const role = room ? await getRole(ctx.db, room.crew.id, userId) : null;
    if (!room || !role) throw new HttpError(404, 'not_found', 'Room not found');
    return room;
  }

  app.get('/api/rooms/:channelId', async req => {
    const user = await requireUser(ctx, req);
    const { channelId } = ChannelParam.parse(req.params);
    const room = await memberRoom(user.id, channelId);
    const info: RoomInfo = { channelId, kind: room.kind, crewId: room.crew.id, game: room.game ? toGameSummary(room.game) : null };
    return { room: info };
  });

  app.get('/api/rooms/:channelId/agents', async req => {
    const user = await requireUser(ctx, req);
    const { channelId } = ChannelParam.parse(req.params);
    await memberRoom(user.id, channelId);
    return { states: ctx.agents?.states.snapshot(channelId) ?? [] };
  });

  // Members always; anyone once the game is published (the public "How it was made" story).
  app.get('/api/games/:id/ledger', async req => {
    const user = await optionalUser(ctx, req);
    const { id } = IdParam.parse(req.params);
    const game = await getGame(ctx.db, id);
    const member = !!game && !!user && !!(await getRole(ctx.db, game.crewId, user.id));
    if (!game || (!member && !game.publishedVersion)) throw new HttpError(404, 'not_found', 'Game not found');
    const entries = (await listLedgerForGame(ctx.db, id)).map(toLedgerEntry);
    const totals = entries.reduce(
      (t, e) => ({
        tokensIn: t.tokensIn + e.tokensIn,
        tokensOut: t.tokensOut + e.tokensOut,
        costUsd: Math.round((t.costUsd + e.costUsd) * 1e6) / 1e6,
        agentMs: t.agentMs + (e.actorType === 'agent' ? (e.ms ?? 0) : 0),
      }),
      { tokensIn: 0, tokensOut: 0, costUsd: 0, agentMs: 0 },
    );
    const body: LedgerResponse = { game: toGameSummary(game), entries, totals };
    return body;
  });

  app.get('/api/crews/:id/agents/:agent/activity', async req => {
    const user = await requireUser(ctx, req);
    const { id, agent } = ActivityParams.parse(req.params);
    const [crew, role] = await Promise.all([getCrew(ctx.db, id), getRole(ctx.db, id, user.id)]);
    if (!crew || !role) throw new HttpError(404, 'not_found', 'Crew not found');
    const entries = (await listLedgerForActor(ctx.db, id, AGENTS[agent].id, 5)).map(toLedgerEntry);
    return { agent, entries };
  });
}
