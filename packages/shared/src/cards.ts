// Every chat card is its own Nexconn custom message type (CA:PlanCard, CA:HandoffCard, ...), so the
// client can register each one and old clients ignore types they do not know. Content is JSON with
// a `v` field (schema version); live state that changes after sending (votes, approval, status)
// lives in Nexconn message metadata (string key/values), so clients update in place via
// onMessageMetadataUpdated. Cards are posted by the server only (hasMetadata: true). docs/SPEC.md §5.
import { z } from 'zod';
import { LANGUAGE_CODES, LIMITS } from './constants';

const id = z.string().min(1).max(64);
const url = z.string().url().max(1024);
const agentKey = z.enum(['pixel', 'forge', 'glitch']);
const version = z.number().int().min(1);
const line = z.string().min(1).max(300);
const v1 = z.literal(1);

export const CARD_MESSAGE_TYPES = {
  plan: 'CA:PlanCard',
  handoff: 'CA:HandoffCard',
  build: 'CA:BuildCard',
  test: 'CA:TestCard',
  publish: 'CA:PublishCard',
  bug: 'CA:BugCard',
  score: 'CA:ScoreCard',
  roomLink: 'CA:RoomLink',
} as const;
export type CardKind = keyof typeof CARD_MESSAGE_TYPES;
export type CardMessageType = (typeof CARD_MESSAGE_TYPES)[CardKind];

export const AcceptanceItem = z.object({ id: z.string().regex(/^A\d{1,2}$/), text: z.string().min(5).max(300) });
export type AcceptanceItem = z.infer<typeof AcceptanceItem>;

// ---- content schemas -----------------------------------------------------------------------

export const PlanCardContent = z.object({
  v: v1,
  gameId: id,
  /** Plan version: 1, then +1 for every revision Pixel posts after a change request. */
  version,
  title: z.string().min(2).max(40),
  slug: z.string().min(3).max(30),
  pitch: z.string().min(10).max(200),
  controls: z.object({ keyboard: z.string().min(3).max(200), touch: z.string().min(3).max(200) }),
  coreLoop: z.string().min(10).max(800),
  winLose: z.string().min(5).max(400),
  scoring: z.string().min(5).max(400),
  lookAndFeel: z.string().min(5).max(600),
  sound: z.string().min(3).max(400),
  /** 4-8 items, each checkable through window.__crew.state(). */
  acceptance: z.array(AcceptanceItem).min(4).max(8),
  /** Language of the game screens (the pitch language). */
  language: z.enum(LANGUAGE_CODES),
  credits: z.array(z.string().max(64)).max(20),
  /** Title of the game this remixes. */
  remixOf: z.string().max(40).optional(),
});
export type PlanCardContent = z.infer<typeof PlanCardContent>;

export const HandoffCardContent = z.object({
  v: v1,
  gameId: id,
  from: agentKey,
  to: agentKey,
  /** What the receiving agent should do, e.g. "Build v1 from this plan". */
  task: line,
  contextSummary: z.string().min(1).max(600),
  artifacts: z.array(z.object({ kind: z.enum(['plan', 'build', 'scenario', 'gif', 'bug']), label: z.string().max(80), ref: z.string().max(200) })).max(6),
});
export type HandoffCardContent = z.infer<typeof HandoffCardContent>;

export const BuildCardContent = z.object({
  v: v1,
  gameId: id,
  version,
  playUrl: url,
  sizeKb: z
    .number()
    .min(0)
    .max(LIMITS.gameBytes / 1024),
  buildMs: z.number().int().min(0),
  notes: z.array(line).max(6),
  checks: z.object({ pass: z.boolean(), problems: z.array(z.string().max(300)).max(10) }),
});
export type BuildCardContent = z.infer<typeof BuildCardContent>;

