// The publish gate and the Test card's human actions. Every permission comes from crew_members:
//   decidePublish: Allow / Block on a publish request card. Owner or approver only; agents never.
//   askForFix:     [Ask for fix] / [Try again] on a FAIL Test card (any human crew member).
import { AGENTS, nexconnUserId, type CrewRole } from '@crewarcade/shared';
import { bugCardMeta, startFix, nameOf } from '../agents/glitch';
import { bugsFixedBy, updateBug } from '../repo/bugs';
import type { AgentServices } from '../agents/runtime-deps';
import type { Ctx } from '../context';
import { getRole } from '../repo/crews';
import { getCard, getGame, updateCardState, updateGame } from '../repo/games';
import type { UserRow } from '../repo/users';
import { getVersion, updateVersion } from '../repo/versions';
import { postText, updateCard } from './chat';
import { CrewRuleError } from './crews';
import { record } from './ledger';

type AgentCtx = Ctx & { agents: AgentServices };

export interface PublishCardState extends Record<string, unknown> {
  kind: 'publish';
  status: 'waiting' | 'approved' | 'rejected';
  decidedBy?: string;
  decidedAt?: string;
}

/** Who may tap Allow / Block (pure, tested): humans with the owner or approver role. */
export function canDecidePublish(user: Pick<UserRow, 'isAgent'>, role: CrewRole | null): boolean {
  return !user.isAgent && (role === 'owner' || role === 'approver');
}

export async function decidePublish(ctx: AgentCtx, user: UserRow, messageId: string, decision: 'allow' | 'block'): Promise<Record<string, string>> {
  const card = await getCard(ctx.db, messageId);
  if (!card || card.cardType !== 'publish' || !card.gameId || !card.version) throw new CrewRuleError(404, 'not_found', 'Card not found');
  const game = await getGame(ctx.db, card.gameId);
  if (!game) throw new CrewRuleError(404, 'not_found', 'Card not found');
  const role = await getRole(ctx.db, game.crewId, user.id);
  if (!role) throw new CrewRuleError(404, 'not_found', 'Card not found');
  if (!canDecidePublish(user, role)) throw new CrewRuleError(403, 'not_approver', 'Only the crew owner or an approver can publish');
  const version = card.version;
  const row = await getVersion(ctx.db, game.id, version);
  if (!row || row.status !== 'passed') throw new CrewRuleError(409, 'conflict', 'Only a version that passed its playtest can be published');

  // Claim the decision under the card's row lock: a second tap (or a second approver) gets 409.
  const at = new Date(ctx.now()).toISOString();
  const box: { closed?: string } = {};
  const claimed = await updateCardState<PublishCardState>(ctx.db, messageId, s => {
    if (s.status !== 'waiting') return ((box.closed = s.status), null);
    return { ...s, status: decision === 'allow' ? 'approved' : 'rejected', decidedBy: user.displayName.slice(0, 64), decidedAt: at };
  });
  if (!claimed || box.closed) throw new CrewRuleError(409, 'closed', box.closed === 'approved' ? 'Already published' : 'Already decided');

  if (decision === 'allow') {
    await updateVersion(ctx.db, game.id, version, { status: 'published', publishedAt: new Date(ctx.now()) });
    await updateGame(ctx.db, game.id, { status: 'published', publishedVersion: version });
  } else if (!game.publishedVersion) {
    await updateGame(ctx.db, game.id, { status: 'blocked' });
  }
  const metadata = await updateCard(ctx, {
    messageId,
    channelId: card.channelId,
    operatorId: nexconnUserId(user.id),
    metadata: { status: claimed.state.status, decidedBy: claimed.state.decidedBy, decidedAt: at },
  });
  await record(ctx, {
    action: decision === 'allow' ? 'publish.approved' : 'publish.blocked',
    actor: { type: 'human', userId: user.id },
    crewId: game.crewId,
    gameId: game.id,
    summary: `${user.displayName} ${decision === 'allow' ? 'published' : 'blocked'} ${game.title} v${version}`,
    input: { version, role },
  });
  if (decision === 'allow') await closeFixedBugs(ctx, game, version, card.channelId);
  const link = `${ctx.config.WEB_ORIGIN.replace(/\/+$/, '')}/g/${game.slug}`;
  await postText(
    ctx,
    card.channelId,
    'glitch',
    decision === 'allow'
      ? `🎉 ${user.displayName} published ${game.title} v${version}. It's live for everyone: ${link}`
      : `${user.displayName} blocked v${version}. It stays private; ask Forge for changes any time.`,
  ).catch(err => ctx.log.warn({ err }, 'publish announcement failed'));
  await ctx.agents.states.set(card.channelId, 'glitch', 'idle');
  return metadata;
}

