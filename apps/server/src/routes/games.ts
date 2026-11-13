// Cards, rooms, games and the Decision Ledger.
//   POST /api/cards/:messageId/vote      {vote: yes|no}   any human crew member
//   POST /api/cards/:messageId/approve                    owner or approver
//   POST /api/cards/:messageId/change    {text}           any human crew member
//   GET  /api/rooms/:channelId                            which crew/game a channel is (members only)
//   GET  /api/rooms/:channelId/agents                     live agent states in that room
//   GET  /api/games/:id/ledger                            the game's Decision Ledger (members only)
//   GET  /api/crews/:id/agents/:agent/activity            an agent's last 5 ledger actions in a crew
import { AGENTS, ChangeRequestBody, VoteBody, type LedgerResponse, type RoomInfo } from '@crewarcade/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AgentServices } from '../agents/runtime-deps';
import type { Ctx } from '../context';
import { getCrew, getRole } from '../repo/crews';
import { getGame, listLedgerForActor, listLedgerForGame, toGameSummary, toLedgerEntry } from '../repo/games';
import { approvePlan, requestChange, votePlan } from '../services/plans';
import { resolveRoom } from '../services/rooms';
import { fixedWindowLimiter, HttpError, rateLimit, requireUser } from './http';

const MessageParam = z.object({ messageId: z.string().min(1).max(64) });
const ChannelParam = z.object({ channelId: z.string().regex(/^[A-Za-z0-9]{1,64}$/) });
const IdParam = z.object({ id: z.string().min(1).max(64) });
const ActivityParams = z.object({ id: z.string().min(1).max(64), agent: z.enum(['pixel', 'forge', 'glitch']) });

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
    return { messageId, metadata: await requestChange(agentsOf(ctx), user, messageId, text) };
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

  app.get('/api/games/:id/ledger', async req => {
    const user = await requireUser(ctx, req);
    const { id } = IdParam.parse(req.params);
    const game = await getGame(ctx.db, id);
    if (!game || !(await getRole(ctx.db, game.crewId, user.id))) throw new HttpError(404, 'not_found', 'Game not found');
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
