// HTTP API contract between the web app and the server (zod at both ends). The browser only ever
// talks to its own origin; /api/* is proxied to the server (docs/SPEC.md "Sessions and the API proxy").
import { z } from 'zod';
import { CREW_ROLES, GAME_STATUSES, LANGUAGE_CODES, LIMITS } from './constants';

/** 24 emoji avatars offered at signup. */
export const AVATAR_EMOJIS = [
  '😎',
  '🤖',
  '👾',
  '🦊',
  '🐼',
  '🐸',
  '🦄',
  '🐙',
  '🐯',
  '🐵',
  '🐧',
  '🦖',
  '🍕',
  '🌮',
  '🍉',
  '🚀',
  '⚡',
  '🔥',
  '🌈',
  '🎮',
  '🎧',
  '🎨',
  '⚽',
  '🌟',
] as const;
/** Avatar ring colours (design tokens, docs/DESIGN.md). */
export const AVATAR_COLORS = ['violet', 'amber', 'cyan', 'pink', 'green', 'gold'] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number];

// Letters, marks, numbers, spaces and a little punctuation; no control or invisible characters.
const DISPLAY_NAME_RE = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} ._'-]*$/u;

export const DisplayName = z
  .string()
  .transform(s => s.normalize('NFC').replace(/\s+/g, ' ').trim())
  .pipe(
    z
      .string()
      .min(LIMITS.displayNameMin, `Use at least ${LIMITS.displayNameMin} characters`)
      .max(LIMITS.displayNameMax, `Use at most ${LIMITS.displayNameMax} characters`)
      .regex(DISPLAY_NAME_RE, 'Use letters, numbers and spaces'),
  );

export const AvatarEmoji = z.enum(AVATAR_EMOJIS);
export const AvatarColorSchema = z.enum(AVATAR_COLORS);
export const LanguageCodeSchema = z.enum(LANGUAGE_CODES);

export const GuestSignupBody = z.object({
  displayName: DisplayName,
  avatarEmoji: AvatarEmoji,
  avatarColor: AvatarColorSchema,
  language: LanguageCodeSchema.default('en'),
});
export type GuestSignupBody = z.input<typeof GuestSignupBody>;

export const ProfilePatch = z
  .object({ displayName: DisplayName, avatarEmoji: AvatarEmoji, avatarColor: AvatarColorSchema, language: LanguageCodeSchema })
  .partial()
  .refine(p => Object.keys(p).length > 0, 'Nothing to update');
export type ProfilePatch = z.input<typeof ProfilePatch>;

export const Profile = z.object({
  id: z.string(),
  /** The same user as Nexconn sees it (nexconnUserId). */
  nexconnId: z.string(),
  displayName: z.string(),
  avatarEmoji: z.string(),
  avatarColor: z.string(),
  avatarUrl: z.string().nullable(),
  language: z.string(),
  isAgent: z.boolean(),
  isJudge: z.boolean(),
});
export type Profile = z.infer<typeof Profile>;

export const NexconnTokenResponse = z.object({ token: z.string().min(1), appKey: z.string().min(1), userId: z.string().min(1) });
export type NexconnTokenResponse = z.infer<typeof NexconnTokenResponse>;

export const CrewRoleSchema = z.enum(CREW_ROLES);

export const CrewMember = z.object({
  id: z.string(),
  nexconnId: z.string(),
  displayName: z.string(),
  avatarEmoji: z.string(),
  avatarColor: z.string(),
  avatarUrl: z.string().nullable(),
  isAgent: z.boolean(),
  role: CrewRoleSchema,
  joinedAt: z.string(),
});
export type CrewMember = z.infer<typeof CrewMember>;

export const CrewSummary = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['crew', 'classroom']),
  groupChannelId: z.string(),
  inviteCode: z.string(),
  role: CrewRoleSchema,
  memberCount: z.number().int(),
  createdAt: z.string(),
});
export type CrewSummary = z.infer<typeof CrewSummary>;

/** A game made in a crew (planning until approved; then it has a game room). */
export const GameSummary = z.object({
  id: z.string(),
  crewId: z.string(),
  slug: z.string(),
  title: z.string(),
  status: z.enum(GAME_STATUSES),
  language: z.string(),
  /** Nexconn group channel of the game room (null until the plan is approved). */
  roomChannelId: z.string().nullable(),
  remixOfGameId: z.string().nullable(),
  createdAt: z.string(),
});
export type GameSummary = z.infer<typeof GameSummary>;

