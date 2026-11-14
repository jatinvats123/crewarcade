// Crew flows: create (DB + Nexconn group channel with the three agents), join by invite, roles.
// Nexconn is called first, the DB second: a failed Nexconn call leaves nothing behind in our DB.
import {
  AGENT_ID_LIST,
  AGENTS,
  BUILTIN_MESSAGE_TYPES,
  LIMITS,
  MESSAGE_TYPES,
  newId,
  newInviteCode,
  nexconnUserId,
  NoticeMessage,
  type CrewDetail,
  type CrewRole,
} from '@crewarcade/shared';
import type { Ctx } from '../context';
import { createGroup, joinGroup, sendGroupMessage } from '../nexconn/api';
import { addMember, countMembers, countOwnedCrews, getCrewDetail, insertCrewWithMembers, isInviteCodeTaken, type CrewRow } from '../repo/crews';
import { listCrewGames } from '../repo/games';
import type { UserRow } from '../repo/users';
import { ensureRegistered, requireNexconn } from './chat-users';

/**
 * Group permissions. Membership is controlled by our server: people join through invite codes and
 * POST /v4/group-channel/join (which adds users directly, no approval). Client-side joins need the
 * owner's approval, which our UI never offers; only the owner may invite, remove or edit the group.
 */
export const CREW_GROUP_PERMISSIONS = { joinPerm: 0, removePerm: 0, memInvitePerm: 0, invitePerm: 0, profilePerm: 0, memProfilePerm: 2 } as const;

export const WELCOME_TEXT =
  "Hi crew! I'm Pixel, your designer. Pitch a game with @pixel and I'll turn it into a plan with a checklist. Forge builds it, Glitch playtests it, and nothing goes public until an approver taps Allow.";

export class CrewRuleError extends Error {
  constructor(
    readonly status: 403 | 404 | 409 | 429,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CrewRuleError';
  }
}

const MAX_OWNED_CREWS = 20;

async function uniqueInviteCode(ctx: Pick<Ctx, 'db'>): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = newInviteCode();
    if (!(await isInviteCodeTaken(ctx.db, code))) return code;
  }
  throw new Error('could not mint a unique invite code');
}

export async function createCrew(ctx: Ctx, owner: UserRow, input: { name: string; kind: 'crew' | 'classroom' }): Promise<CrewDetail> {
  const nexconn = requireNexconn(ctx);
  // Cheap abuse guard.
  if ((await countOwnedCrews(ctx.db, owner.id)) >= MAX_OWNED_CREWS)
    throw new CrewRuleError(429, 'too_many_crews', `You can own up to ${MAX_OWNED_CREWS} crews`);

  await ensureRegistered(ctx, [owner.id, ...AGENT_ID_LIST]);
  const crew = {
    id: newId('crew'),
    groupChannelId: newId('crewChannel'),
    name: input.name,
    ownerId: owner.id,
    inviteCode: await uniqueInviteCode(ctx),
    kind: input.kind,
  };

  await createGroup(nexconn, {
    channelId: crew.groupChannelId,
    name: crew.name,
    owner: nexconnUserId(owner.id),
    userIds: AGENT_ID_LIST.map(nexconnUserId),
    groupProfile: { introduction: 'A CrewArcade crew: friends + Pixel, Forge and Glitch.' },
    permissions: CREW_GROUP_PERMISSIONS,
    // No groupExtProfile: ext_ keys must be registered for the app first or create fails (25415).
  });
  await insertCrewWithMembers(ctx.db, crew, [{ userId: owner.id, role: 'owner' }, ...AGENT_ID_LIST.map(id => ({ userId: id, role: 'member' as const }))]);
  ctx.log.info({ crewId: crew.id, channelId: crew.groupChannelId }, 'crew created');

  await postWelcome(ctx, crew.groupChannelId).catch(e => ctx.log.warn({ err: e, crewId: crew.id }, 'welcome message failed'));
  const row: CrewRow = { ...crew, createdAt: new Date(ctx.now()), settings: {} };
  return getCrewDetail(ctx.db, row, 'owner');
}

/** Pixel's greeting: a plain text message from the agent, so it renders as a real member. */
export async function postWelcome(ctx: Ctx, channelId: string): Promise<void> {
  await sendGroupMessage(requireNexconn(ctx), {
    fromUserId: nexconnUserId(AGENTS.pixel.id),
    toChannelIds: [channelId],
    messageType: BUILTIN_MESSAGE_TYPES.text,
    content: JSON.stringify({ content: WELCOME_TEXT }),
    pushContent: `Pixel: ${WELCOME_TEXT.slice(0, 60)}…`,
    shouldPersist: 1,
    isEchoToSender: 0,
  });
}

/** CA:Notice (joins, room created...). Not counted as unread; rendered as a centred line. */
export async function postNotice(ctx: Ctx, channelId: string, notice: NoticeMessage): Promise<void> {
  await sendGroupMessage(requireNexconn(ctx), {
    fromUserId: nexconnUserId(AGENTS.pixel.id),
    toChannelIds: [channelId],
    messageType: MESSAGE_TYPES.notice,
    content: JSON.stringify(NoticeMessage.parse(notice)),
    shouldPersist: 1,
    isEchoToSender: 0,
    disablePush: true,
  });
}

export async function joinCrew(ctx: Ctx, crew: CrewRow, user: UserRow, currentRole: CrewRole | null): Promise<{ alreadyMember: boolean }> {
  if (currentRole) return { alreadyMember: true };
  if ((await countMembers(ctx.db, crew.id)) >= LIMITS.crewMembers)
    throw new CrewRuleError(409, 'crew_full', `This crew is full (${LIMITS.crewMembers} members)`);
  const nexconn = requireNexconn(ctx);
  await ensureRegistered(ctx, [user.id]);
  await joinGroup(nexconn, { channelId: crew.groupChannelId, userIds: [nexconnUserId(user.id)] });
  // New members see every game room of the crew too.
  for (const g of await listCrewGames(ctx.db, crew.id))
    if (g.roomChannelId)
      await joinGroup(nexconn, { channelId: g.roomChannelId, userIds: [nexconnUserId(user.id)] }).catch(e =>
        ctx.log.warn({ err: e, gameId: g.id }, 'could not add the new member to a game room'),
      );
  const added = await addMember(ctx.db, crew.id, user.id, 'member');
  if (added) {
    ctx.log.info({ crewId: crew.id, userId: user.id }, 'member joined');
    await postNotice(ctx, crew.groupChannelId, { kind: 'member_joined', text: `${user.displayName} joined the crew` }).catch(e =>
      ctx.log.warn({ err: e, crewId: crew.id }, 'join notice failed'),
    );
  }
  return { alreadyMember: !added };
}

/** Owner-only: promote a human member to approver or demote back. Owner and agents never change. */
export function checkRoleChange(actorRole: CrewRole | null, target: { role: CrewRole | null; isAgent: boolean }): void {
  if (actorRole !== 'owner') throw new CrewRuleError(403, 'not_owner', 'Only the crew owner can change roles');
  if (!target.role) throw new CrewRuleError(404, 'not_member', 'That person is not in this crew');
  if (target.isAgent) throw new CrewRuleError(403, 'agent', 'Agents cannot be approvers');
  if (target.role === 'owner') throw new CrewRuleError(403, 'owner', "The owner's role cannot change");
}

/** Owner and approvers are "approvers" in the permission model. */
export const isApprover = (role: CrewRole | null): boolean => role === 'owner' || role === 'approver';
