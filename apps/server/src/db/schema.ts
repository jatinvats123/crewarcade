// Drizzle schema (Supabase Postgres). IDs are non-sequential nanoid strings minted by
// @crewarcade/shared newId(); timestamps are timestamptz. Column names are snake_case in SQL
// (drizzle `casing: 'snake_case'`). Data model reference: docs/SPEC.md#data-model.
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, type AnyPgColumn } from 'drizzle-orm/pg-core';

const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const ts = () => timestamp({ withTimezone: true });
const money = () => numeric({ precision: 12, scale: 6, mode: 'number' });
/** CHECK (col IN (...)) for enum-like text columns. */
const oneOf = (col: AnyPgColumn, values: readonly string[]) => sql`${col} in (${sql.raw(values.map(v => `'${v}'`).join(', '))})`;

export const users = pgTable('users', {
  id: text().primaryKey(),
  displayName: text().notNull(),
  avatarEmoji: text().notNull().default('🙂'),
  avatarColor: text().notNull().default('violet'),
  /** Image avatar (agents); humans use emoji + colour ring. */
  avatarUrl: text(),
  language: text().notNull().default('en'),
  autoTranslate: boolean().notNull().default(false),
  createdAt: createdAt(),
  lastSeenAt: ts(),
  /** AES-256-GCM ciphertext of the user's Nexconn access token (TOKEN_ENCRYPTION_KEY). */
  nexconnTokenEncrypted: text(),
  isAgent: boolean().notNull().default(false),
  isJudge: boolean().notNull().default(false),
});

export const CREW_KINDS = ['crew', 'classroom'] as const;
export const crews = pgTable(
  'crews',
  {
    id: text().primaryKey(),
    groupChannelId: text().notNull().unique(),
    name: text().notNull(),
    ownerId: text()
      .notNull()
      .references(() => users.id),
    inviteCode: text().notNull().unique(),
    kind: text({ enum: CREW_KINDS }).notNull().default('crew'),
    createdAt: createdAt(),
    settings: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  },
  t => [check('crews_kind_check', oneOf(t.kind, CREW_KINDS)), index('crews_owner_idx').on(t.ownerId)],
);

export const CREW_ROLES = ['owner', 'approver', 'member'] as const;
export const crewMembers = pgTable(
  'crew_members',
  {
    crewId: text()
      .notNull()
      .references(() => crews.id, { onDelete: 'cascade' }),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text({ enum: CREW_ROLES }).notNull().default('member'),
    joinedAt: createdAt(),
  },
  t => [
    primaryKey({ columns: [t.crewId, t.userId] }),
    check('crew_members_role_check', oneOf(t.role, CREW_ROLES)),
    index('crew_members_user_idx').on(t.userId),
  ],
);

