// Forge's jobs, with everything around the pure build loop (forge.ts): the Build card and its live
// progress lines, agent states, storage, the game_versions row, ledger rows, the handoff to Glitch,
// failures with [Try again], and change requests (a short Pixel spec delta, then a new version).
import { acceptanceFor, gameRegion, GameSpecSchema, starterHtml, type AcceptanceItem, type GameSpec, type SpecChange } from '@crewarcade/engine';
import { AGENTS, newId, nexconnUserId, type BuildStep } from '@crewarcade/shared';
import { z } from 'zod';
import { AiError, AiRefusalError, type AiUsage } from '../ai/claude';
import type { Ctx } from '../context';
import { getGame, insertVersion, updateCardState, updateGame, type GameRow } from '../repo/games';
import { getUser } from '../repo/users';
import { getVersion, latestBuiltVersion, maxVersion, updateVersion } from '../repo/versions';
import { postCard, postText, updateCard } from '../services/chat';
import { record } from '../services/ledger';
import type { Room } from '../services/rooms';
import { gameHtmlKey } from '../storage';
import { BuildCheckFailedError, runBuildLoop, type BuildPhase } from './forge';
import { SAFETY_RULES } from './prompts';
import type { AgentJobData, BuildJobData } from './queue';
import { BudgetExceededError, chargeUsage, checkBudget, requireAi, requireBuildAi, type AgentServices } from './runtime-deps';

type AgentCtx = Ctx & { agents: AgentServices };

/** What the server keeps for a Build card (cards.state); metadata is always derived from it. */
export interface BuildCardState extends Record<string, unknown> {
  kind: 'build';
  status: 'building' | 'ready' | 'failed';
  steps: BuildStep[];
  /** The handoff this build answers ([Try again] reuses it). */
  handoffMessageId?: string;
  sizeKb?: number;
  buildMs?: number;
  attempts?: number;
  notes?: string[];
  checkPass?: boolean;
  problems?: string[];
  error?: string;
}

export function buildMetadata(s: BuildCardState): Record<string, unknown> {
  return {
    status: s.status,
    steps: s.steps,
    sizeKb: s.sizeKb,
    buildMs: s.buildMs,
    attempts: s.attempts,
    notes: s.notes,
    checkPass: s.checkPass === undefined ? undefined : String(s.checkPass),
    problems: s.problems && s.problems.length > 0 ? s.problems.map(p => p.slice(0, 300)).slice(0, 10) : undefined,
    error: s.error,
  };
}

const forgeOperator = nexconnUserId(AGENTS.forge.id);
const roundKb = (bytes: number) => Math.round((bytes / 1024) * 10) / 10;

/** Progress lines: pure helpers so the order and wording are tested. */
export const Steps = {
  initial(version: number): BuildStep[] {
    return [
      { t: 'Reading the plan', s: 'doing' },
      { t: 'Writing the game', s: 'todo' },
      { t: 'Running checks', s: 'todo' },
      { t: `Saving v${version}`, s: 'todo' },
    ];
  },
  /** Replaces the generic "Writing the game" line with Forge's own outline. */
  outline(steps: BuildStep[], lines: string[]): BuildStep[] {
    const head = steps.filter(s => s.t === 'Reading the plan').map(s => ({ ...s, s: 'done' as const }));
    const tail = steps.filter(s => s.t === 'Running checks' || s.t.startsWith('Fixing') || s.t.startsWith('Saving'));
    return [...head, ...lines.map((t, i) => ({ t, s: i === lines.length - 1 ? ('doing' as const) : ('done' as const) })), ...tail];
  },
  set(steps: BuildStep[], match: (t: string) => boolean, s: BuildStep['s']): BuildStep[] {
    return steps.map(x => (match(x.t) ? { ...x, s } : x));
  },
  writtenAll(steps: BuildStep[]): BuildStep[] {
    return steps.map(x => (x.t === 'Running checks' || x.t.startsWith('Fixing') || x.t.startsWith('Saving') ? x : { ...x, s: 'done' as const }));
  },
  fixing(steps: BuildStep[], problems: number): BuildStep[] {
    const label = `Fixing ${problems} problem${problems === 1 ? '' : 's'}`;
    const without = steps.filter(s => !s.t.startsWith('Fixing'));
    const i = without.findIndex(s => s.t === 'Running checks');
    const next = [...without.slice(0, i + 1), { t: label, s: 'doing' as const }, ...without.slice(i + 1)];
    return Steps.set(next, t => t === 'Running checks', 'todo');
  },
};