export const TestCardContent = z.object({
  v: v1,
  gameId: id,
  version,
  pass: z.boolean(),
  passed: z.number().int().min(0),
  total: z.number().int().min(0),
  fps: z.number().min(0),
  gifUrl: url.optional(),
  screenshotUrl: url.optional(),
  failures: z.array(z.object({ label: z.string().max(200), detail: z.string().max(300) })).max(10),
  regressions: z.array(z.object({ label: z.string().max(200), detail: z.string().max(300) })).max(10),
});
export type TestCardContent = z.infer<typeof TestCardContent>;

export const PublishCardContent = z.object({ v: v1, gameId: id, version, arcadeUrl: url });
export type PublishCardContent = z.infer<typeof PublishCardContent>;

export const BugCardContent = z.object({
  v: v1,
  bugId: id,
  gameId: id,
  reporterId: id,
  description: z.string().min(3).max(1000),
  screenshotUrl: url.optional(),
});
export type BugCardContent = z.infer<typeof BugCardContent>;

export const ScoreCardContent = z.object({
  v: v1,
  gameId: id,
  playerId: id,
  score: z.number().int(),
  rank: z.number().int().min(1),
  beatPlayerId: id.optional(),
});
export type ScoreCardContent = z.infer<typeof ScoreCardContent>;

export const RoomLinkContent = z.object({ v: v1, channelId: id, gameId: id, title: z.string().min(1).max(60), kind: z.enum(['game', 'live']) });
export type RoomLinkContent = z.infer<typeof RoomLinkContent>;

// ---- metadata schemas (Nexconn metadata values are strings) ----------------------------------

const count = z.coerce.number().int().min(0).catch(0);
const jsonRecord = <V extends z.ZodType>(value: V) =>
  z
    .string()
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'not JSON' });
        return z.NEVER;
      }
    })
    .pipe(z.record(z.string(), value))
    .catch({});

