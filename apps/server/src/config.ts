// Server configuration, validated by zod at startup. Fails fast with a readable list of problems.
// Service keys are optional in development/test (so /health works before accounts exist) and
// required in production. Every variable is documented in apps/server/.env.example.
import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform(v => v === 'true' || v === '1');

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

  ANTHROPIC_API_KEY: optionalSecret,
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),

  SARVAM_API_KEY: optionalSecret,

  /** 32 random bytes, base64: encrypts Nexconn access tokens at rest (users.nexconn_token_encrypted). */
  TOKEN_ENCRYPTION_KEY: optionalSecret.refine(v => v === undefined || Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64-encoded'),

  /** Signs session cookies (HS256 JWT). At least 32 characters. Required in production. */
  SESSION_SECRET: optionalSecret.refine(v => v === undefined || v.length >= 32, 'must be at least 32 characters'),
  /** Secure flag on the session cookie. Defaults to true in production. */
  COOKIE_SECURE: bool.optional(),
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
  RUN_WORKERS: bool.default(true),
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
  FAKE_AGENTS: bool.default(false),
  /** Per-call timeout for Claude requests. */
  AI_TIMEOUT_MS: z.coerce.number().int().min(5000).default(120_000),
});

export const ConfigSchema = BaseSchema.superRefine((c, ctx) => {
  if (c.NODE_ENV !== 'production') return;
  for (const key of ['NEXCONN_APP_KEY', 'NEXCONN_APP_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'TOKEN_ENCRYPTION_KEY', 'SESSION_SECRET'] as const) {
    if (!c[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'is required in production' });
  }
  // The fake agents need no key; real ones do.
  if (!c.ANTHROPIC_API_KEY && !c.FAKE_AGENTS)
    ctx.addIssue({ code: 'custom', path: ['ANTHROPIC_API_KEY'], message: 'is required in production (or set FAKE_AGENTS=1)' });
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