const progressOf = (steps: BuildStep[]) => ({ done: steps.filter(s => s.s === 'done').length, total: Math.max(1, steps.length) });

/** The GAME region and HTML a version starts from: the previous build, the remixed game, or the starter. */
async function baseFor(ctx: AgentCtx, game: GameRow, version: number): Promise<{ html: string; previousCode?: string; remixOfTitle?: string }> {
  if (version > 1) {
    const prev = await latestBuiltVersion(ctx.db, game.id, version - 1);
    const html = prev ? await ctx.storage.get(gameHtmlKey(game.slug, prev.version)) : null;
    if (html) return { html: html.toString('utf8'), previousCode: gameRegion(html.toString('utf8')) };
  } else if (game.remixOfGameId) {
    const src = await getGame(ctx.db, game.remixOfGameId);
    const v = src?.publishedVersion ?? null;
    const html = src && v ? await ctx.storage.get(gameHtmlKey(src.slug, v)) : null;
    if (src && html) return { html: html.toString('utf8'), previousCode: gameRegion(html.toString('utf8')), remixOfTitle: src.title };
    if (src) ctx.log.warn({ gameId: game.id, source: src.id }, 'remix source has no published build; starting from the starter');
  }
  return { html: starterHtml() };
}

const FAIL_TEXT = {
  check: (v: number, n: number) =>
    `I couldn't get v${v} past the checks after ${n} tries. The problems are on the build card; tap **Try again** and I'll take another run at it.`,
  refusal: (v: number) => `I can't build v${v} from that request. Try a different change?`,
  budget: "We've used today's AI budget, so builds pause until tomorrow (or ask the crew owner).",
  other: (v: number) => `Something went wrong while building v${v}. Tap **Try again** on the build card.`,
};

