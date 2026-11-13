// Webhook signature check (docs: /platform-chat-api/webhook/overview.md). Headers: AppKey (no dash,
// unlike API calls), Nonce, Timestamp, Signature = sha1(AppSecret + Nonce + Timestamp) lowercase hex.
// Compared in constant time. The signature does not cover the body, so we also reject stale
// timestamps (WEBHOOK_MAX_SKEW_MS) to stop replays of captured headers.
import { nexconnSignature, safeEqual } from '../crypto';

export type VerifyResult = { ok: true } | { ok: false; reason: 'missing_headers' | 'app_key' | 'stale' | 'signature' };

type HeaderValue = string | string[] | undefined;
const one = (v: HeaderValue): string | undefined => (Array.isArray(v) ? v[0] : v);

export function verifyWebhook(headers: Record<string, HeaderValue>, opts: { appKey: string; appSecret: string; maxSkewMs: number; now: number }): VerifyResult {
  const appKey = one(headers.appkey);
  const nonce = one(headers.nonce);
  const timestamp = one(headers.timestamp);
  const signature = one(headers.signature);
  if (!appKey || !nonce || !timestamp || !signature || nonce.length > 64 || !/^\d{10,16}$/.test(timestamp)) return { ok: false, reason: 'missing_headers' };
  if (!safeEqual(appKey, opts.appKey)) return { ok: false, reason: 'app_key' };
  if (Math.abs(opts.now - Number(timestamp)) > opts.maxSkewMs) return { ok: false, reason: 'stale' };
  if (!safeEqual(nexconnSignature(opts.appSecret, nonce, timestamp), signature.toLowerCase())) return { ok: false, reason: 'signature' };
  return { ok: true };
}
