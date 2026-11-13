// Typed client for our server. The browser only calls its own origin: /api/* is proxied to the
// Render server by a Next.js rewrite (next.config.ts), so the session cookie is first-party.
// Every response is parsed with the shared zod schemas.
import {
  CrewDetail,
  CrewMember,
  CrewSummary,
  InvitePreview,
  NexconnTokenResponse,
  Profile,
  type CreateCrewBody,
  type GuestSignupBody,
  type ProfilePatch,
} from '@crewarcade/shared';
import { z } from 'zod';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function request<S extends z.ZodType>(method: 'GET' | 'POST' | 'PATCH', path: string, schema: S, body?: unknown): Promise<z.infer<S>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiRequestError(0, 'network', "Can't reach CrewArcade. Check your connection.");
  }
  const json: unknown = res.status === 204 ? {} : await res.json().catch(() => null);
  if (!res.ok) {
    const err = z.object({ error: z.string(), message: z.string() }).safeParse(json);
    throw new ApiRequestError(res.status, err.success ? err.data.error : 'http_error', err.success ? err.data.message : `Request failed (${res.status})`);
  }
  return schema.parse(json);
}

export const api = {
  me: () => request('GET', '/api/me', z.object({ user: Profile })).then(r => r.user),
  signUp: (body: GuestSignupBody) => request('POST', '/api/auth/guest', z.object({ user: Profile }), body).then(r => r.user),
  updateMe: (patch: ProfilePatch) => request('PATCH', '/api/me', z.object({ user: Profile }), patch).then(r => r.user),
  signOut: () => request('POST', '/api/auth/logout', z.unknown()),
  nexconnToken: (refresh = false) => request('POST', '/api/nexconn/token', NexconnTokenResponse, { refresh }),
  crews: () => request('GET', '/api/crews', z.object({ crews: z.array(CrewSummary) })).then(r => r.crews),
  crew: (id: string) => request('GET', `/api/crews/${encodeURIComponent(id)}`, z.object({ crew: CrewDetail })).then(r => r.crew),
  createCrew: (body: CreateCrewBody) => request('POST', '/api/crews', z.object({ crew: CrewDetail }), body).then(r => r.crew),
  setRole: (crewId: string, userId: string, role: 'approver' | 'member') =>
    request('PATCH', `/api/crews/${encodeURIComponent(crewId)}/members/${encodeURIComponent(userId)}`, z.object({ member: CrewMember }), { role }).then(
      r => r.member,
    ),
  invite: (code: string) => request('GET', `/api/invites/${encodeURIComponent(code)}`, z.object({ invite: InvitePreview })).then(r => r.invite),
  join: (code: string) => request('POST', `/api/invites/${encodeURIComponent(code)}/join`, z.object({ crewId: z.string(), alreadyMember: z.boolean() })),
};