/** Runs one build job. Never throws: failures become a failed card, a friendly line and a ledger row. */
export async function runBuildJob(ctx: AgentCtx, job: BuildJobData): Promise<void> {
  const game = await getGame(ctx.db, job.gameId);
  const row = game ? await getVersion(ctx.db, game.id, job.version) : null;
  if (!game || !row || !game.roomChannelId) return ctx.log.warn({ job }, 'build: game or version not found');
  if (row.htmlPath && row.status !== 'check_failed' && row.status !== 'failed') return ctx.log.info({ job }, 'build: version already built');
  const channelId = game.roomChannelId;
  const spec: GameSpec = GameSpecSchema.parse(row.spec);
  const change = spec.changes.find(c => c.version === job.version);
  const t0 = ctx.now();

  await updateVersion(ctx.db, game.id, job.version, { status: 'building' });
  await updateGame(ctx.db, game.id, { status: 'building' });
  await updateCard(ctx, { messageId: job.handoffMessageId, channelId, operatorId: forgeOperator, metadata: { status: 'started' } }).catch(err =>
    ctx.log.warn({ err }, 'handoff update failed'),
  );

  let state: BuildCardState = { kind: 'build', status: 'building', steps: Steps.initial(job.version), handoffMessageId: job.handoffMessageId };
  const cardId = await postCard(ctx, {
    channelId,
    agent: 'forge',
    kind: 'build',
    content: {
      v: 1,
      gameId: game.id,
      slug: game.slug,
      title: game.title.slice(0, 60),
      version: job.version,
      reason: job.reason,
      ...(change && { change: change.summary.slice(0, 300) }),
    },
    metadata: buildMetadata(state),
    gameId: game.id,
    version: job.version,
    state,
  });
  await record(ctx, {
    action: 'build.started',
    actor: { type: 'agent', agent: 'forge' },
    crewId: game.crewId,
    gameId: game.id,
    summary: `Forge started building v${job.version}${job.reason === 'build' ? '' : ` (${job.reason})`}`,
    input: { version: job.version, reason: job.reason, change: change?.summary ?? null },
    output: { buildCardMessageId: cardId },
  });

  // Live progress: card metadata (throttled; the last update always goes out) + the agent strip.
  let lastSent = 0;
  const push = async (agentState: 'building' | 'checking' | 'fixing', force = false) => {
    await ctx.agents.states.set(channelId, 'forge', agentState, { detail: `v${job.version}`, gameId: game.id, progress: progressOf(state.steps) });
    if (!force && ctx.now() - lastSent < 700) return;
    lastSent = ctx.now();
    await updateCard(ctx, { messageId: cardId, channelId, operatorId: forgeOperator, metadata: buildMetadata(state) }).catch(err =>
      ctx.log.warn({ err }, 'build progress update failed'),
    );
  };
  await push('building', true);

  const onPhase = async (p: BuildPhase) => {
    if (p.kind === 'outline') {
      state = { ...state, steps: Steps.outline(state.steps, p.lines) };
      await push('building');
    } else if (p.kind === 'written') {
      state = { ...state, steps: Steps.writtenAll(state.steps) };
    } else if (p.kind === 'checking') {
      state = { ...state, steps: Steps.set(state.steps, t => t === 'Running checks', 'doing') };
      await push('checking', true);
    } else {
      state = { ...state, steps: Steps.fixing(state.steps, p.problems.length) };
      await record(ctx, {
        action: 'build.check_failed',
        actor: { type: 'agent', agent: 'forge' },
        crewId: game.crewId,
        gameId: game.id,
        summary: `v${job.version} attempt ${p.attempt}: ${p.problems.length} static-check problem${p.problems.length === 1 ? '' : 's'}; Forge retries`,
        output: { problems: p.problems.slice(0, 10) },
      });
      await push('fixing', true);
    }
  };

  const ai = (() => {
    try {
      return requireBuildAi(ctx);
    } catch (e) {
      return e as Error;
    }
  })();
  try {
    if (ai instanceof Error) throw ai;
    await checkBudget(ctx);
    const base = await baseFor(ctx, game, job.version);
    const result = await runBuildLoop({
      ai,
      baseHtml: base.html,
      spec,
      version: job.version,
      language: game.language,
      ...(base.previousCode && { previousCode: base.previousCode }),
      ...(base.remixOfTitle && { remixOfTitle: base.remixOfTitle }),
      ...(change && { change: change.summary }),
      timeoutMs: ctx.config.BUILD_TIMEOUT_MS,
      ...(ctx.agents.smoke && { smoke: ctx.agents.smoke }),
      hint: { title: spec.title, pitch: spec.pitch, language: game.language, change: change?.summary, seed: hashCode(game.slug) },
      onPhase,
    });

    state = {
      ...state,
      steps: Steps.set(
        Steps.set(state.steps, t => t === 'Running checks' || t.startsWith('Fixing'), 'done'),
        t => t.startsWith('Saving'),
        'doing',
      ),
    };
    await push('checking');
    const htmlPath = await ctx.storage.put(gameHtmlKey(game.slug, job.version), result.html, 'text/html; charset=utf-8');
    const buildMs = Math.round(ctx.now() - t0);
    const usage = result.usage;
    const notes = result.output.notes
      .map(n => n.trim())
      .filter(Boolean)
      .slice(0, 6);
    await updateVersion(ctx.db, game.id, job.version, {
      htmlPath,
      sizeBytes: result.check.sizeBytes,
      checkResult: { pass: true, problems: [], attempts: result.attempts.map(a => ({ attempt: a.attempt, problems: a.problems })) },
      buildMs,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      costUsd: usage.costUsd,
      model: usage.model,
      status: 'testing',
      notes,
      meta: {
        // Keeps what the version was created with (e.g. Glitch's fix round), then the build's own details.
        ...row.meta,
        orientation: result.output.orientation,
        emoji: result.output.emoji,
        colors: result.output.colors,
        attempts: result.attempts.length,
        reason: row.meta.reason === 'fix' ? 'fix' : job.reason,
        ...(change && { change: change.summary }),
        ...(job.requestedBy && { requestedBy: job.requestedBy }),
      },
    });
    await updateGame(ctx.db, game.id, { status: 'testing' });
    state = {
      ...state,
      status: 'ready',
      steps: Steps.set(state.steps, () => true, 'done'),
      sizeKb: roundKb(result.check.sizeBytes),
      buildMs,
      attempts: result.attempts.length,
      notes,
      checkPass: true,
      problems: [],
    };
    await saveCardState(ctx, cardId, state);
    await updateCard(ctx, { messageId: cardId, channelId, operatorId: forgeOperator, metadata: buildMetadata(state) });
    await record(ctx, {
      action: 'build.ready',
      actor: { type: 'agent', agent: 'forge' },
      crewId: game.crewId,
      gameId: game.id,
      summary: `v${job.version} ready: ${roundKb(result.check.sizeBytes)} KB in ${Math.round(buildMs / 1000)} s, ${result.attempts.length} attempt${result.attempts.length === 1 ? '' : 's'} (${usage.model})`,
      output: { model: usage.model, sizeBytes: result.check.sizeBytes, attempts: result.attempts.length, notes, htmlPath },
      metrics: { tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, costUsd: usage.costUsd, ms: buildMs },
    });
    await chargeUsage(ctx, job.requestedBy ?? game.createdBy, usage);
    await updateCard(ctx, { messageId: job.handoffMessageId, channelId, operatorId: forgeOperator, metadata: { status: 'done' } }).catch(() => {});
    await handToGlitch(ctx, game, job.version, cardId, spec);
    await ctx.agents.states.set(channelId, 'forge', 'idle');
  } catch (e) {
    await failBuild(ctx, { game, job, cardId, channelId, t0, error: e, stateRef: () => state, setState: s => (state = s) });
  }
}