/** A published hotfix: its bug is fixed (BugCard turns green, the bug hunter is credited on /g). */
async function closeFixedBugs(ctx: AgentCtx, game: { id: string; crewId: string; slug: string }, version: number, channelId: string): Promise<void> {
  for (const bug of await bugsFixedBy(ctx.db, game.id, version)) {
    if (bug.status === 'fixed') continue;
    await updateBug(ctx.db, bug.id, { status: 'fixed', fixedInVersion: version });
    const fixed = { ...bug, status: 'fixed' as const, fixedInVersion: version };
    if (bug.cardMessageId)
      await updateCard(ctx, {
        messageId: bug.cardMessageId,
        channelId,
        operatorId: nexconnUserId(AGENTS.glitch.id),
        metadata: bugCardMeta(fixed, { origin: ctx.config.PUBLIC_API_ORIGIN, slug: game.slug }),
      }).catch(err => ctx.log.warn({ err }, 'bug card update failed'));
    await record(ctx, {
      action: 'bug.fixed',
      actor: { type: 'system' },
      crewId: game.crewId,
      gameId: game.id,
      summary: `BUG ${bug.number} fixed in v${version} (bug hunter: ${await nameOf(ctx, bug.reporterId)})`,
      output: { bugId: bug.id },
    });
  }
}

/** [Ask for fix] / [Try again] on a FAIL Test card: Forge fixes the failed checks as the next version. */
export async function askForFix(ctx: AgentCtx, user: UserRow, messageId: string): Promise<{ version: number }> {
  if (user.isAgent) throw new CrewRuleError(403, 'forbidden', 'Agents cannot ask for fixes');
  const card = await getCard(ctx.db, messageId);
  if (!card || card.cardType !== 'test' || !card.gameId || !card.version) throw new CrewRuleError(404, 'not_found', 'Card not found');
  const game = await getGame(ctx.db, card.gameId);
  if (!game || !(await getRole(ctx.db, game.crewId, user.id))) throw new CrewRuleError(404, 'not_found', 'Card not found');
  const name = await nameOf(ctx, user.id);
  const tested = await getVersion(ctx.db, game.id, card.version);
  // Glitch could not write a valid scenario: [Try again] re-runs the playtest; Forge has nothing to fix.
  const glitchOnly = !!tested && tested.status === 'failed' && !tested.scenario;
  const box: { reason?: string; failures?: string[] } = {};
  const claimed = await updateCardState<{ kind: 'test'; pass?: boolean; next?: string; failures?: string[] }>(ctx.db, messageId, s => {
    if (s.pass) return ((box.reason = 'This version passed its playtest'), null);
    if (s.next === 'autofix' || s.next === 'asked') return ((box.reason = 'A fix is already on its way'), null);
    box.failures = s.failures ?? [];
    return { ...s, next: 'asked', fixBy: name };
  });
  if (!claimed || box.reason) throw new CrewRuleError(409, 'conflict', box.reason ?? 'Card not found');
  await updateCard(ctx, {
    messageId,
    channelId: card.channelId,
    operatorId: nexconnUserId(AGENTS.glitch.id),
    metadata: { status: 'done', next: 'asked', fixBy: name },
  }).catch(err => ctx.log.warn({ err }, 'test card update failed'));
  if (glitchOnly) {
    await updateVersion(ctx.db, game.id, card.version, { status: 'testing' });
    await updateGame(ctx.db, game.id, { status: 'testing' });
    await ctx.agents.queue.enqueuePlaytest({
      key: `${game.id}:v${card.version}:retest:${messageId}`,
      gameId: game.id,
      version: card.version,
      channelId: card.channelId,
      handoffMessageId: messageId,
    });
    return { version: card.version };
  }
  const version = await startFix(ctx, game, card.version, { failures: box.failures ?? [], round: 0, by: name, testCardId: messageId, requestedBy: user.id });
  await record(ctx, {
    action: 'build.queued',
    actor: { type: 'human', userId: user.id },
    crewId: game.crewId,
    gameId: game.id,
    summary: `${name} asked Forge to fix v${card.version} (v${version})`,
  });
  return { version };
}
