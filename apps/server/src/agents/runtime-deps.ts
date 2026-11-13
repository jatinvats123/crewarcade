// What the agent runtime needs besides the request context: the AI client (real or fake), the job
// queue and the live agent states. Kept apart from runtime.ts so agents and services can share it
// without import cycles.
import { AiNotConfiguredError, type AiClient, type AiUsage } from '../ai/claude';
import type { Ctx } from '../context';
import { addUsageCost, dayOf, totalCostOn } from '../repo/games';
import type { JobQueue } from './queue';
import type { AgentStates } from './states';

export interface AgentServices {
  /** null when neither ANTHROPIC_API_KEY nor FAKE_AGENTS is set. */
  ai: AiClient | null;
  queue: JobQueue;
  states: AgentStates;
}

export function requireAi(ctx: { agents: AgentServices }): AiClient {
  if (!ctx.agents.ai) throw new AiNotConfiguredError();
  return ctx.agents.ai;
}

export class BudgetExceededError extends Error {
  constructor(readonly spentUsd: number) {
    super(`daily AI budget reached ($${spentUsd.toFixed(2)})`);
  }
}

/** Global daily spend guard (DAILY_BUDGET_USD). Checked before every AI call. */
export async function checkBudget(ctx: Pick<Ctx, 'db' | 'config' | 'now'>): Promise<void> {
  const spent = await totalCostOn(ctx.db, dayOf(ctx.now()));
  if (spent >= ctx.config.DAILY_BUDGET_USD) throw new BudgetExceededError(spent);
}

/** Adds a call's cost to the user's daily usage row. */
export async function chargeUsage(ctx: Pick<Ctx, 'db' | 'now' | 'log'>, userId: string, usage: AiUsage): Promise<void> {
  if (usage.costUsd <= 0) return;
  await addUsageCost(ctx.db, dayOf(ctx.now()), userId, usage.costUsd).catch(err => ctx.log.warn({ err }, 'usage write failed'));
}