async function saveCardState(ctx: AgentCtx, messageId: string, state: BuildCardState): Promise<void> {
  await updateCardState<BuildCardState>(ctx.db, messageId, () => state);
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return h;
}

async function failBuild(
  ctx: AgentCtx,
  o: {
    game: GameRow;
    job: BuildJobData;
    cardId: string;
    channelId: string;
    t0: number;
    error: unknown;
    stateRef: () => BuildCardState;
    setState: (s: BuildCardState) => void;
  },
): Promise<void> {
  const { game, job, cardId, channelId, error: e } = o;
  const checkFailed = e instanceof BuildCheckFailedError;
  const usage: AiUsage | undefined = checkFailed ? e.usage : (e as { usage?: AiUsage }).usage;
  const text = checkFailed
    ? FAIL_TEXT.check(job.version, e.attempts.length)
    : e instanceof AiRefusalError
      ? FAIL_TEXT.refusal(job.version)
      : e instanceof BudgetExceededError
        ? FAIL_TEXT.budget
        : FAIL_TEXT.other(job.version);
  ctx.log[checkFailed || e instanceof AiRefusalError ? 'warn' : 'error']({ err: e, job }, 'build failed');
  const prev = o.stateRef();
  const state: BuildCardState = {
    ...prev,
    status: 'failed',
    steps: prev.steps.map(s => (s.s === 'doing' ? { ...s, s: 'failed' as const } : s)),
    attempts: checkFailed ? e.attempts.length : undefined,
    checkPass: checkFailed ? false : undefined,
    problems: checkFailed ? e.problems.slice(0, 10) : [],
    error: text.replace(/\*\*/g, '').slice(0, 300),
  };
  o.setState(state);
  await saveCardState(ctx, cardId, state).catch(() => {});
  await updateCard(ctx, { messageId: cardId, channelId, operatorId: forgeOperator, metadata: buildMetadata(state) }).catch(err =>
    ctx.log.warn({ err }, 'failed-card update failed'),
  );
  await updateVersion(ctx.db, game.id, job.version, {
    status: checkFailed ? 'check_failed' : 'failed',
    checkResult: checkFailed ? { pass: false, problems: e.problems, attempts: e.attempts.map(a => ({ attempt: a.attempt, problems: a.problems })) } : null,
    ...(usage && { tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, costUsd: usage.costUsd, model: usage.model }),
  });
  await updateGame(ctx.db, game.id, { status: 'failed' });
  await postText(ctx, channelId, 'forge', text).catch(err => ctx.log.error({ err }, 'could not post the build failure'));
  await record(ctx, {
    action: 'build.failed',
    actor: { type: 'agent', agent: 'forge' },
    crewId: game.crewId,
    gameId: game.id,
    summary: `v${job.version} failed: ${checkFailed ? `${e.problems.length} static-check problems after ${e.attempts.length} attempts` : e instanceof AiError ? e.message : 'internal error'}`,
    output: checkFailed ? { problems: e.problems.slice(0, 10), attempts: e.attempts.length } : null,
    reason: e instanceof Error ? e.message.slice(0, 300) : 'unknown',
    metrics: usage
      ? { tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, costUsd: usage.costUsd, ms: Math.round(ctx.now() - o.t0) }
      : { ms: Math.round(ctx.now() - o.t0) },
  });
  if (usage) await chargeUsage(ctx, job.requestedBy ?? game.createdBy, usage);
  await ctx.agents.states.set(channelId, 'forge', 'idle');
}

