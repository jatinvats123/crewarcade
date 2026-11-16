// Human actions around builds (the server checks every permission from crew_members):
//   retryBuild:         [Try again] on a failed Build card (any crew member)
//   requestBuildChange: [Change] on a Build card -> Pixel's delta + Forge's next version
//   playLink:           a URL the player iframe can load (signed for unpublished versions)
//   versionsOf / gamePage / startRemix
import { type GamePageResponse, type GameVersionSummary, type PlayUrlResponse } from '@crewarcade/shared';
import type { AgentServices } from '../agents/runtime-deps';
import type { BuildCardState } from '../agents/forge-runtime';
import type { Ctx } from '../context';
import { getCrew, getRole, listMembers } from '../repo/crews';
import { getCard, getGame, updateCardState, updateGame, type GameRow } from '../repo/games';
import type { UserRow } from '../repo/users';
import { getGameBySlug, getVersion, listRemixes, listVersions, updateVersion, type VersionRow } from '../repo/versions';
import { CrewRuleError, createCrew } from './crews';
import { record } from './ledger';
import { playUrl } from './play';

type AgentCtx = Ctx & { agents: AgentServices };

async function memberOf(ctx: Ctx, game: GameRow, user: UserRow) {
  const role = await getRole(ctx.db, game.crewId, user.id);
  if (!role) throw new CrewRuleError(404, 'not_found', 'Game not found');
  return role;
}

async function buildCard(ctx: Ctx, messageId: string) {
  const card = await getCard(ctx.db, messageId);
  if (!card || card.cardType !== 'build' || !card.gameId || !card.version) throw new CrewRuleError(404, 'not_found', 'Card not found');
  const game = await getGame(ctx.db, card.gameId);
  if (!game) throw new CrewRuleError(404, 'not_found', 'Card not found');
  return { card, game, version: card.version };
}

export async function retryBuild(ctx: AgentCtx, user: UserRow, messageId: string): Promise<{ queued: boolean }> {
  const { card, game, version } = await buildCard(ctx, messageId);
  await memberOf(ctx, game, user);
  const box: { reason?: string } = {};
  const upd = await updateCardState<BuildCardState & { retried?: boolean }>(ctx.db, messageId, s => {
    if (s.status !== 'failed') return ((box.reason = 'This build did not fail'), null);
    if (s.retried) return ((box.reason = 'A retry is already on its way'), null);
    return { ...s, retried: true };
  });
  if (!upd || box.reason) throw new CrewRuleError(409, 'conflict', box.reason ?? 'Card not found');
  await updateVersion(ctx.db, game.id, version, { status: 'building' });
  await updateGame(ctx.db, game.id, { status: 'building' });
  const handoffMessageId = (upd.state as { handoffMessageId?: string }).handoffMessageId ?? messageId;
  const queued = await ctx.agents.queue.enqueueBuild({
    key: `${game.id}:v${version}:retry:${messageId}`,
    gameId: game.id,
    version,
    channelId: card.channelId,
    handoffMessageId,
    reason: 'retry',
    requestedBy: user.id,
  });
  await record(ctx, {
    action: 'build.queued',
    actor: { type: 'human', userId: user.id },
    crewId: game.crewId,
    gameId: game.id,
    summary: `${user.displayName} asked Forge to try v${version} again`,
    output: { queued },
  });
  await ctx.agents.states.set(card.channelId, 'forge', 'waiting_approval', { detail: `retrying v${version} soon`, gameId: game.id });
  return { queued };
}

export async function requestBuildChange(ctx: AgentCtx, user: UserRow, messageId: string, text: string): Promise<{ queued: boolean }> {
  const { card, game } = await buildCard(ctx, messageId);
  await memberOf(ctx, game, user);
  const upd = await updateCardState<BuildCardState & { changeRequests?: number }>(ctx.db, messageId, s => ({
    ...s,
    changeRequests: (s.changeRequests ?? 0) + 1,
  }));
  const n = (upd?.state as { changeRequests?: number } | undefined)?.changeRequests ?? 1;
  await record(ctx, {
    action: 'plan.change_requested',
    actor: { type: 'human', userId: user.id },
    crewId: game.crewId,
    gameId: game.id,
    summary: `${user.displayName} asked for a change to ${game.title}`,
    input: { change: text, fromVersion: card.version },
  });
  const queued = await ctx.agents.queue.enqueueAgent({
    key: `card:${messageId}:change:${n}`,
    crewId: game.crewId,
    channelId: card.channelId,
    messageId: null,
    fromUserId: user.id,
    agent: 'forge',
    intent: 'change',
    text,
    attachments: [],
    cardMessageId: messageId,
  });
  return { queued };
}

const orientationOf = (v: VersionRow): PlayUrlResponse['orientation'] => {
  const o = (v.meta as { orientation?: unknown }).orientation;
  return o === 'portrait' || o === 'landscape' ? o : 'any';
};

export async function playLink(ctx: Ctx, user: UserRow | null, gameId: string, versionArg: number | 'latest'): Promise<PlayUrlResponse> {
  const game = await getGame(ctx.db, gameId);
  if (!game) throw new CrewRuleError(404, 'not_found', 'Game not found');
  const member = user ? (await getRole(ctx.db, game.crewId, user.id)) !== null : false;
  let version = versionArg;
  if (version === 'latest') {
    const built = (await listVersions(ctx.db, game.id)).find(v => v.htmlPath && (member || v.version === game.publishedVersion));
    if (!built) throw new CrewRuleError(404, 'not_found', 'Nothing to play yet');
    version = built.version;
  }
  const v = await getVersion(ctx.db, game.id, version);
  const published = game.publishedVersion === version;
  if (!v?.htmlPath || (!published && !member)) throw new CrewRuleError(404, 'not_found', 'Version not found');
  const link = playUrl(ctx.config, { slug: game.slug, version, published, now: ctx.now() });
  return { ...link, gameId: game.id, slug: game.slug, title: game.title, version, orientation: orientationOf(v) };
}

