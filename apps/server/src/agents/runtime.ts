// Agent runtime: webhook message -> router -> queued job -> the agent step, with live states, a
// friendly in-chat message on every failure, and a ledger row either way.
import { AGENTS, dbUserIdFromNexconn, isAgentId, parseTextContent, BUILTIN_MESSAGE_TYPES, LIMITS, type AgentKey } from '@crewarcade/shared';
import { AiError, AiRefusalError, type AiUsage } from '../ai/claude';
import { downloadVoice, SttError, voiceFallbackText, VoiceContent, type SpeechToText } from '../ai/sarvam';
import type { Ctx } from '../context';
import { countMembers } from '../repo/crews';
import { latestPlanForGame } from '../repo/games';
import { getUser } from '../repo/users';
import { reportBug } from '../services/bugs';
import { CrewRuleError } from '../services/crews';
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
  /** Reported by the browser (POST /api/chat/relay) rather than the signed webhook. */
  relayed?: boolean;
}

const VOICE_TYPES = new Set<string>([BUILTIN_MESSAGE_TYPES.hdVoice, 'RC:VcMsg']);

/** The agent a Nexconn user id belongs to, if any. */
function agentOf(nexconnId: string): AgentKey | null {
  const id = dbUserIdFromNexconn(nexconnId);
  return (Object.keys(AGENTS) as AgentKey[]).find(k => AGENTS[k].id === id) ?? null;
}

/** Routes one incoming message; enqueues a job when it is work for an agent. Returns the job key or null. */
export async function routeIncoming(ctx: AgentCtx, m: IncomingMessage): Promise<string | null> {
  const fromUserId = dbUserIdFromNexconn(m.userId);
  // Agents never trigger agents (no loops).
  if (isAgentId(fromUserId)) return null;
  if (VOICE_TYPES.has(m.messageType)) return routeVoice(ctx, m, fromUserId);
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

/**
 * A voice note becomes an agent job that transcribes first, then routes like text. Only notes
 * addressed to an agent (a mention), or any note in a solo crew, are transcribed (Sarvam bills per second).
 */
async function routeVoice(ctx: AgentCtx, m: IncomingMessage, fromUserId: string): Promise<string | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(m.content);
  } catch {
    return null;
  }
  const v = VoiceContent.safeParse(raw);
  if (!v.success) return null;
  if (m.relayed && ctx.config.NEXCONN_MEDIA_HOSTS.length === 0) return null;
  const room = await resolveRoom(ctx, m.channelId);
  if (!room) return null;
  const mentioned = v.data.mentionedInfo?.userIdList ?? [];
  const agent = mentioned.map(agentOf).find((a): a is AgentKey => !!a) ?? null;
  const humans = (await countMembers(ctx.db, room.crew.id)) - Object.keys(AGENTS).length;
  if (!agent && humans > 1) return null;
  const job: AgentJobData = {
    key: `msg:${m.messageId}`,
    crewId: room.crew.id,
    channelId: m.channelId,
    messageId: m.messageId,
    fromUserId,
    agent: agent ?? 'pixel',
    intent: 'chat',
    text: '',
    attachments: [{ kind: 'voice', url: v.data.remoteUrl }],
    voice: { url: v.data.remoteUrl, durationS: v.data.duration, relayed: !!m.relayed, mentionedUserIds: mentioned },
  };
  const fresh = await ctx.agents.queue.enqueueAgent(job);
  ctx.log.info({ key: job.key, agent: job.agent, fresh }, 'voice job enqueued');
  return fresh ? job.key : null;
}

/**
 * Voice note -> transcript (pure apart from the injected download and STT; tested). Every failure
 * is a reason the caller turns into a friendly "type it instead" line.
 */