/** Forge → Glitch handoff and the playtest job (agents/glitch.ts runs it). */
async function handToGlitch(ctx: AgentCtx, game: GameRow, version: number, buildCardId: string, spec: GameSpec): Promise<void> {
  const channelId = game.roomChannelId!;
  const checks = acceptanceFor(spec, version);
  const task = `Test v${version} against the acceptance list`;
  const handoffId = await postCard(ctx, {
    channelId,
    agent: 'forge',
    kind: 'handoff',
    content: {
      v: 1,
      gameId: game.id,
      from: 'forge',
      to: 'glitch',
      task,
      contextSummary: `${game.title} v${version}: ${checks.length} acceptance checks to play through.`.slice(0, 600),
      artifacts: [{ kind: 'build', label: `Build v${version}`, ref: buildCardId }],
    },
    metadata: { status: 'waiting' },
    gameId: game.id,
    version,
    state: { kind: 'handoff', status: 'waiting' },
  });
  await record(ctx, {
    action: 'handoff',
    actor: { type: 'agent', agent: 'forge' },
    crewId: game.crewId,
    gameId: game.id,
    summary: `Forge → Glitch: ${task}`,
    output: { handoffMessageId: handoffId, buildCardMessageId: buildCardId },
  });
  await ctx.agents.states.set(channelId, 'glitch', 'waiting_approval', { detail: `testing v${version} soon`, gameId: game.id });
  await ctx.agents.queue.enqueuePlaytest({ key: `${game.id}:v${version}:${buildCardId}`, gameId: game.id, version, channelId, handoffMessageId: handoffId });
}

// ---- change requests: Pixel writes a short spec delta, Forge builds the next version -------------

export const PixelDelta = z.object({
  /** One short line to the crew, in their language. */
  intro: z.string().min(1).max(300),
  /** What changes in the next version (one or two sentences). */
  summary: z.string().min(3).max(600),
  /** 0-3 new acceptance items for the change, each checkable through window.__crew.state(). */
  acceptance: z.array(z.string().min(5).max(300)).max(3),
});

const DELTA_SYSTEM = `You are Pixel, the Designer agent in CrewArcade. A game is already built; the crew asked for a change. Write a short spec delta for the next version:
- intro: one short friendly line to the crew in their language and style (English, Hindi or Hinglish).
- summary: exactly what changes, in one or two sentences Forge can build from.
- acceptance: 0-3 new checkable items for this change, each one sentence naming the exact window.__crew.state() field it reads (e.g. "state().speed at the start is higher than in v1"). Keep the existing items unless the change replaces them.

${SAFETY_RULES}`;

/** True when this game room already has a built version, so changes become new builds. */
export async function hasBuild(ctx: Pick<Ctx, 'db'>, gameId: string): Promise<boolean> {
  return (await latestBuiltVersion(ctx.db, gameId)) !== null;
}

