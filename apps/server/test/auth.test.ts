// Crypto, JWT and cookie rules behind sessions and token storage.
import { describe, expect, it } from 'vitest';
import { signJwt, verifyJwt } from '../src/auth/jwt';
import { parseCookies, sessionCookie } from '../src/auth/session';
import { loadConfig, sessionSecret } from '../src/config';
import { decryptSecret, encryptSecret, randomAlnum, safeEqual } from '../src/crypto';

const KEY = Buffer.alloc(32, 3).toString('base64');
const SECRET = 's'.repeat(40);

describe('token encryption (AES-256-GCM)', () => {
  it('round-trips and never contains the plaintext', () => {
    const enc = encryptSecret('nexconn-token-abc', KEY);
    expect(enc).toMatch(/^v1\./);
    expect(enc).not.toContain('nexconn-token-abc');
    expect(decryptSecret(enc, KEY)).toBe('nexconn-token-abc');
    expect(encryptSecret('x', KEY)).not.toBe(encryptSecret('x', KEY)); // random IV
  });
  it('fails on a wrong key or a tampered ciphertext', () => {
    const enc = encryptSecret('token', KEY);
    expect(() => decryptSecret(enc, Buffer.alloc(32, 4).toString('base64'))).toThrow();
    const raw = Buffer.from(enc.slice(3), 'base64url');
    raw[raw.length - 1]! ^= 1;
    expect(() => decryptSecret(`v1.${raw.toString('base64url')}`, KEY)).toThrow();
    expect(() => decryptSecret('v2.abc', KEY)).toThrow();
  });
});

describe('session JWT', () => {
  const now = 1_800_000_000;
  const claims = { sub: 'uABC', iat: now, exp: now + 3600, v: 1 as const };
  it('verifies its own tokens', () => {
    expect(verifyJwt(signJwt(claims, SECRET), SECRET, now + 10)).toEqual(claims);
  });
  it('rejects expired, future, forged and tampered tokens', () => {
    const t = signJwt(claims, SECRET);
    expect(verifyJwt(t, SECRET, now + 3600)).toBeNull();
    expect(verifyJwt(signJwt({ ...claims, iat: now + 1000, exp: now + 5000 }, SECRET), SECRET, now)).toBeNull();
    expect(verifyJwt(t, 'another-secret-another-secret-another', now)).toBeNull();
    const [h, , s] = t.split('.');
    const evil = Buffer.from(JSON.stringify({ ...claims, sub: 'uADMIN' })).toString('base64url');
    expect(verifyJwt(`${h}.${evil}.${s}`, SECRET, now)).toBeNull();
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    expect(verifyJwt(`${none}.${t.split('.')[1]}.`, SECRET, now)).toBeNull();
    expect(verifyJwt('garbage', SECRET, now)).toBeNull();
  });
});

describe('cookies and config', () => {
  it('serializes the session cookie with the right flags', () => {
    expect(sessionCookie('abc', { secure: true, maxAgeS: 60 })).toBe('ca_session=abc; Path=/; Max-Age=60; HttpOnly; SameSite=Lax; Secure');
  });
  it('parses cookie headers (first value wins)', () => {
    expect(parseCookies('a=1; ca_session=xyz; b=%20x; ca_session=second')).toEqual({ a: '1', ca_session: 'xyz', b: ' x' });
    expect(parseCookies(undefined)).toEqual({});
  });
  it('SESSION_SECRET: >= 32 chars; dev fallback, never in production', () => {
    const DB = 'postgres://u:p@localhost:5432/x';
    expect(() => loadConfig({ DATABASE_URL: DB, SESSION_SECRET: 'short' })).toThrow(/32/);
    expect(sessionSecret(loadConfig({ DATABASE_URL: DB }))).toMatch(/dev-only/);
    expect(() => sessionSecret({ NODE_ENV: 'production', SESSION_SECRET: undefined })).toThrow();
  });
  it('constant-time compare and nonces', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(randomAlnum(16)).toMatch(/^[A-Za-z0-9]{16}$/);
  });
});
