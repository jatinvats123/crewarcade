// HTTP API contract between the web app and the server (zod at both ends). The browser only ever
// talks to its own origin; /api/* is proxied to the server (docs/SPEC.md "Sessions and the API proxy").
import { z } from 'zod';
import { CREW_ROLES, LANGUAGE_CODES, LIMITS } from './constants';

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

export const CrewDetail = CrewSummary.extend({ ownerId: z.string(), members: z.array(CrewMember) });
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

export const ApiError = z.object({ error: z.string(), message: z.string() });
export type ApiError = z.infer<typeof ApiError>;
