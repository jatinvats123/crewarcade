// Zod schemas for every chat card. A card is a Nexconn custom message of type CA:Card whose content
// is a CardEnvelope. Live state that changes after sending (votes, approval, status) lives in
// Nexconn message metadata (keys below), so clients update in place via onMessageMetadataUpdated.
// Card catalogue and flows: docs/SPEC.md.
import { z } from 'zod';
import { AGENT_ID_LIST, LANGUAGE_CODES, LIMITS } from './constants';

const id = z.string().min(1).max(64);
const url = z.string().url().max(1024);
const agentId = z.enum(AGENT_ID_LIST as [string, ...string[]]);
const version = z.number().int().min(1);
const shortText = z.string().min(1).max(300);

export const PitchCard = z.object({
  card: z.literal('pitch'),
  text: z.string().min(3).max(LIMITS.pitchChars),
  language: z.enum(LANGUAGE_CODES).default('en'),
});

export const PlanCard = z.object({
  card: z.literal('plan'),
  gameId: id,
  title: z.string().min(2).max(40),
  pitch: z.string().min(10).max(200),
  /** 3-6 short bullets: controls, core loop, scoring, look. */
  highlights: z.array(shortText).min(1).max(6),
  acceptance: z
    .array(z.object({ id: z.string().regex(/^A\d{1,2}$/), text: shortText }))
    .min(4)
    .max(8),
  credits: z.array(z.string().max(64)).max(20),
  remixOf: id.optional(),
  /** Votes needed before an approver can approve. */
  quorum: z.number().int().min(1).max(30),
});

export const HandoffCard = z.object({
  card: z.literal('handoff'),
  from: agentId,
  to: agentId,
  gameId: id,
  version: version.optional(),
  /** Why the work moves on, e.g. "plan approved by 2 of 3". */
  reason: shortText,
});

export const BuildReadyCard = z.object({
  card: z.literal('build_ready'),
  gameId: id,
  version,
  sizeBytes: z.number().int().min(0).max(LIMITS.gameBytes),
  buildMs: z.number().int().min(0),
  notes: z.array(shortText).max(6),
  check: z.object({ pass: z.boolean(), problems: z.array(z.string().max(300)).max(10) }),
});

export const PlaytestCard = z.object({
  card: z.literal('playtest'),
  gameId: id,
  version,
  pass: z.boolean(),
  passed: z.number().int().min(0),
  total: z.number().int().min(0),
  fps: z.number().min(0),
  expects: z.array(z.object({ label: z.string().max(200), pass: z.boolean() })).max(40),
  failed: z.array(z.object({ name: z.string().max(200), detail: z.string().max(300) })).max(10),
  gifUrl: url.optional(),
  screenshotUrl: url.optional(),
});

export const BugReportCard = z.object({
  card: z.literal('bug_report'),
  gameId: id,
  bugId: id,
  version,
  description: z.string().min(3).max(1000),
  screenshotUrl: url.optional(),
});

export const ReproCard = z.object({
  card: z.literal('repro'),
  gameId: id,
  bugId: id,
  version,
  /** true: the saved repro FAILS on this version (bug confirmed on camera). */
  reproduced: z.boolean(),
  checkLabel: z.string().max(200),
  gifUrl: url.optional(),
});

export const HotfixCard = z.object({
  card: z.literal('hotfix'),
  gameId: id,
  bugId: id,
  fromVersion: version,
  toVersion: version,
  pass: z.boolean(),
  /** Side-by-side GIF: same moves on the old and new version. */
  fixGifUrl: url.optional(),
});

export const PublishRequestCard = z.object({
  card: z.literal('publish_request'),
  gameId: id,
  version,
  title: z.string().max(40),
  playUrl: url,
  gifUrl: url.optional(),
  /** Crew members allowed to tap Allow (owner + approvers). */
  approverIds: z.array(id).min(1).max(30),
});

export const PublishedCard = z.object({
  card: z.literal('published'),
  gameId: id,
  slug: z.string().max(30),
  version,
  arcadeUrl: url,
});

export const GameRoomCard = z.object({
  card: z.literal('game_room'),
  gameId: id,
  roomChannelId: id,
  title: z.string().max(40),
});

export const LiveBuildCard = z.object({
  card: z.literal('live_build'),
  gameId: id,
  openChannelId: id,
  watchUrl: url,
});

export const ShieldCard = z.object({
  card: z.literal('shield'),
  /** Which rule fired: prompt-injection, unsafe content, spam, secret leak... */
  rule: z.string().max(64),
  action: z.enum(['blocked', 'masked', 'flagged']),
  /** What we tell the crew (never the blocked content itself). */
  summary: shortText,
});

export const LeaderboardCard = z.object({
  card: z.literal('leaderboard'),
  gameId: id,
  version,
  top: z.array(z.object({ userId: id, displayName: z.string().max(64), score: z.number().int(), rank: z.number().int().min(1) })).max(10),
});

export const CardPayload = z.discriminatedUnion('card', [
  PitchCard,
  PlanCard,
  HandoffCard,
  BuildReadyCard,
  PlaytestCard,
  BugReportCard,
  ReproCard,
  HotfixCard,
  PublishRequestCard,
  PublishedCard,
  GameRoomCard,
  LiveBuildCard,
  ShieldCard,
  LeaderboardCard,
]);
export type CardPayload = z.infer<typeof CardPayload>;
export type CardType = CardPayload['card'];
export const CARD_TYPES = CardPayload.options.map(o => o.shape.card.value) as CardType[];

/** Content of a CA:Card message. `v` lets old clients ignore cards they do not understand. */
export const CardEnvelope = z.object({
  v: z.literal(1),
  payload: CardPayload,
});
export type CardEnvelope = z.infer<typeof CardEnvelope>;

/** Validates and serializes a card for Nexconn (content must stay <= 10 KB). */
export function encodeCard(payload: CardPayload): string {
  const json = JSON.stringify(CardEnvelope.parse({ v: 1, payload }));
  if (new TextEncoder().encode(json).length > LIMITS.messageContentBytes) throw new Error('Card content exceeds the 10 KB Nexconn limit');
  return json;
}

/** Parses card content from Nexconn (string or object). Returns null for anything invalid. */
export function decodeCard(content: unknown): CardEnvelope | null {
  let value = content;
  if (typeof content === 'string') {
    try {
      value = JSON.parse(content);
    } catch {
      return null;
    }
  }
  const res = CardEnvelope.safeParse(value);
  return res.success ? res.data : null;
}

// ---- message metadata keys (Nexconn: <= 32 chars of letters, digits, + = - _)

export const META = {
  /** Card lifecycle: e.g. plan voting|approved|rejected, publish pending|approved|blocked. */
  status: 'status',
  /** Who changed the status last. */
  actor: 'actor',
  /** One key per voter: vote_<userId> = "yes" | "no". */
  vote: (userId: string) => `vote_${userId}`,
} as const;
export const META_KEY_RE = /^[A-Za-z0-9+=\-_]{1,32}$/;

export const CardStatus = z.enum(['open', 'voting', 'approved', 'rejected', 'pending', 'blocked', 'done', 'failed']);
export type CardStatus = z.infer<typeof CardStatus>;

/** Tally of vote_* metadata keys. */
export function tallyVotes(metadata: Record<string, string>): { yes: string[]; no: string[] } {
  const yes: string[] = [];
  const no: string[] = [];
  for (const [k, v] of Object.entries(metadata)) {
    if (!k.startsWith('vote_')) continue;
    if (v === 'yes') yes.push(k.slice(5));
    else if (v === 'no') no.push(k.slice(5));
  }
  return { yes, no };
}