export const CrewDetail = CrewSummary.extend({ ownerId: z.string(), members: z.array(CrewMember), games: z.array(GameSummary).default([]) });
export type CrewDetail = z.infer<typeof CrewDetail>;

export const CrewName = z
  .string()
  .transform(s => s.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(2, 'Use at least 2 characters').max(LIMITS.crewNameChars, `Use at most ${LIMITS.crewNameChars} characters`));

export const CreateCrewBody = z.object({ name: CrewName, kind: z.enum(['crew', 'classroom']).default('crew') });
export type CreateCrewBody = z.input<typeof CreateCrewBody>;

export const SetRoleBody = z.object({ role: z.enum(['approver', 'member']) });

/** Public invite preview: enough for the join screen, nothing else. */
export const InvitePreview = z.object({
  crewId: z.string(),
  name: z.string(),
  memberCount: z.number().int(),
  members: z.array(
    z.object({
      displayName: z.string(),
      avatarEmoji: z.string(),
      avatarColor: z.string(),
      avatarUrl: z.string().nullable(),
      isAgent: z.boolean(),
      agent: z.enum(['pixel', 'forge', 'glitch']).nullable(),
    }),
  ),
  /** Present when the caller is signed in. */
  alreadyMember: z.boolean(),
  full: z.boolean(),
});
export type InvitePreview = z.infer<typeof InvitePreview>;

export const InviteCode = z.string().regex(/^[2-9A-HJ-NP-Z]{8}$/);

/** GET /api/rooms/:channelId: which crew (and game) a Nexconn channel belongs to. */
export const RoomInfo = z.object({
  channelId: z.string(),
  kind: z.enum(['crew', 'game']),
  crewId: z.string(),
  game: GameSummary.nullable(),
});
export type RoomInfo = z.infer<typeof RoomInfo>;

// ---- card actions (the server checks every permission; the card itself is never trusted)

export const VoteBody = z.object({ vote: z.enum(['yes', 'no']) });
export type VoteBody = z.infer<typeof VoteBody>;
export const ChangeRequestBody = z.object({
  text: z
    .string()
    .transform(s => s.trim())
    .pipe(z.string().min(3, 'Say what to change').max(LIMITS.pitchChars)),
});
export type ChangeRequestBody = z.input<typeof ChangeRequestBody>;
/** Allow / Block on a publish request card (owner or approver only, checked on the server). */
export const PublishDecisionBody = z.object({ decision: z.enum(['allow', 'block']) });
export type PublishDecisionBody = z.infer<typeof PublishDecisionBody>;
/** The card's metadata after the action (what every client will also receive live). */
export const CardActionResponse = z.object({ messageId: z.string(), metadata: z.record(z.string(), z.string()) });
export type CardActionResponse = z.infer<typeof CardActionResponse>;

// ---- Decision Ledger

export const LedgerEntry = z.object({
  id: z.string(),
  gameId: z.string().nullable(),
  crewId: z.string().nullable(),
  actorType: z.enum(['agent', 'human', 'system']),
  actorId: z.string(),
  actorName: z.string(),
  action: z.string(),
  summary: z.string(),
  /** Redacted (long strings shortened) for display. */
  input: z.unknown().nullable(),
  output: z.unknown().nullable(),
  reason: z.string().nullable(),
  tokensIn: z.number().int(),
  tokensOut: z.number().int(),
  costUsd: z.number(),
  ms: z.number().int().nullable(),
  createdAt: z.string(),
});
export type LedgerEntry = z.infer<typeof LedgerEntry>;
export const LedgerResponse = z.object({
  game: GameSummary.nullable(),
  entries: z.array(LedgerEntry),
  totals: z.object({ tokensIn: z.number().int(), tokensOut: z.number().int(), costUsd: z.number(), agentMs: z.number().int() }),
});
export type LedgerResponse = z.infer<typeof LedgerResponse>;

export const ApiError = z.object({ error: z.string(), message: z.string() });
export type ApiError = z.infer<typeof ApiError>;
