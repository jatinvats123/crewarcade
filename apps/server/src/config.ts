// Server configuration, validated by zod at startup. Fails fast with a readable list of problems.
// Service keys are optional in development/test (so /health works before accounts exist) and
// required in production. Every variable is documented in apps/server/.env.example.
import { z } from 'zod';

// Boolean switches. An empty value (e.g. COOKIE_SECURE= copied from .env.example) means "not set", so
// the default applies (zod's .default() only fires for undefined, so the default lives in here).
const bool = <D extends boolean | undefined>(def: D) =>
  z
    .preprocess(v => (v === '' ? undefined : v), z.enum(['true', 'false', '1', '0']).optional())
    .transform(v => (v === undefined ? def : v === 'true' || v === '1'));

const optionalSecret = z
  .string()
  .trim()
  .min(1)
  .optional()
  .or(z.literal('').transform(() => undefined));

const BaseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** Supabase Postgres connection string (transaction pooler, port 6543, recommended on Render). */
  DATABASE_URL: z
    .string()
    .url()
    .refine(u => /^postgres(ql)?:\/\//.test(u), 'must be a postgres:// URL'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),

  /** The web app origin (CORS allow-list, agent avatar URLs, share links). */
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  /** This server's public origin (webhook URLs shown in logs, game asset URLs). */
  PUBLIC_API_ORIGIN: z.string().url().default('http://localhost:8080'),

  NEXCONN_APP_KEY: optionalSecret,
  NEXCONN_APP_SECRET: optionalSecret,
  NEXCONN_API_BASE: z.string().url().default('https://api.sg-light-api.com'),
  NEXCONN_API_BACKUP: z.string().url().default('https://api-b.sg-light-api.com'),

  SUPABASE_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  SUPABASE_SERVICE_ROLE_KEY: optionalSecret,
  /** Private Storage bucket for game HTML (served only through GET /play). */
  SUPABASE_GAMES_BUCKET: z.string().min(3).max(63).default('games'),
  /** Development only: where game HTML is kept when Supabase Storage is not configured. Production
   *  refuses this (Render's disk is wiped on every deploy). */
  GAMES_LOCAL_DIR: z.string().min(1).default('.data/games'),
  /** Public bucket for Glitch's GIFs and screenshots (served through GET /clips too). */
  SUPABASE_CLIPS_BUCKET: z.string().min(3).max(63).default('clips'),
  CLIPS_LOCAL_DIR: z.string().min(1).default('.data/clips'),

  ANTHROPIC_API_KEY: optionalSecret,
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
  /** Model for Forge's game building (the heaviest call). */
  ANTHROPIC_BUILD_MODEL: z.preprocess(v => (v === '' ? undefined : v), z.string().default('claude-opus-5-5')),
  /** Which AI runs the agents: anthropic (Claude) or gemini (Google AI Studio key; free tier). */
  AI_PROVIDER: z.preprocess(v => (v === '' ? undefined : v), z.enum(['anthropic', 'gemini']).default('anthropic')),
  GEMINI_API_KEY: optionalSecret,
  GEMINI_MODEL: z.preprocess(v => (v === '' ? undefined : v), z.string().default('gemini-3.5-flash-lite')),
  /** Forge builds whole games: a stronger model than the cheap chat/classification one. */
  GEMINI_BUILD_MODEL: z.preprocess(v => (v === '' ? undefined : v), z.string().default('gemini-3.5-flash')),

  SARVAM_API_KEY: optionalSecret,

  /** 32 random bytes, base64: encrypts Nexconn access tokens at rest (users.nexconn_token_encrypted). */
  TOKEN_ENCRYPTION_KEY: optionalSecret.refine(v => v === undefined || Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded'),

  /** Signs session cookies (HS256 JWT). At least 32 characters. Required in production. */
  SESSION_SECRET: optionalSecret.refine(v => v === undefined || v.length >= 32, 'must be at least 32 characters'),
  /** Secure flag on the session cookie. Defaults to true in production. */
  COOKIE_SECURE: bool(undefined).optional(),
  /** Webhooks whose Timestamp header is further than this from now are rejected: the Nexconn
   *  signature does not cover the body, so a fresh timestamp is what stops replayed headers. */
  WEBHOOK_MAX_SKEW_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .default(10 * 60 * 1000),

  /** Global daily AI spend guard in USD (builds stop for the day when reached). */
  DAILY_BUDGET_USD: z.coerce.number().min(0).default(25),
  /** Run the pg-boss job workers in this process (one Render service runs API + workers). */
  RUN_WORKERS: bool(true),
  /** pg-boss needs session-level features: use a direct or session-pooler URL (Supabase port 5432)
   *  here when DATABASE_URL is the transaction pooler (port 6543). Defaults to DATABASE_URL. */
  JOBS_DATABASE_URL: z
    .string()
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** Agent jobs run at once per process (one per room at a time on top of this). */
  AGENT_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),
  /** Deterministic canned agent outputs with realistic delays (e2e tests, demo safety net). */
  FAKE_AGENTS: bool(false),
  /** Per-call timeout for Claude requests. */
  AI_TIMEOUT_MS: z.coerce.number().int().min(5000).default(120_000),
  /** Forge plays each build for a few seconds in headless Chromium before posting it (catches dead games). */
  FORGE_SMOKE: bool(true),
  /** Per-call timeout for a Forge build (a whole game in one structured call). */
  BUILD_TIMEOUT_MS: z.coerce.number().int().min(10_000).default(240_000),

  /** Lifetime of a signed play URL for unpublished versions (crew members only). */
  PLAY_TOKEN_TTL_SEC: z.coerce.number().int().min(60).max(86_400).default(1800),
  /** Score plausibility: highest accepted score, and the shortest accepted run. */
  SCORE_MAX: z.coerce.number().int().min(1).default(1_000_000),
  SCORE_MIN_TIME_MS: z.coerce.number().int().min(0).default(1000),
});

