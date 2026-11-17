// Typed client for our server. The browser only calls its own origin: /api/* is proxied to the
// Render server by a Next.js rewrite (next.config.ts), so the session cookie is first-party.
// Every response is parsed with the shared zod schemas.
import {
  AgentStateMessage,
  BugReportResponse,
  CardActionResponse,
  TranslateQuotaResponse,
  type BugReportBody,
  LedgerEntry,
  LedgerResponse,
  RoomInfo,
  CrewDetail,
  CrewMember,
  CrewSummary,
  InvitePreview,
  NexconnTokenResponse,
  Profile,
  PlayUrlResponse,
  ScoreResponse,
  LeaderboardResponse,
  GameVersionsResponse,
  GamePageResponse,
  RemixResponse,
  type ScoreBody,
  type RemixBody,
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
    const reason = z.object({ reason: z.string() }).safeParse(json);
    throw new ApiRequestError(
      res.status,
      err.success ? err.data.error : 'http_error',
      err.success ? err.data.message : reason.success ? reason.data.reason : `Request failed (${res.status})`,
    );
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
  // Card actions: the server checks every permission and answers with the card's new metadata.
  vote: (messageId: string, vote: 'yes' | 'no') => request('POST', `/api/cards/${encodeURIComponent(messageId)}/vote`, CardActionResponse, { vote }),
  approve: (messageId: string) => request('POST', `/api/cards/${encodeURIComponent(messageId)}/approve`, CardActionResponse, {}),
  requestChange: (messageId: string, text: string) => request('POST', `/api/cards/${encodeURIComponent(messageId)}/change`, CardActionResponse, { text }),
  room: (channelId: string) => request('GET', `/api/rooms/${encodeURIComponent(channelId)}`, z.object({ room: RoomInfo })).then(r => r.room),
  roomAgents: (channelId: string) =>
    request('GET', `/api/rooms/${encodeURIComponent(channelId)}/agents`, z.object({ states: z.array(AgentStateMessage) })).then(r => r.states),
  relay: (body: { channelId: string; messageId: string; mentionedUserIds: string[] } & ({ text: string } | { voice: { url: string; durationS: number } })) =>
    request('POST', '/api/chat/relay', z.object({ routed: z.boolean() }), body),
  // Phase 5: bug reports (screenshot as a data URL) and the tap-to-translate allowance.
  reportBug: (gameId: string, body: BugReportBody) => request('POST', `/api/games/${encodeURIComponent(gameId)}/bugs`, BugReportResponse, body),
  translateQuota: (chars: number) => request('POST', '/api/translate/quota', TranslateQuotaResponse, { chars }),
  ledger: (gameId: string) => request('GET', `/api/games/${encodeURIComponent(gameId)}/ledger`, LedgerResponse),
  retryBuild: (messageId: string) => request('POST', `/api/cards/${encodeURIComponent(messageId)}/retry`, z.object({ queued: z.boolean() }), {}),
  publish: (messageId: string, decision: 'allow' | 'block') =>
    request('POST', `/api/cards/${encodeURIComponent(messageId)}/publish`, CardActionResponse, { decision }),
  askForFix: (messageId: string) =>
    request('POST', `/api/cards/${encodeURIComponent(messageId)}/fix`, z.object({ messageId: z.string(), version: z.number().int() }), {}),
  playUrl: (gameId: string, version: number | 'latest') => request('GET', `/api/games/${encodeURIComponent(gameId)}/versions/${version}/play`, PlayUrlResponse),
  versions: (gameId: string) => request('GET', `/api/games/${encodeURIComponent(gameId)}/versions`, GameVersionsResponse).then(r => r.versions),
  leaderboard: (gameId: string) => request('GET', `/api/games/${encodeURIComponent(gameId)}/leaderboard`, LeaderboardResponse),
  /** 422 (implausible) and 429 (too fast) come back as a ScoreResponse with accepted: false. */
  submitScore: async (body: ScoreBody): Promise<ScoreResponse> => {
    try {
      return await request('POST', '/api/scores', ScoreResponse, body);
    } catch (e) {
      if (e instanceof ApiRequestError && (e.status === 422 || e.status === 429))
        return { accepted: false, reason: e.message, best: null, rank: null, newBest: false };
      throw e;
    }
  },
  publicGame: (slug: string) => request('GET', `/api/public/games/${encodeURIComponent(slug)}`, GamePageResponse),
  remix: (slug: string, body: RemixBody) => request('POST', `/api/games/${encodeURIComponent(slug)}/remix`, RemixResponse, body),
  agentActivity: (crewId: string, agent: 'pixel' | 'forge' | 'glitch') =>
    request('GET', `/api/crews/${encodeURIComponent(crewId)}/agents/${agent}/activity`, z.object({ agent: z.string(), entries: z.array(LedgerEntry) })).then(
      r => r.entries,
    ),
};
