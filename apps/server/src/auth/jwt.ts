// Minimal HS256 JWT for the session cookie (we are both issuer and audience). Verification is
// constant-time and the payload is parsed with zod.
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { safeEqual } from '../crypto';

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

export const SessionClaims = z.object({
  sub: z.string().min(1).max(64),
  iat: z.number().int(),
  exp: z.number().int(),
  /** Session format version: bump to sign everyone out. */
  v: z.literal(1),
});
export type SessionClaims = z.infer<typeof SessionClaims>;

const hmac = (data: string, secret: string) => createHmac('sha256', secret).update(data).digest('base64url');

export function signJwt(claims: SessionClaims, secret: string): string {
  const body = Buffer.from(JSON.stringify(SessionClaims.parse(claims))).toString('base64url');
  const data = `${HEADER}.${body}`;
  return `${data}.${hmac(data, secret)}`;
}

/** The claims, or null for anything malformed, forged, from the future or expired. */
export function verifyJwt(token: string, secret: string, nowS: number = Math.floor(Date.now() / 1000)): SessionClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, b, s] = parts as [string, string, string];
  if (h !== HEADER || !safeEqual(hmac(`${h}.${b}`, secret), s)) return null;
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const claims = SessionClaims.safeParse(json);
  if (!claims.success || claims.data.exp <= nowS || claims.data.iat > nowS + 60) return null;
  return claims.data;
}