export const ConfigSchema = BaseSchema.superRefine((c, ctx) => {
  if (c.NODE_ENV !== 'production') return;
  for (const key of ['NEXCONN_APP_KEY', 'NEXCONN_APP_SECRET', 'TOKEN_ENCRYPTION_KEY', 'SESSION_SECRET'] as const) {
    if (!c[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'is required in production' });
  }
  // Game HTML must live in Supabase Storage: the local-disk store is for development only, because
  // Render's disk is wiped on every deploy.
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const) {
    if (!c[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'is required in production (Supabase Storage keeps the games; local disk is dev-only)' });
  }
  // The fake agents need no key; real ones do.
  if (!c.FAKE_AGENTS && c.AI_PROVIDER === 'anthropic' && !c.ANTHROPIC_API_KEY)
    ctx.addIssue({ code: 'custom', path: ['ANTHROPIC_API_KEY'], message: 'is required in production (or set FAKE_AGENTS=1 or AI_PROVIDER=gemini)' });
  if (!c.FAKE_AGENTS && c.AI_PROVIDER === 'gemini' && !c.GEMINI_API_KEY)
    ctx.addIssue({ code: 'custom', path: ['GEMINI_API_KEY'], message: 'is required when AI_PROVIDER=gemini' });
});

export type Config = z.infer<typeof ConfigSchema>;

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid server configuration:\n${problems.map(p => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

function parse<S extends z.ZodType>(schema: S, env: Record<string, string | undefined>): z.infer<S> {
  const res = schema.safeParse(env);
  if (!res.success) throw new ConfigError(res.error.issues.map(i => `${i.path.join('.') || 'env'} ${i.message}`));
  return res.data;
}

/** Parses env (default process.env). Throws ConfigError listing every problem at once. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return parse(ConfigSchema, env);
}

/** What the migrate and seed scripts need: the database and the web origin, nothing else. They run
 *  as Render's pre-deploy step, where requiring the AI and chat keys would only get in the way. */
export const DbScriptConfigSchema = BaseSchema.pick({ DATABASE_URL: true, WEB_ORIGIN: true });
export type DbScriptConfig = z.infer<typeof DbScriptConfigSchema>;
export const loadDbScriptConfig = (env: Record<string, string | undefined> = process.env): DbScriptConfig => parse(DbScriptConfigSchema, env);

/** Which optional integrations are configured (logged at startup, never the values). */
export function integrations(c: Config): Record<string, boolean> {
  return {
    nexconn: !!(c.NEXCONN_APP_KEY && c.NEXCONN_APP_SECRET),
    supabaseStorage: !!(c.SUPABASE_URL && c.SUPABASE_SERVICE_ROLE_KEY),
    anthropic: !!c.ANTHROPIC_API_KEY,
    gemini: !!c.GEMINI_API_KEY,
    fakeAgents: c.FAKE_AGENTS,
    sarvam: !!c.SARVAM_API_KEY,
    tokenEncryption: !!c.TOKEN_ENCRYPTION_KEY,
    sessionSecret: !!c.SESSION_SECRET,
  };
}

/** Dev-only session secret so local sessions survive restarts. Never used when NODE_ENV=production
 *  (the config refuses to load without SESSION_SECRET there). */
export const DEV_SESSION_SECRET = 'crewarcade-dev-only-session-secret-not-for-production';
export function sessionSecret(c: Pick<Config, 'SESSION_SECRET' | 'NODE_ENV'>): string {
  if (c.SESSION_SECRET) return c.SESSION_SECRET;
  if (c.NODE_ENV === 'production') throw new Error('SESSION_SECRET is required in production');
  return DEV_SESSION_SECRET;
}
export const cookieSecure = (c: Pick<Config, 'COOKIE_SECURE' | 'NODE_ENV'>): boolean => c.COOKIE_SECURE ?? c.NODE_ENV === 'production';
