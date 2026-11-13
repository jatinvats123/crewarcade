// Builds the agent services from config: the AI client (Claude, or the fake one with FAKE_AGENTS=1),
// the job queue (pg-boss, or in-memory when no job database is given) and the live agent states.
import type { AiClient } from '../ai/claude';
import { createClaudeClient } from '../ai/claude';
import { createFakeAiClient } from '../ai/fake';
import type { Config } from '../config';
import type { Ctx } from '../context';
import type { NexconnClient } from '../nexconn/client';
import { postAgentState } from '../services/chat';
import { createMemoryQueue, createPgBossQueue, type JobQueue, type QueueLog } from './queue';
import { handleAgentJob } from './runtime';
import type { AgentServices } from './runtime-deps';
import { createAgentStates } from './states';

export function createAi(
  config: Pick<Config, 'FAKE_AGENTS' | 'ANTHROPIC_API_KEY' | 'ANTHROPIC_MODEL' | 'AI_TIMEOUT_MS'>,
  log?: QueueLog & { debug(o: object, m: string): void },
): AiClient | null {
  if (config.FAKE_AGENTS) return createFakeAiClient();
  if (!config.ANTHROPIC_API_KEY) return null;
  return createClaudeClient({ apiKey: config.ANTHROPIC_API_KEY, model: config.ANTHROPIC_MODEL, timeoutMs: config.AI_TIMEOUT_MS, ...(log && { log }) });
}

export function createAgentServices(o: {
  config: Config;
  nexconn: NexconnClient | null;
  ai: AiClient | null;
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
  return { ai: o.ai, queue: o.queue, states };
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
}