function summary(v: VersionRow, game: GameRow): GameVersionSummary {
  return {
    version: v.version,
    status: v.status,
    sizeBytes: v.sizeBytes,
    buildMs: v.buildMs,
    notes: v.notes,
    published: game.publishedVersion === v.version,
    createdAt: v.createdAt.toISOString(),
  };
}

export async function versionsOf(ctx: Ctx, user: UserRow | null, gameId: string): Promise<GameVersionSummary[]> {
  const game = await getGame(ctx.db, gameId);
  if (!game) throw new CrewRuleError(404, 'not_found', 'Game not found');
  const member = user ? (await getRole(ctx.db, game.crewId, user.id)) !== null : false;
  if (!member && !game.publishedVersion) throw new CrewRuleError(404, 'not_found', 'Game not found');
  return (await listVersions(ctx.db, game.id)).filter(v => (member ? true : v.version === game.publishedVersion)).map(v => summary(v, game));
}

const DEFAULT_COLORS: [string, string] = ['#7c5cff', '#ffb547'];

/** The public /g/:slug page. Drafts get a teaser (no play link, no versions). */
export async function gamePage(ctx: Ctx, slug: string): Promise<GamePageResponse> {
  const game = await getGameBySlug(ctx.db, slug);
  if (!game) throw new CrewRuleError(404, 'not_found', 'Game not found');
  const crew = await getCrew(ctx.db, game.crewId);
  const members = crew ? (await listMembers(ctx.db, crew.id)).filter(m => !m.isAgent).slice(0, 12) : [];
  const versions = await listVersions(ctx.db, game.id);
  const pub = game.publishedVersion ? (versions.find(v => v.version === game.publishedVersion) ?? null) : null;
  const look = (pub ?? versions.find(v => v.htmlPath) ?? null)?.meta as { emoji?: unknown; colors?: unknown } | undefined;
  const colors =
    Array.isArray(look?.colors) && look.colors.length === 2 && look.colors.every(c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))
      ? (look.colors as [string, string])
      : DEFAULT_COLORS;
  const source = game.remixOfGameId ? await getGame(ctx.db, game.remixOfGameId) : null;
  return {
    id: game.id,
    slug: game.slug,
    title: game.title,
    pitch: game.pitch,
    status: game.status,
    language: game.language,
    emoji: typeof look?.emoji === 'string' && look.emoji.length <= 16 ? look.emoji : '🎮',
    colors,
    publishedVersion: game.publishedVersion,
    playUrl: pub?.htmlPath ? playUrl(ctx.config, { slug: game.slug, version: pub.version, published: true, now: ctx.now() }).url : null,
    orientation: pub ? orientationOf(pub) : 'any',
    crew: { name: crew?.name ?? 'A crew', members: members.map(m => ({ name: m.displayName, avatarEmoji: m.avatarEmoji, avatarColor: m.avatarColor })) },
    remixOf: source ? { slug: source.slug, title: source.title } : null,
    remixes: game.publishedVersion ? await listRemixes(ctx.db, game.id) : [],
    versions: pub ? versions.filter(v => v.version <= pub.version && v.htmlPath).map(v => summary(v, game)) : [],
    createdAt: game.createdAt.toISOString(),
  };
}

/** [Remix this]: Pixel plans a remix in the chosen (or a new) crew; v1 then starts from this game's code. */
export async function startRemix(
  ctx: AgentCtx,
  user: UserRow,
  slug: string,
  body: { crewId?: string | undefined; newCrewName?: string | undefined; idea?: string | undefined },
): Promise<{ crewId: string; channelId: string }> {
  const game = await getGameBySlug(ctx.db, slug);
  if (!game || !game.publishedVersion) throw new CrewRuleError(404, 'not_found', 'Only published games can be remixed');
  let crewId: string;
  let channelId: string;
  if (body.crewId) {
    const crew = await getCrew(ctx.db, body.crewId);
    if (!crew || !(await getRole(ctx.db, crew.id, user.id))) throw new CrewRuleError(404, 'not_found', 'Crew not found');
    crewId = crew.id;
    channelId = crew.groupChannelId;
  } else {
    const crew = await createCrew(ctx, user, { name: body.newCrewName!.slice(0, 40), kind: 'crew' });
    crewId = crew.id;
    channelId = crew.groupChannelId;
  }
  const idea = body.idea?.trim() || 'make it our own';
  await ctx.agents.queue.enqueueAgent({
    key: `remix:${user.id}:${game.id}:${crewId}:${ctx.now()}`,
    crewId,
    channelId,
    messageId: null,
    fromUserId: user.id,
    agent: 'pixel',
    intent: 'remix',
    text: `remix ${game.slug} into ${idea}`.slice(0, 4000),
    attachments: [],
    remix: { source: game.slug, idea },
  });
  await record(ctx, {
    action: 'game.remix_started',
    actor: { type: 'human', userId: user.id },
    crewId,
    gameId: game.id,
    summary: `${user.displayName} started a remix of ${game.title}`,
    input: { idea },
  });
  return { crewId, channelId };
}
