// Human decisions on plan cards. Every permission is checked here from crew_members (never from
// the client or the card), every state change goes through the card's DB row under a lock, and the
// Nexconn metadata is then set from that state so all clients update live.
//   vote:    any human crew member, while the plan is pending (one vote each; switching allowed)
//   approve: owner or approver; creates the game room, RoomLink, approved copy + handoff, queues v1
//   change:  any human crew member; marks the card and asks Pixel for a revision
import { AGENTS, applyVote, newId, nexconnUserId } from '@crewarcade/shared';
import { addMemory } from '../agents/plan';
import { planMetadata, type PlanCardState } from '../agents/pixel';
import type { AgentServices } from '../agents/runtime-deps';
import type { Ctx } from '../context';
import { getRole, setCrewSettings } from '../repo/crews';
import { getCard, getGame, insertVersion, updateCardState, updateGame, type CardRow } from '../repo/games';
import type { UserRow } from '../repo/users';
import { postCard, updateCard } from './chat';
import { CrewRuleError, isApprover } from './crews';
import { record } from './ledger';
import { createGameRoom, resolveRoom, type Room } from './rooms';

type PlanCtx = Ctx & { agents: AgentServices };

async function loadPlan(
  ctx: Ctx,
  user: UserRow,
  messageId: string,
): Promise<{ card: CardRow; room: Room; role: NonNullable<Awaited<ReturnType<typeof getRole>>> }> {
  const card = await getCard(ctx.db, messageId);
  if (!card || card.cardType !== 'plan') throw new CrewRuleError(404, 'not_found', 'Card not found');
  const room = await resolveRoom(ctx, card.channelId);
  const role = room ? await getRole(ctx.db, room.crew.id, user.id) : null;
  // Not a member: same answer as "no such card".
  if (!room || !role) throw new CrewRuleError(404, 'not_found', 'Card not found');
  if ((card.state as PlanCardState).copy) throw new CrewRuleError(409, 'read_only', 'This is the approved copy of the plan');
  return { card, room, role };
}

const voterKey = (user: UserRow) => nexconnUserId(user.id);

export async function votePlan(ctx: PlanCtx, user: UserRow, messageId: string, vote: 'yes' | 'no'): Promise<Record<string, string>> {
  const { card, room } = await loadPlan(ctx, user, messageId);
  const box: { closed?: string } = {};
  const upd = await updateCardState<PlanCardState>(ctx.db, messageId, s => {
    if (s.status !== 'pending') {
      box.closed = s.status;
      return null;
    }
    if (s.voters[voterKey(user)] === vote) return null; // same vote again: nothing to do
    return { ...s, voters: applyVote(s.voters, voterKey(user), vote).voters };
  });
  if (box.closed) throw new CrewRuleError(409, 'closed', box.closed === 'approved' ? 'This plan is already approved' : 'Voting on this plan has closed');
  if (!upd) throw new CrewRuleError(404, 'not_found', 'Card not found');
  const metadata = planMetadata(upd.state);
  if (!upd.changed) return stringify(metadata);
  const out = await updateCard(ctx, { messageId, channelId: card.channelId, operatorId: voterKey(user), metadata });
  await record(ctx, {
    action: 'plan.vote',
    actor: { type: 'human', userId: user.id },
    crewId: room.crew.id,
    gameId: card.gameId,
    summary: `${user.displayName} voted ${vote === 'yes' ? '👍' : '👎'} on ${upd.state.content.title} (${metadata.yes} 👍 / ${metadata.no} 👎)`,
    input: { vote, planVersion: upd.state.content.version },
  });
  return out;
}

export async function requestChange(ctx: PlanCtx, user: UserRow, messageId: string, text: string): Promise<Record<string, string>> {
  const { card, room } = await loadPlan(ctx, user, messageId);
  const box: { closed?: string } = {};
  const upd = await updateCardState<PlanCardState>(ctx.db, messageId, s => {
    if (s.status !== 'pending' && s.status !== 'changes_requested') {
      box.closed = s.status;
      return null;
    }
    return { ...s, status: 'changes_requested', changeRequests: (s.changeRequests ?? 0) + 1 };
  });
  if (box.closed || !upd)
    throw new CrewRuleError(409, 'closed', box.closed === 'approved' ? 'This plan is already approved' : 'This plan was already replaced');
  const out = await updateCard(ctx, { messageId, channelId: card.channelId, operatorId: voterKey(user), metadata: planMetadata(upd.state) });
  await record(ctx, {
    action: 'plan.change_requested',
    actor: { type: 'human', userId: user.id },
    crewId: room.crew.id,
    gameId: card.gameId,
    summary: `${user.displayName} asked for a change to ${upd.state.content.title}`,
    input: { change: text, planVersion: upd.state.content.version },
  });
  await ctx.agents.queue.enqueueAgent({
    key: `card:${messageId}:change:${upd.state.changeRequests}`,
    crewId: room.crew.id,
    channelId: card.channelId,
    messageId: null,
    fromUserId: user.id,
    agent: 'pixel',
    intent: 'change',
    text,
    attachments: [],
    cardMessageId: messageId,
  });
  return out;
}