export const GAME_STATUSES = ['planning', 'building', 'testing', 'awaiting_approval', 'published', 'failed', 'blocked'] as const;
export const games = pgTable(
  'games',
  {
    id: text().primaryKey(),
    slug: text().notNull().unique(),
    crewId: text()
      .notNull()
      .references(() => crews.id, { onDelete: 'cascade' }),
    /** Nexconn group channel of the game room (created when the plan is approved). */
    roomChannelId: text().unique(),
    title: text().notNull(),
    pitch: text().notNull(),
    status: text({ enum: GAME_STATUSES }).notNull().default('planning'),
    language: text().notNull().default('en'),
    remixOfGameId: text().references((): AnyPgColumn => games.id, { onDelete: 'set null' }),
    createdBy: text()
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    publishedVersion: integer(),
  },
  t => [
    check('games_status_check', oneOf(t.status, GAME_STATUSES)),
    check('games_slug_check', sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'`),
    index('games_crew_idx').on(t.crewId),
    index('games_published_idx').on(t.status, t.createdAt),
  ],
);

export const VERSION_STATUSES = ['building', 'check_failed', 'testing', 'passed', 'failed', 'published'] as const;
export const gameVersions = pgTable(
  'game_versions',
  {
    id: text().primaryKey(),
    gameId: text()
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    version: integer().notNull(),
    /** GameSpec JSON (@crewarcade/engine GameSpecSchema). */
    spec: jsonb().notNull(),
    /** Path in the private `games` bucket. */
    htmlPath: text(),
    sizeBytes: integer(),
    checkResult: jsonb(),
    scenario: jsonb(),
    playtest: jsonb(),
    /** Path in the public `clips` bucket. */
    gifPath: text(),
    screenshotPath: text(),
    buildMs: integer(),
    testMs: integer(),
    tokensIn: integer().notNull().default(0),
    tokensOut: integer().notNull().default(0),
    costUsd: money().notNull().default(0),
    status: text({ enum: VERSION_STATUSES }).notNull().default('building'),
    createdAt: createdAt(),
    publishedAt: ts(),
    notes: text()
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** The AI model that wrote this version (every build metric is labelled with it). */
    model: text(),
    /** Build details: {orientation, emoji, colors, attempts, reason, change, requestedBy}. */
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  },
  t => [
    uniqueIndex('game_versions_game_version_uq').on(t.gameId, t.version),
    check('game_versions_status_check', oneOf(t.status, VERSION_STATUSES)),
    check('game_versions_version_check', sql`${t.version} >= 1`),
  ],
);

export const BUG_STATUSES = ['open', 'reproduced', 'not_reproduced', 'fixed'] as const;
export const bugs = pgTable(
  'bugs',
  {
    id: text().primaryKey(),
    gameId: text()
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    reporterId: text()
      .notNull()
      .references(() => users.id),
    description: text().notNull(),
    /** Path in the private `uploads` bucket. */
    screenshotPath: text(),
    reproScenario: jsonb(),
    reproducedOnVersion: integer(),
    fixedInVersion: integer(),
    status: text({ enum: BUG_STATUSES }).notNull().default('open'),
    createdAt: createdAt(),
  },
  t => [check('bugs_status_check', oneOf(t.status, BUG_STATUSES)), index('bugs_game_idx').on(t.gameId, t.status)],
);

export const scores = pgTable(
  'scores',
  {
    id: text().primaryKey(),
    gameId: text()
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    version: integer().notNull(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    score: integer().notNull(),
    timeMs: integer().notNull(),
    createdAt: createdAt(),
  },
  t => [
    index('scores_game_score_idx').on(t.gameId, t.score.desc()),
    index('scores_user_idx').on(t.userId),
    index('scores_user_game_time_idx').on(t.userId, t.gameId, t.createdAt),
  ],
);

/** Throttle for Glitch's "you were beaten" DMs: one row per (winner, beaten player). */
export const challengeDms = pgTable(
  'challenge_dms',
  {
    winnerId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    beatenId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    gameId: text()
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    sentAt: ts().notNull(),
  },
  t => [primaryKey({ columns: [t.winnerId, t.beatenId] })],
);

/** Maps a Nexconn card message to the domain object it shows. */
export const cards = pgTable(
  'cards',
  {
    nexconnMessageId: text().primaryKey(),
    channelId: text().notNull(),
    cardType: text().notNull(),
    gameId: text().references(() => games.id, { onDelete: 'cascade' }),
    version: integer(),
    state: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  t => [index('cards_channel_idx').on(t.channelId, t.createdAt), index('cards_game_idx').on(t.gameId)],
);

export const ACTOR_TYPES = ['agent', 'human', 'system'] as const;
/** Audit trail: every agent step, human decision and safety action. */
export const ledger = pgTable(
  'ledger',
  {
    id: text().primaryKey(),
    gameId: text().references(() => games.id, { onDelete: 'cascade' }),
    crewId: text().references(() => crews.id, { onDelete: 'cascade' }),
    actorType: text({ enum: ACTOR_TYPES }).notNull(),
    actorId: text().notNull(),
    /** e.g. plan.created, handoff, build.ready, publish.approved, shield.blocked (docs/SPEC.md). */
    action: text().notNull(),
    summary: text().notNull(),
    input: jsonb(),
    output: jsonb(),
    reason: text(),
    tokensIn: integer().notNull().default(0),
    tokensOut: integer().notNull().default(0),
    costUsd: money().notNull().default(0),
    ms: integer(),
    createdAt: createdAt(),
  },
  t => [
    check('ledger_actor_type_check', oneOf(t.actorType, ACTOR_TYPES)),
    check('ledger_action_check', sql`${t.action} ~ '^[a-z_]+\\.[a-z_]+$' or ${t.action} = 'handoff'`),
    index('ledger_game_idx').on(t.gameId, t.createdAt),
    index('ledger_crew_idx').on(t.crewId, t.createdAt),
  ],
);

/** From the message:send webhook: agent context and stats. Rows older than 30 days are deleted. */
export const messagesLog = pgTable(
  'messages_log',
  {
    nexconnMessageId: text().primaryKey(),
    channelId: text().notNull(),
    channelType: integer().notNull(),
    fromUserId: text().notNull(),
    messageType: text().notNull(),
    text: text(),
    createdAt: createdAt(),
  },
  t => [index('messages_log_channel_idx').on(t.channelId, t.createdAt), index('messages_log_created_idx').on(t.createdAt)],
);

export const MODERATION_ACTIONS = ['blocked', 'masked', 'flagged'] as const;
export const moderationLog = pgTable(
  'moderation_log',
  {
    id: text().primaryKey(),
    channelId: text().notNull(),
    userId: text().notNull(),
    rule: text().notNull(),
    action: text({ enum: MODERATION_ACTIONS }).notNull(),
    /** Short, already-masked excerpt (never the full blocked content). */
    excerpt: text(),
    createdAt: createdAt(),
  },
  t => [check('moderation_log_action_check', oneOf(t.action, MODERATION_ACTIONS)), index('moderation_log_channel_idx').on(t.channelId, t.createdAt)],
);

/** From user:connection_status. The webhook event id is the key, so retries are idempotent. */
export const connections = pgTable(
  'connections',
  {
    eventId: text().primaryKey(),
    userId: text().notNull(),
    /** Nexconn status: "0" connected, "1" disconnected, "2" logged out. */
    status: text().notNull(),
    os: text(),
    at: ts().notNull(),
  },
  t => [index('connections_user_idx').on(t.userId, t.at), index('connections_at_idx').on(t.at)],
);

/** Daily credits and the budget guard. */
export const usage = pgTable(
  'usage',
  {
    day: date({ mode: 'string' }).notNull(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    builds: integer().notNull().default(0),
    translationsChars: integer().notNull().default(0),
    costUsd: money().notNull().default(0),
  },
  t => [primaryKey({ columns: [t.day, t.userId] })],
);

export const liveRooms = pgTable(
  'live_rooms',
  {
    openChannelId: text().primaryKey(),
    gameId: text()
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    startedAt: createdAt(),
    endedAt: ts(),
    peakViewers: integer().notNull().default(0),
  },
  t => [index('live_rooms_game_idx').on(t.gameId)],
);

/** Webhook dedupe: Nexconn retries up to 3 times, so each event id is processed once. */
export const webhookEvents = pgTable('webhook_events', {
  id: text().primaryKey(),
  type: text().notNull(),
  receivedAt: createdAt(),
});

export const schema = {
  users,
  crews,
  crewMembers,
  games,
  gameVersions,
  bugs,
  scores,
  challengeDms,
  cards,
  ledger,
  messagesLog,
  moderationLog,
  connections,
  usage,
  liveRooms,
  webhookEvents,
};
