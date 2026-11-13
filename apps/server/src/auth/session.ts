// Session cookie: an httpOnly, SameSite=Lax HS256 JWT valid for 90 days (Secure in production).
// The browser only talks to the web origin (Vercel), which proxies /api/* here, so the cookie is
// first-party and host-only on the web domain (docs/SPEC.md, "Sessions and the API proxy").
import type { FastifyReply, FastifyRequest } from 'fastify';
import { signJwt, verifyJwt } from './jwt';

export const SESSION_COOKIE = 'ca_session';
export const SESSION_TTL_S = 90 * 24 * 60 * 60;

export interface SessionOptions {
  secret: string;
  secure: boolean;
  now?: () => number;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    if (k in out) continue;
    const v = part.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function sessionCookie(value: string, opts: { secure: boolean; maxAgeS: number }): string {
  return [`${SESSION_COOKIE}=${value}`, 'Path=/', `Max-Age=${opts.maxAgeS}`, 'HttpOnly', 'SameSite=Lax', ...(opts.secure ? ['Secure'] : [])].join('; ');
}

export function setSession(reply: FastifyReply, userId: string, opts: SessionOptions): void {
  const nowS = Math.floor((opts.now?.() ?? Date.now()) / 1000);
  const jwt = signJwt({ sub: userId, iat: nowS, exp: nowS + SESSION_TTL_S, v: 1 }, opts.secret);
  reply.header('set-cookie', sessionCookie(jwt, { secure: opts.secure, maxAgeS: SESSION_TTL_S }));
}

export function clearSession(reply: FastifyReply, opts: Pick<SessionOptions, 'secure'>): void {
  reply.header('set-cookie', sessionCookie('', { secure: opts.secure, maxAgeS: 0 }));
}

/** The signed-in user id from the cookie, or null. */
export function sessionUserId(req: FastifyRequest, opts: SessionOptions): string | null {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;
  return verifyJwt(token, opts.secret, Math.floor((opts.now?.() ?? Date.now()) / 1000))?.sub ?? null;
}
