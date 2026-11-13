// Decision Ledger: one row per agent step, human decision and system action. Every flow calls
// record(); a ledger failure is logged and never breaks the flow it describes.
import { AGENTS, newId, type AgentKey } from '@crewarcade/shared';
import type { Ctx } from '../context';
import { insertLedger } from '../repo/games';

/** Actions use the `area.verb` format (CHECK constraint ledger_action_check); docs/SPEC.md §7. */
export const LEDGER_ACTIONS = [
  'plan.created',
  'plan.revised',
  'plan.vote',
  'plan.change_requested',
  'plan.approved',
  'plan.refused',
  'plan.failed',
  'room.created',
  'handoff',
  'build.queued',
  'agent.replied',
  'agent.explained',
  'crew.memory_updated',
] as const;
export type LedgerAction = (typeof LEDGER_ACTIONS)[number] | `${string}.${string}`;

export type Actor = { type: 'agent'; agent: AgentKey } | { type: 'human'; userId: string } | { type: 'system' };

export interface Metrics {
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  ms?: number;
}

export interface LedgerRecord {
  action: LedgerAction;
  actor: Actor;
  crewId: string | null;
  gameId?: string | null;
  summary: string;
  input?: unknown;
  output?: unknown;
  reason?: string;
  metrics?: Metrics;
}

const actorId = (a: Actor) => (a.type === 'agent' ? AGENTS[a.agent].id : a.type === 'human' ? a.userId : 'system');

/** Caps stored JSON so one runaway output cannot bloat the table (display redacts further). */
function capJson(value: unknown): unknown {
  if (value === undefined) return null;
  const json = JSON.stringify(value);
  if (json === undefined) return null;
  return json.length <= 20_000 ? value : { truncated: true, preview: json.slice(0, 20_000) };
}

export async function record(ctx: Pick<Ctx, 'db' | 'log' | 'now'>, r: LedgerRecord): Promise<void> {
  try {
    await insertLedger(ctx.db, {
      id: newId('ledger'),
      gameId: r.gameId ?? null,
      crewId: r.crewId,
      actorType: r.actor.type,
      actorId: actorId(r.actor),
      action: r.action,
      summary: r.summary.slice(0, 300),
      input: capJson(r.input),
      output: capJson(r.output),
      reason: r.reason?.slice(0, 500) ?? null,
      tokensIn: r.metrics?.tokensIn ?? 0,
      tokensOut: r.metrics?.tokensOut ?? 0,
      costUsd: r.metrics?.costUsd ?? 0,
      ms: r.metrics?.ms === undefined ? null : Math.round(r.metrics.ms),
      createdAt: new Date(ctx.now()),
    });
  } catch (err) {
    ctx.log.error({ err, action: r.action, gameId: r.gameId }, 'ledger write failed');
  }
}
