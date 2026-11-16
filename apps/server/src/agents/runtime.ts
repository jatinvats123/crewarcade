// Agent runtime: webhook message -> router -> queued job -> the agent step, with live states, a
// friendly in-chat message on every failure, and a ledger row either way.
import { AGENTS, dbUserIdFromNexconn, isAgentId, parseTextContent, BUILTIN_MESSAGE_TYPES } from '@crewarcade/shared';
import { AiError, AiRefusalError, type AiUsage } from '../ai/claude';
import type { Ctx } from '../context';
import { countMembers } from '../repo/crews';
import { latestPlanForGame } from '../repo/games';
import { postText } from '../services/chat';
import { record } from '../services/ledger';
import { resolveRoom, type Room } from '../services/rooms';
import { hasBuild, runBuildChange } from './forge-runtime';
import { runExplain, runPlan, runRemix, runRevise } from './pixel';
import { detectLanguage } from './plan';
import { CANNED } from './prompts';
import type { AgentJobData } from './queue';
import { routeMessage } from './router';
import { BudgetExceededError, checkBudget, type AgentServices } from './runtime-deps';

export type { AgentServices } from './runtime-deps';

type AgentCtx = Ctx & { agents: AgentServices };

/** A text message seen on the message:send webhook. */
export interface IncomingMessage {
  messageId: string;
  channelId: string;
  /** Nexconn sender id. */
  userId: string;
  messageType: string;
  content: string;
}

/** Routes one incoming message; enqueues a job when it is work for an agent. Returns the job key or null. */
export async function routeIncoming(ctx: AgentCtx, m: IncomingMessage): Promise<string | null> {
  const fromUserId = dbUserIdFromNexconn(m.userId);
  // Agents never trigger agents (no loops).
  if (isAgentId(fromUserId)) return null;
  if (m.messageType !== BUILTIN_MESSAGE_TYPES.text) return null;
  const parsed = parseTextContent(m.content);
  if (!parsed?.text.trim()) return null;
  const room = await resolveRoom(ctx, m.channelId);
  if (!room) return null;
  const humans = (await countMembers(ctx.db, room.crew.id)) - Object.keys(AGENTS).length;
  const intent = routeMessage({ text: parsed.text, mentionedUserIds: parsed.mentionedUserIds, roomKind: room.kind, humanCount: humans });
  if (!intent) return null;
  const job: AgentJobData = {
    key: `msg:${m.messageId}`,
    crewId: room.crew.id,
    channelId: m.channelId,
    messageId: m.messageId,
    fromUserId,
    agent: intent.agent,
    intent: intent.kind,
    text: intent.text.slice(0, 4000),
    attachments: [],
    ...(intent.remix && { remix: intent.remix }),
  };
  const fresh = await ctx.agents.queue.enqueueAgent(job);
  ctx.log.info({ key: job.key, agent: job.agent, intent: job.intent, fresh }, 'agent job enqueued');
  return fresh ? job.key : null;
}

/** Canned replies for chat lines and for Forge/Glitch, whose real work starts in later phases. */
async function reply(ctx: AgentCtx, job: AgentJobData, room: Room): Promise<void> {
  let text: string;
  if (job.agent === 'pixel') {
    text = CANNED.pixelChat[detectLanguage(job.text).code === 'hi' ? 'hi' : 'en'];
  } else if (job.agent === 'forge') {
    const plan = room.game ? await latestPlanForGame(ctx.db, room.game.id) : null;
    text = plan ? CANNED.forgeQueued : CANNED.forgeNoPlan;
  } else text = job.intent === 'bug' ? CANNED.glitchBug : CANNED.glitchNoBuild;
  await postText(ctx, job.channelId, job.agent, text);
  await record(ctx, {
    action: 'agent.replied',
    actor: { type: 'agent', agent: job.agent },
    crewId: room.crew.id,
    gameId: room.game?.id ?? null,
    summary: `${AGENTS[job.agent].displayName.split(' ')[0]} replied (${job.intent})`,
    input: { text: job.text, intent: job.intent },
    output: { text },
  });
}

/** Runs one agent job. Never throws: failures become a friendly message, an idle state and a ledger row. */
export async function handleAgentJob(ctx: AgentCtx, job: AgentJobData): Promise<void> {
  const room = await resolveRoom(ctx, job.channelId);
  if (!room) return;
  const t0 = performance.now();
  try {
    // In a game room with a build, "make it faster" (to Pixel or Forge, or the Build card's Change)
    // becomes the next version: a short Pixel spec delta, then a Forge build.
    if (job.intent === 'change' && job.agent !== 'glitch' && room.kind === 'game' && (await hasBuild(ctx, room.game.id))) {
      await runBuildChange(ctx, job, room);
      return;
    }
    const usesAi = job.agent === 'pixel' && job.intent !== 'chat';
    if (usesAi) await checkBudget(ctx);
    if (job.agent !== 'pixel' || job.intent === 'chat') await reply(ctx, job, room);
    else if (job.intent === 'plan') await runPlan(ctx, job, room);
    else if (job.intent === 'change') await runRevise(ctx, job, room);
    else if (job.intent === 'remix') await runRemix(ctx, job, room);
    else if (job.intent === 'explain') await runExplain(ctx, job, room);
  } catch (e) {
    const usage = (e as { usage?: AiUsage }).usage;
    const refused = e instanceof AiRefusalError;
    const text = refused ? CANNED.refusal : e instanceof BudgetExceededError ? CANNED.budget : CANNED.failed;
    ctx.log[refused ? 'info' : 'error']({ err: e, key: job.key }, refused ? 'agent: refusal' : 'agent job failed');
    await postText(ctx, job.channelId, job.agent, text).catch(err => ctx.log.error({ err }, 'could not post the failure message'));
    await record(ctx, {
      action: refused ? 'plan.refused' : 'plan.failed',
      actor: { type: 'agent', agent: job.agent },
      crewId: room.crew.id,
      gameId: room.game?.id ?? null,
      summary: refused
        ? `${AGENTS[job.agent].displayName.split(' ')[0]} declined a request`
        : `${AGENTS[job.agent].displayName.split(' ')[0]} could not finish (${job.intent})`,
      input: { text: job.text, intent: job.intent },
      reason: refused
        ? `refusal${(e as AiRefusalError).category ? `: ${(e as AiRefusalError).category}` : ''}`
        : e instanceof AiError || e instanceof BudgetExceededError
          ? e.message
          : 'internal error',
      metrics: usage ? { tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, costUsd: usage.costUsd, ms: usage.ms } : { ms: performance.now() - t0 },
    });
    await ctx.agents.states.set(job.channelId, job.agent, 'idle');
  }
}
