// Pixel (Designer): pitch -> streamed intro + Plan card; change request -> revised Plan card
// (version + 1, the old one superseded); remix -> a new plan linked to the source game; explain ->
// a short streamed answer from the plan. Each step writes the Decision Ledger with tokens/cost/ms.
import { newId, type PlanCardContent, type PlanStatus } from '@crewarcade/shared';
import type { GameSpec } from '@crewarcade/engine';
import type { AiUsage } from '../ai/claude';
import type { Ctx } from '../context';
import { type CrewRow } from '../repo/crews';
import {
  findGameForRemix,
  getCard,
  getGame,
  insertGame,
  latestOpenPlan,
  latestPlanForGame,
  recentChat,
  slugsLike,
  updateCardState,
  updateGame,
  type CardRow,
} from '../repo/games';
import { getUser, type UserRow } from '../repo/users';
import { postCard, postText, streamReply, updateCard } from '../services/chat';
import { record } from '../services/ledger';
import type { Room } from '../services/rooms';
import { baseSlug, detectLanguage, normalizePlan, pickSlug, PixelPlanOutput, PlanShapeError, type PitchLanguage } from './plan';
import { CANNED, explainRequest, PIXEL_EXPLAIN_SYSTEM, PIXEL_SYSTEM, planRequest, reviseRequest } from './prompts';
import type { AgentJobData } from './queue';
import { chargeUsage, requireAi, type AgentServices } from './runtime-deps';

/** Server-side state of a plan card (cards.state): the source of truth behind its metadata. */
export interface PlanCardState extends Record<string, unknown> {
  kind: 'plan';
  status: PlanStatus;
  voters: Record<string, 'yes' | 'no'>;
  content: PlanCardContent;
  spec: GameSpec;
  memoryNote: string;
  crewId: string;
  requestedBy: string;
  changeRequests: number;
  /** true for the approved copy posted in the game room. */
  copy?: boolean;
  approvedBy?: string;
  supersededBy?: string;
  roomChannelId?: string;
}

export const planMetadata = (s: PlanCardState) => ({
  status: s.status,
  yes: Object.values(s.voters).filter(v => v === 'yes').length,
  no: Object.values(s.voters).filter(v => v === 'no').length,
  voters: s.voters,
  approvedBy: s.approvedBy,
  supersededBy: s.supersededBy,
  roomChannelId: s.roomChannelId,
});

type AgentCtx = Ctx & { agents: AgentServices };

const memoryOf = (crew: CrewRow): string[] => {
  const m = (crew.settings as { memory?: unknown }).memory;
  return Array.isArray(m) ? m.filter((x): x is string => typeof x === 'string').slice(0, 10) : [];
};

const metrics = (u: AiUsage) => ({ tokensIn: u.tokensIn, tokensOut: u.tokensOut, costUsd: u.costUsd, ms: u.ms });

/** Streams Pixel's intro while the plan JSON is still generating; switches thinking -> designing on the first words. */
async function generatePlan(
  ctx: AgentCtx,
  channelId: string,
  call: { purpose: 'pixel.plan' | 'pixel.revise'; user: string; hint: Record<string, unknown> },
  gameId: string | undefined,
): Promise<{ out: PixelPlanOutput; usage: AiUsage; streamedMessageId: string | null }> {
  const ai = requireAi(ctx);
  const run = ai.structured({
    purpose: call.purpose,
    system: PIXEL_SYSTEM,
    user: call.user,
    schema: PixelPlanOutput,
    streamField: 'intro',
    effort: 'medium',
    maxTokens: 16_000,
    hint: call.hint,
  });
  let first = true;
  const states = ctx.agents.states;
  async function* intro() {
    for await (const piece of run.fieldChunks) {
      if (first) {
        first = false;
        void states.set(channelId, 'pixel', 'designing', { detail: 'sketching the plan', ...(gameId && { gameId }) });
      }
      yield piece;
    }
  }
  const streamed = streamReply(ctx, channelId, 'pixel', intro());
  try {
    const { value, usage } = await run.done;
    const s = await streamed;
    return { out: value, usage, streamedMessageId: s.messageId };
  } catch (e) {
    await streamed.catch(() => null);
    throw e;
  }
}

async function freeSlug(ctx: Ctx, title: string, gameId: string): Promise<string> {
  const base = baseSlug(title, `game-${gameId.slice(1, 7).toLowerCase()}`);
  return pickSlug(base, await slugsLike(ctx.db, base));
}