export const PLAN_STATUSES = ['pending', 'approved', 'changes_requested', 'superseded'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export const PlanCardMeta = z.object({
  status: z.enum(PLAN_STATUSES).catch('pending'),
  yes: count.default(0),
  no: count.default(0),
  /** JSON {nexconnUserId: "yes" | "no"}. */
  voters: jsonRecord(z.enum(['yes', 'no'])).default({}),
  /** Display name of the approver. */
  approvedBy: z.string().max(64).optional(),
  /** messageId of the revised plan that replaced this one. */
  supersededBy: z.string().max(64).optional(),
  /** Game room created on approval. */
  roomChannelId: z.string().max(64).optional(),
});
export type PlanCardMeta = z.infer<typeof PlanCardMeta>;

export const HandoffCardMeta = z.object({ status: z.enum(['waiting', 'started', 'done']).catch('waiting') });
export const BuildCardMeta = z.object({ status: z.enum(['building', 'ready', 'failed']).catch('building') });
export const TestCardMeta = z.object({ status: z.enum(['running', 'done']).catch('running') });
export const PublishCardMeta = z.object({
  status: z.enum(['waiting', 'approved', 'rejected']).catch('waiting'),
  decidedBy: z.string().max(64).optional(),
  decidedAt: z.string().max(40).optional(),
});
export const BugCardMeta = z.object({
  status: z.enum(['open', 'reproduced', 'not_reproduced', 'fixed']).catch('open'),
  reproClipUrl: z.string().max(1024).optional(),
  fixedInVersion: z.coerce.number().int().optional().catch(undefined),
});
const NoMeta = z.object({});

export const CARD_SCHEMAS = {
  plan: { content: PlanCardContent, meta: PlanCardMeta },
  handoff: { content: HandoffCardContent, meta: HandoffCardMeta },
  build: { content: BuildCardContent, meta: BuildCardMeta },
  test: { content: TestCardContent, meta: TestCardMeta },
  publish: { content: PublishCardContent, meta: PublishCardMeta },
  bug: { content: BugCardContent, meta: BugCardMeta },
  score: { content: ScoreCardContent, meta: NoMeta },
  roomLink: { content: RoomLinkContent, meta: NoMeta },
} as const;

export type CardContent<K extends CardKind> = z.infer<(typeof CARD_SCHEMAS)[K]['content']>;
export type CardMeta<K extends CardKind> = z.infer<(typeof CARD_SCHEMAS)[K]['meta']>;
/** A decoded card: kind + typed content. */
export type AnyCard = { [K in CardKind]: { kind: K; content: CardContent<K> } }[CardKind];

const KIND_BY_TYPE: ReadonlyMap<string, CardKind> = new Map(Object.entries(CARD_MESSAGE_TYPES).map(([k, t]) => [t, k as CardKind]));
export const cardKindOf = (messageType: string): CardKind | null => KIND_BY_TYPE.get(messageType) ?? null;
export const isCardType = (messageType: string): messageType is CardMessageType => KIND_BY_TYPE.has(messageType);

/** Validates and serializes card content for Nexconn (content must stay <= 10 KB). */
export function encodeCard<K extends CardKind>(kind: K, content: z.input<(typeof CARD_SCHEMAS)[K]['content']>): string {
  const json = JSON.stringify(CARD_SCHEMAS[kind].content.parse(content));
  if (new TextEncoder().encode(json).length > LIMITS.messageContentBytes) throw new Error('Card content exceeds the 10 KB Nexconn limit');
  return json;
}

/** Parses card content from Nexconn (JSON string or object). null for unknown types or invalid content. */
export function decodeCard(messageType: string, content: unknown): AnyCard | null {
  const kind = cardKindOf(messageType);
  if (!kind) return null;
  let value = content;
  if (typeof content === 'string') {
    try {
      value = JSON.parse(content);
    } catch {
      return null;
    }
  }
  const res = CARD_SCHEMAS[kind].content.safeParse(value);
  return res.success ? ({ kind, content: res.data } as AnyCard) : null;
}

/** Parses card metadata (never throws: unknown or broken values fall back to defaults). */
export function parseCardMeta<K extends CardKind>(kind: K, metadata: Record<string, string> | Map<string, string> | undefined | null): CardMeta<K> {
  const raw = metadata instanceof Map ? Object.fromEntries(metadata) : (metadata ?? {});
  return CARD_SCHEMAS[kind].meta.parse(raw) as CardMeta<K>;
}

/** Serializes a metadata patch: every value becomes a string; undefined keys are dropped. */
export function metaToStrings(patch: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null) continue;
    if (!META_KEY_RE.test(k)) throw new Error(`invalid metadata key ${k}`);
    const s = typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (s.length > LIMITS.metadataValueChars) throw new Error(`metadata value for ${k} is too long`);
    out[k] = s;
  }
  return out;
}

/** Nexconn: metadata keys are <= 32 chars of letters, digits and + = - _. */
export const META_KEY_RE = /^[A-Za-z0-9+=\-_]{1,32}$/;

/** Applies one vote to a voters map (pure). A second identical vote is a no-op; a different one switches. */
export function applyVote(
  voters: Record<string, 'yes' | 'no'>,
  voterId: string,
  vote: 'yes' | 'no',
): { voters: Record<string, 'yes' | 'no'>; yes: number; no: number } {
  const next = { ...voters, [voterId]: vote };
  const values = Object.values(next);
  return { voters: next, yes: values.filter(v => v === 'yes').length, no: values.filter(v => v === 'no').length };
}

/** One-line description of a card for previews and push text. */
export function cardPreview(card: AnyCard): string {
  switch (card.kind) {
    case 'plan':
      return `🗺️ Plan: ${card.content.title}`;
    case 'handoff':
      return `🤝 Handoff: ${card.content.task}`;
    case 'build':
      return `🔨 Build v${card.content.version}`;
    case 'test':
      return `🧪 Playtest v${card.content.version}: ${card.content.pass ? 'PASS' : 'FAIL'}`;
    case 'publish':
      return `🚀 Publish request v${card.content.version}`;
    case 'bug':
      return `🐞 Bug: ${card.content.description.slice(0, 60)}`;
    case 'score':
      return `🏆 New score: ${card.content.score}`;
    case 'roomLink':
      return `🎮 ${card.content.title}`;
  }
}
