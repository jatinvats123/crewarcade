// Crews and invites.
//   POST  /api/crews                          create (DB + Nexconn group with the 3 agents + welcome)
//   GET   /api/crews                          my crews
//   GET   /api/crews/:id                      details, members, roles (members only)
//   PATCH /api/crews/:id/members/:userId      owner promotes/demotes approvers
//   GET   /api/invites/:code                  public preview for the join screen
//   POST  /api/invites/:code/join             join (server adds the user to the Nexconn group)
import { AGENTS, CreateCrewBody, InviteCode, LIMITS, SetRoleBody, type InvitePreview } from '@crewarcade/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context';
import { getCrew, getCrewByInvite, getCrewDetail, getRole, listCrewsForUser, listMembers, setRole } from '../repo/crews';
import { getUser } from '../repo/users';
import { checkRoleChange, createCrew, joinCrew } from '../services/crews';
import { fixedWindowLimiter, HttpError, optionalUser, rateLimit, requireUser } from './http';

const IdParam = z.object({ id: z.string().min(1).max(64) });
const MemberParams = z.object({ id: z.string().min(1).max(64), userId: z.string().min(1).max(64) });
const CodeParam = z.object({ code: InviteCode });

export function registerCrewRoutes(app: FastifyInstance, ctx: Ctx): void {
  const createLimit = fixedWindowLimiter({ limit: 5, windowMs: 60_000, now: ctx.now });
  const joinLimit = fixedWindowLimiter({ limit: 20, windowMs: 60_000, now: ctx.now });

  app.post('/api/crews', async (req, reply) => {
    const user = await requireUser(ctx, req);
    rateLimit(createLimit, `user:${user.id}`);
    const body = CreateCrewBody.parse(req.body);
    const crew = await createCrew(ctx, user, { name: body.name, kind: body.kind ?? 'crew' });
    return reply.code(201).send({ crew });
  });

  app.get('/api/crews', async req => {
    const user = await requireUser(ctx, req);
    return { crews: await listCrewsForUser(ctx.db, user.id) };
  });

  app.get('/api/crews/:id', async req => {
    const user = await requireUser(ctx, req);
    const { id } = IdParam.parse(req.params);
    const [crew, role] = await Promise.all([getCrew(ctx.db, id), getRole(ctx.db, id, user.id)]);
    // Not a member: same answer as "no such crew", so ids cannot be probed.
    if (!crew || !role) throw new HttpError(404, 'not_found', 'Crew not found');
    return { crew: await getCrewDetail(ctx.db, crew, role) };
  });

  app.patch('/api/crews/:id/members/:userId', async req => {
    const user = await requireUser(ctx, req);
    const { id, userId } = MemberParams.parse(req.params);
    const { role } = SetRoleBody.parse(req.body);
    const crew = await getCrew(ctx.db, id);
    const actorRole = crew ? await getRole(ctx.db, id, user.id) : null;
    if (!crew || !actorRole) throw new HttpError(404, 'not_found', 'Crew not found');
    const target = await getUser(ctx.db, userId);
    checkRoleChange(actorRole, { role: target ? await getRole(ctx.db, id, userId) : null, isAgent: target?.isAgent ?? false });
    await setRole(ctx.db, id, userId, role);
    ctx.log.info({ crewId: id, userId, role, by: user.id }, 'role changed');
    const member = (await listMembers(ctx.db, id)).find(m => m.id === userId);
    return { member };
  });

  app.get('/api/invites/:code', async req => {
    const { code } = CodeParam.parse(req.params);
    const crew = await getCrewByInvite(ctx.db, code);
    if (!crew) throw new HttpError(404, 'not_found', 'This invite link is not valid');
    const viewer = await optionalUser(ctx, req);
    const members = await listMembers(ctx.db, crew.id);
    const preview: InvitePreview = {
      crewId: crew.id,
      name: crew.name,
      memberCount: members.length,
      members: members.slice(0, 12).map(m => ({
        displayName: m.displayName,
        avatarEmoji: m.avatarEmoji,
        avatarColor: m.avatarColor,
        avatarUrl: m.avatarUrl,
        isAgent: m.isAgent,
        agent: Object.values(AGENTS).find(a => a.id === m.id)?.key ?? null,
      })),
      alreadyMember: !!viewer && members.some(m => m.id === viewer.id),
      full: members.length >= LIMITS.crewMembers,
    };
    return { invite: preview };
  });

  app.post('/api/invites/:code/join', async req => {
    const user = await requireUser(ctx, req);
    rateLimit(joinLimit, `user:${user.id}`);
    const { code } = CodeParam.parse(req.params);
    const crew = await getCrewByInvite(ctx.db, code);
    if (!crew) throw new HttpError(404, 'not_found', 'This invite link is not valid');
    const result = await joinCrew(ctx, crew, user, await getRole(ctx.db, crew.id, user.id));
    return { crewId: crew.id, ...result };
  });
}