/** New plan from a pitch (or a remix). */
export async function runPlan(
  ctx: AgentCtx,
  job: AgentJobData,
  room: Room,
  remix?: { source: { id: string; title: string; slug: string }; plan: PlanCardContent | null; idea: string },
): Promise<void> {
  const { crew } = room;
  const user = await getUser(ctx.db, job.fromUserId);
  if (!user) return;
  const pitch = remix ? remix.idea : job.text;
  const language = detectLanguage(pitch, user.language);
  const memory = memoryOf(crew);
  const chat = await recentChat(ctx.db, job.channelId, 30);
  await ctx.agents.states.set(job.channelId, 'pixel', 'thinking', { detail: 'reading the pitch' });

  const prompt = planRequest({
    pitcher: user.displayName,
    pitch,
    language,
    memory,
    chat,
    remixOf: remix && { title: remix.source.title, plan: remix.plan, idea: remix.idea },
  });
  const hint = { pitch, language, pitcher: user.displayName, ...(remix && { remixTitle: remix.source.title }) };
  const gameId = newId('game');
  const { out, usage } = await generatePlan(ctx, job.channelId, { purpose: 'pixel.plan', user: prompt, hint }, undefined);
  await chargeUsage(ctx, user.id, usage);

  const slug = await freeSlug(ctx, out.title, gameId);
  const credits = [user.displayName];
  let normalized;
  try {
    normalized = normalizePlan(out, {
      gameId,
      planVersion: 1,
      slug,
      language: language.code,
      credits,
      remixOf: remix && { title: remix.source.title, slug: remix.source.slug },
    });
  } catch (e) {
    if (e instanceof PlanShapeError) throw Object.assign(e, { usage });
    throw e;
  }
  const { card, spec } = normalized;
  await insertGame(ctx.db, {
    id: gameId,
    slug,
    crewId: crew.id,
    title: card.title,
    pitch: card.pitch,
    status: 'planning',
    language: card.language,
    createdBy: user.id,
    remixOfGameId: remix?.source.id ?? null,
    createdAt: new Date(ctx.now()),
  });
  const state: PlanCardState = {
    kind: 'plan',
    status: 'pending',
    voters: {},
    content: card,
    spec,
    memoryNote: out.memoryNote.trim(),
    crewId: crew.id,
    requestedBy: user.id,
    changeRequests: 0,
  };
  const messageId = await postCard(ctx, {
    channelId: job.channelId,
    agent: 'pixel',
    kind: 'plan',
    content: card,
    metadata: planMetadata(state),
    gameId,
    version: 1,
    state,
  });
  await record(ctx, {
    action: 'plan.created',
    actor: { type: 'agent', agent: 'pixel' },
    crewId: crew.id,
    gameId,
    summary: `Pixel planned ${card.title}${remix ? ` (remix of ${remix.source.title})` : ''}`,
    input: { pitch, pitcher: user.displayName, language, memory, chatLines: chat.length, ...(remix && { remixOf: remix.source.slug }) },
    output: { intro: out.intro, plan: card, messageId },
    metrics: metrics(usage),
    ...(usage.fellBack && { reason: 'served by the refusal fallback model' }),
  });
  await ctx.agents.states.set(job.channelId, 'pixel', 'waiting_approval', { detail: card.title, gameId });
}

/** Revised plan for a change request ("@pixel make it faster" or the [Change] button). */
export async function runRevise(ctx: AgentCtx, job: AgentJobData, room: Room): Promise<void> {
  const target = job.cardMessageId ? await getPlanCard(ctx, job.cardMessageId) : await latestOpenPlan(ctx.db, job.channelId);
  if (!target || !target.gameId) {
    if (room.kind === 'game') await postText(ctx, job.channelId, 'pixel', 'This plan is approved, so changes go to Forge once v1 is built. Hang tight!');
    else await postText(ctx, job.channelId, 'pixel', CANNED.noPlanToChange);
    return;
  }
  const prev = target.state as PlanCardState;
  if (prev.status === 'approved' || prev.status === 'superseded') {
    await postText(
      ctx,
      job.channelId,
      'pixel',
      prev.status === 'approved' ? 'That plan is already approved. Changes go to Forge once v1 is built.' : 'That plan was already replaced by a newer one.',
    );
    return;
  }
  const user = await getUser(ctx.db, job.fromUserId);
  if (!user) return;
  const language = detectLanguage(job.text, user.language);
  const chat = await recentChat(ctx.db, target.channelId, 30);
  await ctx.agents.states.set(target.channelId, 'pixel', 'thinking', { detail: 'reading the change', gameId: target.gameId });
  const prompt = reviseRequest({ requester: user.displayName, change: job.text, plan: prev.content, language, chat, memory: memoryOf(room.crew) });
  const { out, usage } = await generatePlan(
    ctx,
    target.channelId,
    {
      purpose: 'pixel.revise',
      user: prompt,
      hint: { pitch: prev.content.pitch, language, pitcher: user.displayName, previous: prev.content, change: job.text },
    },
    target.gameId,
  );
  await chargeUsage(ctx, user.id, usage);
  const game = await getGame(ctx.db, target.gameId);
  const credits = [...new Set([...prev.content.credits, user.displayName])];
  const version = prev.content.version + 1;
  const { card, spec } = normalizePlan(out, {
    gameId: target.gameId,
    planVersion: version,
    slug: game?.slug ?? prev.content.slug,
    language: prev.content.language,
    credits,
    remixOf: undefined,
  });
  const content: PlanCardContent = { ...card, ...(prev.content.remixOf && { remixOf: prev.content.remixOf }) };
  const state: PlanCardState = {
    ...prev,
    status: 'pending',
    voters: {},
    content,
    spec: { ...spec, remixOf: prev.spec.remixOf },
    memoryNote: out.memoryNote.trim() || prev.memoryNote,
    changeRequests: 0,
    requestedBy: prev.requestedBy,
  };
  delete state.supersededBy;
  const messageId = await postCard(ctx, {
    channelId: target.channelId,
    agent: 'pixel',
    kind: 'plan',
    content,
    metadata: planMetadata(state),
    gameId: target.gameId,
    version,
    state,
  });
  // The old card points at the new one and stops taking votes.
  const old = await updateCardState<PlanCardState>(ctx.db, target.nexconnMessageId, s => ({ ...s, status: 'superseded', supersededBy: messageId }));
  if (old)
    await updateCard(ctx, { messageId: target.nexconnMessageId, channelId: target.channelId, operatorId: 'agentpixel', metadata: planMetadata(old.state) });
  if (game) await updateGame(ctx.db, game.id, { title: content.title, pitch: content.pitch });
  await record(ctx, {
    action: 'plan.revised',
    actor: { type: 'agent', agent: 'pixel' },
    crewId: room.crew.id,
    gameId: target.gameId,
    summary: `Pixel revised ${content.title} to plan v${version}`,
    input: { change: job.text, requestedBy: user.displayName, previousVersion: prev.content.version, previousMessageId: target.nexconnMessageId },
    output: { intro: out.intro, plan: content, messageId },
    metrics: metrics(usage),
  });
  await ctx.agents.states.set(target.channelId, 'pixel', 'waiting_approval', { detail: content.title, gameId: target.gameId });
}