export async function voiceToText(
  voice: { url: string; durationS: number; relayed: boolean },
  deps: { stt: SpeechToText | undefined; download: typeof downloadVoice; allowedHosts: readonly string[] },
): Promise<{ ok: true; text: string; ms: number; language: string | null } | { ok: false; reason: SttError['reason'] | 'error'; detail: string }> {
  if (voice.durationS > LIMITS.voiceSeconds) return { ok: false, reason: 'too_long', detail: `${voice.durationS} s` };
  if (!deps.stt) return { ok: false, reason: 'not_configured', detail: 'SARVAM_API_KEY is not set' };
  try {
    const audio = await deps.download(voice.url, { allowedHosts: voice.relayed ? deps.allowedHosts : null });
    const r = await deps.stt.transcribe(audio);
    return { ok: true, text: r.text.slice(0, 4000), ms: r.ms, language: r.language };
  } catch (e) {
    return { ok: false, reason: e instanceof SttError ? e.reason : 'error', detail: (e as Error).message.slice(0, 200) };
  }
}

/** Transcribes a voice job and routes the transcript; null = nothing more to do (fallback posted or not for an agent). */
async function transcribeJob(ctx: AgentCtx, job: AgentJobData, room: Room): Promise<AgentJobData | null> {
  const voice = job.voice!;
  await ctx.agents.states.set(job.channelId, job.agent, 'thinking', { detail: 'listening to a voice note' });
  const r = await voiceToText(voice, { stt: ctx.agents.stt, download: downloadVoice, allowedHosts: ctx.config.NEXCONN_MEDIA_HOSTS });
  if (!r.ok) {
    ctx.log.warn({ key: job.key, reason: r.reason, detail: r.detail }, 'voice transcription failed');
    const hindi = (await getUser(ctx.db, job.fromUserId))?.language === 'hi';
    await postText(ctx, job.channelId, job.agent, voiceFallbackText(r.reason, hindi)).catch(() => {});
    await record(ctx, {
      action: 'voice.failed',
      actor: { type: 'agent', agent: job.agent },
      crewId: room.crew.id,
      gameId: room.game?.id ?? null,
      summary: `Could not transcribe a voice note (${r.reason})`,
      reason: r.detail,
    });
    await ctx.agents.states.set(job.channelId, job.agent, 'idle');
    return null;
  }
  await record(ctx, {
    action: 'voice.transcribed',
    actor: { type: 'system' },
    crewId: room.crew.id,
    gameId: room.game?.id ?? null,
    summary: `Voice note (${Math.round(voice.durationS)} s${r.language ? `, ${r.language}` : ''}) transcribed in ${Math.round(r.ms / 100) / 10} s`,
    output: { text: r.text },
    metrics: { ms: r.ms },
  });
  const humans = (await countMembers(ctx.db, room.crew.id)) - Object.keys(AGENTS).length;
  const intent = routeMessage({ text: r.text, mentionedUserIds: voice.mentionedUserIds, roomKind: room.kind, humanCount: humans });
  await ctx.agents.states.set(job.channelId, job.agent, 'idle');
  if (!intent) return null;
  const { voice: _v, ...rest } = job;
  return { ...rest, agent: intent.agent, intent: intent.kind, text: intent.text.slice(0, 4000), ...(intent.remix && { remix: intent.remix }) };
}

/** `bug: …` in chat: a real report in a game room (Glitch reproduces it); elsewhere, a pointer to the room. */
async function runBugReport(ctx: AgentCtx, job: AgentJobData, room: Room): Promise<void> {
  if (room.kind !== 'game') {
    await postText(ctx, job.channelId, 'glitch', CANNED.glitchBug);
    return;
  }
  const user = await getUser(ctx.db, job.fromUserId);
  if (!user) return;
  try {
    await reportBug(ctx, user, room.game.id, { description: job.text.slice(0, LIMITS.bugChars) }, 'chat');
  } catch (e) {
    if (!(e instanceof CrewRuleError)) throw e;
    await postText(ctx, job.channelId, 'glitch', e.code === 'nothing_built' ? CANNED.glitchNoBuild : e.message);
  }
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
export async function handleAgentJob(ctx: AgentCtx, input: AgentJobData): Promise<void> {
  const room = await resolveRoom(ctx, input.channelId);
  if (!room) return;
  const t0 = performance.now();
  let job = input;
  try {
    if (job.voice) {
      const routed = await transcribeJob(ctx, job, room);
      if (!routed) return;
      job = routed;
    }
    if (job.intent === 'bug') {
      await runBugReport(ctx, job, room);
      return;
    }
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