export async function approvePlan(ctx: PlanCtx, user: UserRow, messageId: string): Promise<Record<string, string>> {
  const { card, room, role } = await loadPlan(ctx, user, messageId);
  if (!isApprover(role)) throw new CrewRuleError(403, 'not_approver', 'Only the crew owner or an approver can approve a plan');
  const { crew } = room;

  // Claim the approval atomically: a second tap (or a second approver) gets 409.
  const box: { closed?: string; previous?: PlanCardState } = {};
  const claimed = await updateCardState<PlanCardState>(ctx.db, messageId, s => {
    if (s.status !== 'pending' && s.status !== 'changes_requested') {
      box.closed = s.status;
      return null;
    }
    box.previous = s;
    return { ...s, status: 'approved', approvedBy: user.displayName };
  });
  const previous = box.previous;
  if (box.closed || !claimed || !previous)
    throw new CrewRuleError(409, 'closed', box.closed === 'approved' ? 'This plan is already approved' : 'This plan was replaced by a newer one');
  const state = claimed.state;
  const game = card.gameId ? await getGame(ctx.db, card.gameId) : null;
  if (!game) throw new CrewRuleError(404, 'not_found', 'Game not found');

  let roomChannelId: string;
  try {
    roomChannelId = await createGameRoom(ctx, crew, { id: game.id, title: state.content.title });
  } catch (e) {
    // Give the card back so someone can approve again.
    await updateCardState<PlanCardState>(ctx.db, messageId, () => previous);
    throw e;
  }
  const spec = { ...state.spec, approvedBy: [user.displayName] };
  const approved: PlanCardState = { ...state, spec, roomChannelId };
  await updateCardState<PlanCardState>(ctx.db, messageId, () => approved);
  await updateGame(ctx.db, game.id, { roomChannelId, status: 'building', title: state.content.title });
  await insertVersion(ctx.db, { id: newId('version'), gameId: game.id, version: 1, spec, status: 'building', createdAt: new Date(ctx.now()) });
  const metadata = await updateCard(ctx, { messageId, channelId: card.channelId, operatorId: voterKey(user), metadata: planMetadata(approved) });

  await record(ctx, {
    action: 'plan.approved',
    actor: { type: 'human', userId: user.id },
    crewId: crew.id,
    gameId: game.id,
    summary: `${user.displayName} approved ${state.content.title} (plan v${state.content.version}, ${metadata.yes ?? 0} 👍 / ${metadata.no ?? 0} 👎)`,
    input: { planVersion: state.content.version, votes: state.voters },
  });
  await record(ctx, {
    action: 'room.created',
    actor: { type: 'system' },
    crewId: crew.id,
    gameId: game.id,
    summary: `Game room 🎮 ${state.content.title} created`,
    output: { channelId: roomChannelId },
  });

  // Crew chat: a link to the new room. Game room: the approved plan, then Pixel's handoff to Forge.
  await postCard(ctx, {
    channelId: crew.groupChannelId,
    agent: 'pixel',
    kind: 'roomLink',
    content: { v: 1, channelId: roomChannelId, gameId: game.id, title: `🎮 ${state.content.title}`.slice(0, 60), kind: 'game' },
    metadata: {},
    gameId: game.id,
  });
  const copyState: PlanCardState = { ...approved, copy: true };
  const copyId = await postCard(ctx, {
    channelId: roomChannelId,
    agent: 'pixel',
    kind: 'plan',
    content: state.content,
    metadata: planMetadata(copyState),
    gameId: game.id,
    version: state.content.version,
    state: copyState,
  });
  const task = 'Build v1 from this plan';
  const contextSummary =
    `${state.content.title}: ${state.content.pitch} ${state.content.acceptance.length} acceptance checks. Approved by ${user.displayName}.`.slice(0, 600);
  const handoffId = await postCard(ctx, {
    channelId: roomChannelId,
    agent: 'pixel',
    kind: 'handoff',
    content: {
      v: 1,
      gameId: game.id,
      from: 'pixel',
      to: 'forge',
      task,
      contextSummary,
      artifacts: [{ kind: 'plan', label: `Plan v${state.content.version}`, ref: copyId }],
    },
    metadata: { status: 'waiting' },
    gameId: game.id,
    version: 1,
    state: { kind: 'handoff', status: 'waiting' },
  });
  await record(ctx, {
    action: 'handoff',
    actor: { type: 'agent', agent: 'pixel' },
    crewId: crew.id,
    gameId: game.id,
    summary: `Pixel → Forge: ${task}`,
    output: { handoffMessageId: handoffId, planMessageId: copyId },
  });
  const queued = await ctx.agents.queue.enqueueBuild({
    key: `${game.id}:v1`,
    gameId: game.id,
    version: 1,
    channelId: roomChannelId,
    handoffMessageId: handoffId,
    reason: game.remixOfGameId ? 'remix' : 'build',
    requestedBy: user.id,
  });
  await record(ctx, {
    action: 'build.queued',
    actor: { type: 'system' },
    crewId: crew.id,
    gameId: game.id,
    summary: 'Build v1 queued for Forge',
    output: { queued },
  });

  // Pixel is done here; Forge is next.
  await ctx.agents.states.set(card.channelId, 'pixel', 'idle');
  await ctx.agents.states.set(roomChannelId, 'forge', 'waiting_approval', { detail: 'build v1 starts soon', gameId: game.id });

  // Crew memory: one short preference per approved plan, newest first, at most 10.
  if (state.memoryNote) {
    const settings = crew.settings as { memory?: unknown };
    const memory = Array.isArray(settings.memory) ? settings.memory.filter((m): m is string => typeof m === 'string') : [];
    const next = addMemory(memory, state.memoryNote);
    if (next[0] !== memory[0]) {
      await setCrewSettings(ctx.db, crew.id, { ...crew.settings, memory: next });
      await record(ctx, {
        action: 'crew.memory_updated',
        actor: { type: 'agent', agent: 'pixel' },
        crewId: crew.id,
        gameId: game.id,
        summary: `Pixel remembered: ${next[0]}`,
        output: { memory: next },
      });
    }
  }
  ctx.log.info({ gameId: game.id, roomChannelId, by: user.id, agent: AGENTS.pixel.id }, 'plan approved');
  return metadata;
}

function stringify(m: ReturnType<typeof planMetadata>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) if (v !== undefined) out[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return out;
}
