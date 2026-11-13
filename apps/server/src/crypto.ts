// Small crypto helpers. Server only.
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const sha1Hex = (s: string): string => createHash('sha1').update(s, 'utf8').digest('hex');

/** Nexconn signature for API calls and webhooks: lowercase hex sha1(AppSecret + Nonce + Timestamp). */
export const nexconnSignature = (appSecret: string, nonce: string, timestamp: string): string => sha1Hex(appSecret + nonce + timestamp);

/** Constant-time string comparison. Both sides are hashed first, so the length does not leak either. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

const ALNUM = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Random alphanumeric string (Nexconn Nonce: <= 18 chars). */
export function randomAlnum(length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += ALNUM[randomInt(ALNUM.length)];
  return s;
}

/** AES-256-GCM. Output: "v1." + base64url(iv[12] | tag[16] | ciphertext). */
export function encryptSecret(plain: string, keyB64: string): string {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('encryption key must be 32 bytes');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64url')}`;
}

/** Throws on a wrong key, a tampered ciphertext or an unknown format. */
export function decryptSecret(enc: string, keyB64: string): string {
  if (!enc.startsWith('v1.')) throw new Error('unknown ciphertext version');
  const key = Buffer.from(keyB64, 'base64');
  const raw = Buffer.from(enc.slice(3), 'base64url');
  if (raw.length < 29) throw new Error('ciphertext too short');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