export async function runBuildChange(ctx: AgentCtx, job: AgentJobData, room: Extract<Room, { kind: 'game' }>): Promise<void> {
  const game = room.game;
  const latest = await latestBuiltVersion(ctx.db, game.id);
  const top = await maxVersion(ctx.db, game.id);
  if (!latest) return void (await postText(ctx, job.channelId, 'forge', 'Nothing is built yet. Once v1 is ready, ask me for changes!'));
  const pending = top > latest.version ? await getVersion(ctx.db, game.id, top) : null;
  if (pending && pending.status === 'building')
    return void (await postText(ctx, job.channelId, 'forge', `v${top} is still building. Ask again once it's ready and I'll fold it in.`));
  const user = await getUser(ctx.db, job.fromUserId);
  const name = user?.displayName ?? 'Someone';
  const spec = GameSpecSchema.parse(latest.spec);
  const next = top + 1;

  await ctx.agents.states.set(job.channelId, 'pixel', 'designing', { detail: `v${next} change`, gameId: game.id });
  await checkBudget(ctx);
  const { value, usage } = await requireAi(ctx).structured({
    purpose: 'pixel.delta',
    system: DELTA_SYSTEM,
    user: [
      `The current plan:\n<untrusted kind="plan">\n${JSON.stringify({ title: spec.title, coreLoop: spec.coreLoop, scoring: spec.scoring, acceptance: acceptanceFor(spec, latest.version) })}\n</untrusted>`,
      `${name} asked for this change:\n<untrusted kind="change request">\n${job.text.replace(/<\/?untrusted[^>]*>/gi, '')}\n</untrusted>`,
      `Game language: ${game.language}. Write the delta now.`,
    ].join('\n\n'),
    effort: 'low',
    maxTokens: 2000,
    schema: PixelDelta,
    hint: { change: job.text, hindi: game.language === 'hi' },
  }).done;
  await chargeUsage(ctx, job.fromUserId, usage);

  const existing = acceptanceFor(spec, latest.version);
  const items: AcceptanceItem[] = value.acceptance.map((text, i) => ({ id: `A${Math.min(99, existing.length + i + 1)}`, text }));
  const delta: SpecChange = { version: next, askedBy: [name.slice(0, 64)], summary: value.summary, acceptance: items };
  const nextSpec: GameSpec = GameSpecSchema.parse({ ...spec, changes: [...spec.changes.filter(c => c.version < next), delta].slice(-50) });
  await insertVersion(ctx.db, { id: newId('version'), gameId: game.id, version: next, spec: nextSpec, status: 'building', createdAt: new Date(ctx.now()) });
  await postText(ctx, job.channelId, 'pixel', value.intro);
  await record(ctx, {
    action: 'plan.revised',
    actor: { type: 'agent', agent: 'pixel' },
    crewId: room.crew.id,
    gameId: game.id,
    summary: `Pixel wrote the v${next} change for ${name}: ${value.summary.slice(0, 120)}`,
    input: { change: job.text, from: latest.version },
    output: delta,
    metrics: { tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, costUsd: usage.costUsd, ms: usage.ms },
  });
  const task = `Build v${next}: ${value.summary}`.slice(0, 300);
  const handoffId = await postCard(ctx, {
    channelId: job.channelId,
    agent: 'pixel',
    kind: 'handoff',
    content: {
      v: 1,
      gameId: game.id,
      from: 'pixel',
      to: 'forge',
      task,
      contextSummary: `Change asked by ${name}. ${items.length} new check${items.length === 1 ? '' : 's'}; v${latest.version} is the starting point.`.slice(
        0,
        600,
      ),
      artifacts: [{ kind: 'plan', label: `v${next} change`, ref: `${game.id}:v${next}` }],
    },
    metadata: { status: 'waiting' },
    gameId: game.id,
    version: next,
    state: { kind: 'handoff', status: 'waiting' },
  });
  await record(ctx, {
    action: 'handoff',
    actor: { type: 'agent', agent: 'pixel' },
    crewId: room.crew.id,
    gameId: game.id,
    summary: `Pixel → Forge: ${task}`,
    output: { handoffMessageId: handoffId },
  });
  await ctx.agents.queue.enqueueBuild({
    key: `${game.id}:v${next}`,
    gameId: game.id,
    version: next,
    channelId: job.channelId,
    handoffMessageId: handoffId,
    reason: 'change',
    requestedBy: job.fromUserId,
  });
  await ctx.agents.states.set(job.channelId, 'pixel', 'idle');
  await ctx.agents.states.set(job.channelId, 'forge', 'waiting_approval', { detail: `build v${next} starts soon`, gameId: game.id });
}
