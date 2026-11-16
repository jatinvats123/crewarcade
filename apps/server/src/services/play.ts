// Serving games safely (docs/SPEC.md §9.3). Games come from our server only, never from Storage
// directly, with a strict CSP that blocks every network request, and run in the web player's
// sandboxed iframe (allow-scripts, never allow-same-origin). Unpublished versions need a short-lived
// signed token that only crew members can get; published versions are public and immutable.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { sessionSecret, type Config } from '../config';

/** Origins allowed to frame games: the web app (plus localhost outside production). */
export function frameAncestors(config: Pick<Config, 'WEB_ORIGIN' | 'NODE_ENV'>): string[] {
  const out = [new URL(config.WEB_ORIGIN).origin];
  if (config.NODE_ENV !== 'production') out.push('http://localhost:3000', 'http://127.0.0.1:3000');
  return [...new Set(out)];
}

export function gameCsp(ancestors: readonly string[]): string {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    'img-src data: blob:',
    'media-src data: blob:',
    'font-src data:',
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${ancestors.join(' ')}`,
  ].join('; ');
}

/** Every header a game response carries. `published` versions cache publicly forever. */
export function gameHeaders(o: { ancestors: readonly string[]; published: boolean }): Record<string, string> {
  return {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': gameCsp(o.ancestors),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'cross-origin-opener-policy': 'same-origin',
    // A version's HTML never changes once written (new builds get a new version number).
    'cache-control': o.published ? 'public, max-age=31536000, immutable' : 'private, max-age=600, immutable',
  };
}

// ---- signed play tokens -----------------------------------------------------------------------

const keyOf = (config: Pick<Config, 'SESSION_SECRET' | 'NODE_ENV'>) => createHmac('sha256', sessionSecret(config)).update('crewarcade:play-token:v1').digest();
const mac = (key: Buffer, slug: string, version: number, exp: number) => createHmac('sha256', key).update(`${slug}\n${version}\n${exp}`).digest('base64url');

/** "<exp>.<mac>": valid for one version of one game until exp (ms). */
export function signPlayToken(config: Pick<Config, 'SESSION_SECRET' | 'NODE_ENV'>, o: { slug: string; version: number; exp: number }): string {
  return `${o.exp}.${mac(keyOf(config), o.slug, o.version, o.exp)}`;
}

export function verifyPlayToken(
  config: Pick<Config, 'SESSION_SECRET' | 'NODE_ENV'>,
  token: string | undefined,
  o: { slug: string; version: number; now: number },
): boolean {
  if (!token || token.length > 200) return false;
  const m = /^(\d{10,16})\.([A-Za-z0-9_-]{20,64})$/.exec(token);
  if (!m) return false;
  const exp = Number(m[1]);
  if (!Number.isFinite(exp) || exp <= o.now) return false;
  const want = Buffer.from(mac(keyOf(config), o.slug, o.version, exp));
  const got = Buffer.from(m[2]!);
  return want.length === got.length && timingSafeEqual(want, got);
}

export function playUrl(
  config: Pick<Config, 'PUBLIC_API_ORIGIN' | 'SESSION_SECRET' | 'NODE_ENV' | 'PLAY_TOKEN_TTL_SEC'>,
  o: { slug: string; version: number; published: boolean; now: number },
): { url: string; expiresAt: number | null } {
  const base = `${config.PUBLIC_API_ORIGIN.replace(/\/+$/, '')}/play/${o.slug}/v/${o.version}`;
  if (o.published) return { url: base, expiresAt: null };
  const exp = o.now + config.PLAY_TOKEN_TTL_SEC * 1000;
  return { url: `${base}?t=${signPlayToken(config, { slug: o.slug, version: o.version, exp })}`, expiresAt: exp };
}