async function getPlanCard(ctx: Ctx, messageId: string): Promise<CardRow | null> {
  const c = await getCard(ctx.db, messageId);
  return c && c.cardType === 'plan' ? c : null;
}

export async function runRemix(ctx: AgentCtx, job: AgentJobData, room: Room): Promise<void> {
  const r = job.remix;
  if (!r) return;
  const src = await findGameForRemix(ctx.db, room.crew.id, r.source);
  if (!src) {
    await postText(ctx, job.channelId, 'pixel', CANNED.remixNotFound(r.source));
    return;
  }
  const planCard = await latestPlanForGame(ctx.db, src.id);
  const plan = planCard ? (planCard.state as PlanCardState).content : null;
  await runPlan(ctx, job, room, { source: { id: src.id, title: src.title, slug: src.slug }, plan, idea: r.idea });
}

/** At most 8 lines reach the chat, however long the model's answer is. */
export async function* limitLines(chunks: AsyncIterable<string>, maxLines = 8): AsyncIterable<string> {
  let lines = 1;
  for await (const piece of chunks) {
    if (lines > maxLines) continue;
    let out = '';
    for (const ch of piece) {
      if (ch === '\n') {
        lines++;
        if (lines > maxLines) break;
      }
      out += ch;
    }
    if (out) yield out;
  }
}

export async function runExplain(ctx: AgentCtx, job: AgentJobData, room: Room): Promise<void> {
  const card = room.game ? await latestPlanForGame(ctx.db, room.game.id) : await latestOpenPlan(ctx.db, job.channelId);
  if (!card) {
    await postText(ctx, job.channelId, 'pixel', CANNED.noPlanToExplain);
    return;
  }
  const plan = (card.state as PlanCardState).content;
  const user: UserRow | null = await getUser(ctx.db, job.fromUserId);
  const language: PitchLanguage = detectLanguage(job.text, user?.language ?? 'en');
  await ctx.agents.states.set(job.channelId, 'pixel', 'thinking', { detail: 'looking at the plan', ...(card.gameId && { gameId: card.gameId }) });
  const run = requireAi(ctx).streamText({
    purpose: 'pixel.explain',
    system: PIXEL_EXPLAIN_SYSTEM,
    user: explainRequest({ asker: user?.displayName ?? 'Someone', question: job.text, plan, language }),
    effort: 'low',
    maxTokens: 4000,
    hint: { question: job.text, plan, language },
  });
  const streamed = streamReply(ctx, job.channelId, 'pixel', limitLines(run.chunks, 8));
  const { usage } = await run.done.catch(async e => {
    await streamed.catch(() => null);
    throw e;
  });
  const s = await streamed;
  if (user) await chargeUsage(ctx, user.id, usage);
  await record(ctx, {
    action: 'agent.explained',
    actor: { type: 'agent', agent: 'pixel' },
    crewId: room.crew.id,
    gameId: card.gameId,
    summary: `Pixel explained: ${job.text.slice(0, 80)}`,
    input: { question: job.text, askedBy: user?.displayName, planVersion: plan.version },
    output: { answer: s.text },
    metrics: metrics(usage),
  });
  await ctx.agents.states.set(job.channelId, 'pixel', 'idle');
}
