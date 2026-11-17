// Bug reports (Phase 5): [Report a bug] in the player and `bug: …` in the game room both land here.
//   reportBug:      saves the report (+ screenshot in the private uploads bucket), posts Glitch's
//                   BugCard, writes bug.reported and queues the repro (playtest queue, one per room).
//   bugScreenshot:  the screenshot, for crew members only.
//   translate quota: tap-to-translate reserves characters of the per-user daily cap first.
import { LIMITS, newId, type BugReportBody } from '@crewarcade/shared';
import { bugCardMeta } from '../agents/glitch';
import type { AgentServices } from '../agents/runtime-deps';
import type { Ctx } from '../context';
import { getBug, insertBug, reserveTranslationChars, updateBug } from '../repo/bugs';
import { getRole } from '../repo/crews';
import { dayOf, getGame } from '../repo/games';
import type { UserRow } from '../repo/users';
import { getVersion, latestBuiltVersion } from '../repo/versions';
import { screenshotKey } from '../storage';
import { postCard } from './chat';
import { CrewRuleError } from './crews';
import { record } from './ledger';

type AgentCtx = Ctx & { agents: AgentServices };

/** Decodes a data-URL screenshot and checks the bytes really are that image type (pure, tested). */
export function decodeScreenshot(dataUrl: string): { data: Buffer; ext: 'png' | 'jpg' | 'webp'; mimeType: string } {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new CrewRuleError(409, 'bad_screenshot', 'Screenshot must be a PNG, JPEG or WebP image');
  const data = Buffer.from(m[2]!, 'base64');
  if (data.length === 0 || data.length > LIMITS.screenshotBytes) throw new CrewRuleError(409, 'bad_screenshot', 'Screenshot is too big (max 4 MB)');
  const kind = m[1]!;
  const ok =
    kind === 'png'
      ? data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      : kind === 'jpeg'
        ? data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
        : data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP';
  if (!ok) throw new CrewRuleError(409, 'bad_screenshot', 'That file is not the image it claims to be');
  return { data, ext: kind === 'jpeg' ? 'jpg' : (kind as 'png' | 'webp'), mimeType: `image/${kind}` };
}

export async function reportBug(
  ctx: AgentCtx,
  user: UserRow,
  gameId: string,
  body: { description: string; version?: number | undefined; screenshot?: string | undefined } & Partial<BugReportBody>,
  source: 'player' | 'chat',
): Promise<{ bugId: string; messageId: string | null }> {
  const game = await getGame(ctx.db, gameId);
  const role = game ? await getRole(ctx.db, game.crewId, user.id) : null;
  if (!game || !role || user.isAgent) throw new CrewRuleError(404, 'not_found', 'Game not found');
  if (!game.roomChannelId) throw new CrewRuleError(409, 'no_room', 'This game has no room yet');
  const asked = body.version ? await getVersion(ctx.db, game.id, body.version) : null;
  const version = asked?.htmlPath ? asked : await latestBuiltVersion(ctx.db, game.id);
  if (!version) throw new CrewRuleError(409, 'nothing_built', 'There is no build to test yet');
  const shot = body.screenshot ? decodeScreenshot(body.screenshot) : null;

  const bugId = newId('bug');
  // The bug row keeps the object key (read back through ctx.uploads.get).
  const screenshotPath = shot ? screenshotKey(game.slug, bugId, shot.ext) : null;
  if (shot && screenshotPath) await ctx.uploads.put(screenshotPath, shot.data, shot.mimeType);
  const bug = await insertBug(ctx.db, {
    id: bugId,
    gameId: game.id,
    reporterId: user.id,
    description: body.description.trim().slice(0, LIMITS.bugChars),
    screenshotPath,
    reportedOnVersion: version.version,
    createdAt: new Date(ctx.now()),
  });
  const at = { origin: ctx.config.PUBLIC_API_ORIGIN, slug: game.slug };
  const messageId = await postCard(ctx, {
    channelId: game.roomChannelId,
    agent: 'glitch',
    kind: 'bug',
    content: {
      v: 1,
      bugId,
      gameId: game.id,
      reporterId: user.id,
      reporterName: user.displayName.slice(0, 64),
      description: bug.description.length >= 3 ? bug.description : `${bug.description}...`,
      version: version.version,
      ...(screenshotPath && { screenshotUrl: `${ctx.config.WEB_ORIGIN.replace(/\/+$/, '')}/api/bugs/${bugId}/screenshot` }),
    },
    metadata: bugCardMeta(bug, at),
    gameId: game.id,
    version: version.version,
    state: { kind: 'bug', bugId },
  });
  await updateBug(ctx.db, bugId, { cardMessageId: messageId });
  await record(ctx, {
    action: 'bug.reported',
    actor: { type: 'human', userId: user.id },
    crewId: game.crewId,
    gameId: game.id,
    summary: `${user.displayName} reported BUG ${bug.number} on v${version.version}${shot ? ' (with a screenshot)' : ''}: ${bug.description.slice(0, 80)}`,
    input: { description: bug.description, version: version.version, source, screenshot: !!shot },
  });
  await ctx.agents.queue.enqueuePlaytest({
    key: `bug:${bugId}`,
    gameId: game.id,
    version: version.version,
    channelId: game.roomChannelId,
    handoffMessageId: messageId,
    bugId,
  });
  return { bugId, messageId };
}

/** The screenshot bytes for a crew member (404 for everyone else: the bucket is private). */
export async function bugScreenshot(ctx: Ctx, user: UserRow, bugId: string): Promise<{ body: Buffer; contentType: string }> {
  const bug = await getBug(ctx.db, bugId);
  const game = bug ? await getGame(ctx.db, bug.gameId) : null;
  const role = game ? await getRole(ctx.db, game.crewId, user.id) : null;
  if (!bug?.screenshotPath || !role) throw new CrewRuleError(404, 'not_found', 'Not found');
  const body = await ctx.uploads.get(bug.screenshotPath);
  if (!body) throw new CrewRuleError(404, 'not_found', 'Not found');
  const ext = bug.screenshotPath.split('.').pop();
  return { body, contentType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg' };
}

/** Tap-to-translate: reserves `chars` of today's per-user cap (LIMITS.dailyTranslationChars). */
export async function reserveTranslation(ctx: Ctx, user: UserRow, chars: number): Promise<{ ok: boolean; used: number; limit: number }> {
  const limit = LIMITS.dailyTranslationChars;
  const r = await reserveTranslationChars(ctx.db, dayOf(ctx.now()), user.id, chars, limit);
  if (!r.ok) ctx.log.info({ userId: user.id, chars, used: r.used }, 'translation cap reached');
  return { ...r, limit };
}
