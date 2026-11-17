// Builds the agent services from config: the AI client (Claude, or the fake one with FAKE_AGENTS=1),
// the job queue (pg-boss, or in-memory when no job database is given) and the live agent states.
import type { AiClient } from '../ai/claude';
import { createClaudeClient } from '../ai/claude';
import { createFakeAiClient } from '../ai/fake';
import { createGeminiClient } from '../ai/gemini';
import type { Config } from '../config';
import type { Ctx } from '../context';
import type { NexconnClient } from '../nexconn/client';
import { postAgentState } from '../services/chat';
import { createMemoryQueue, createPgBossQueue, type JobQueue, type QueueLog } from './queue';
import { runBuildJob } from './forge-runtime';
import { handleAgentJob } from './runtime';
import type { AgentServices } from './runtime-deps';
import { createAgentStates } from './states';
import type { SpeechToText } from '../ai/sarvam';
import type { Playtester } from './smoke';
import { runGlitchJob } from './bugs';

type AiConfig = Pick<
  Config,
  | 'FAKE_AGENTS'
  | 'ANTHROPIC_API_KEY'
  | 'ANTHROPIC_MODEL'
  | 'ANTHROPIC_BUILD_MODEL'
  | 'AI_TIMEOUT_MS'
  | 'BUILD_TIMEOUT_MS'
  | 'AI_PROVIDER'
  | 'GEMINI_API_KEY'
  | 'GEMINI_MODEL'
  | 'GEMINI_BUILD_MODEL'
>;

/**
 * The AI client for one role. 'chat': Pixel's plans, explanations and replies (Gemini: the cheap
 * flash-lite model). 'build': Forge writing whole games (a stronger model). AI_PROVIDER switches both.
 */
export function createAi(config: AiConfig, log?: QueueLog & { debug(o: object, m: string): void }, role: 'chat' | 'build' = 'chat'): AiClient | null {
  if (config.FAKE_AGENTS) return createFakeAiClient();
  const build = role === 'build';
  const timeoutMs = build ? config.BUILD_TIMEOUT_MS : config.AI_TIMEOUT_MS;
  if (config.AI_PROVIDER === 'gemini')
    return config.GEMINI_API_KEY
      ? createGeminiClient({ apiKey: config.GEMINI_API_KEY, model: build ? config.GEMINI_BUILD_MODEL : config.GEMINI_MODEL, timeoutMs, ...(log && { log }) })
      : null;
  if (!config.ANTHROPIC_API_KEY) return null;
  return createClaudeClient({
    apiKey: config.ANTHROPIC_API_KEY,
    model: build ? config.ANTHROPIC_BUILD_MODEL : config.ANTHROPIC_MODEL,
    timeoutMs,
    ...(log && { log }),
  });
}

export function createAgentServices(o: {
  config: Config;
  nexconn: NexconnClient | null;
  ai: AiClient | null;
  /** Forge's client (a stronger model); defaults to `ai`. */
  buildAi?: AiClient | null;
  smoke?: (html: string) => Promise<string[]>;
  playtester?: Playtester;
  stt?: SpeechToText;
  queue: JobQueue;
  /** Late-bound context for sending states (the app builds it after this). */
  ctxRef: { current: Ctx | null };
  log: QueueLog;
}): AgentServices {
  const states = createAgentStates({
    send: async (channelId, s) => {
      const ctx = o.ctxRef.current;
      if (ctx?.nexconn) await postAgentState(ctx, channelId, s);
    },
    now: Date.now,
    onError: err => o.log.warn({ err }, 'agent state send failed'),
  });
  return {
    ai: o.ai,
    buildAi: o.buildAi === undefined ? o.ai : o.buildAi,
    ...(o.smoke && { smoke: o.smoke }),
    ...(o.playtester && { playtester: o.playtester }),
    ...(o.stt && { stt: o.stt }),
    queue: o.queue,
    states,
  };
}

export function createQueue(
  config: Pick<Config, 'JOBS_DATABASE_URL' | 'DATABASE_URL' | 'AGENT_CONCURRENCY' | 'NODE_ENV'>,
  log: QueueLog,
  useMemory = false,
): JobQueue {
  if (useMemory) return createMemoryQueue({ concurrency: config.AGENT_CONCURRENCY, log });
  return createPgBossQueue(config.JOBS_DATABASE_URL ?? config.DATABASE_URL, { concurrency: config.AGENT_CONCURRENCY, log });
}

/** Starts processing agent jobs in this process. */
export async function startAgentWorker(ctx: Ctx): Promise<void> {
  const agents = ctx.agents;
  if (!agents) return;
  await agents.queue.start(job => handleAgentJob({ ...ctx, agents }, job));
  await agents.queue.startBuilds(job => runBuildJob({ ...ctx, agents }, job));
  // Always consumed: without a playtester (PLAYTESTS=false) Glitch says testing is off instead of jobs waiting forever.
  await agents.queue.startPlaytests(job => runGlitchJob({ ...ctx, agents }, job));
}
