// Speech-to-text for voice pitches (Hindi, Hinglish, English): Sarvam AI's REST endpoint, server
// only. docs/NEXCONN.md "Speech-to-text". `saaras:v3` because `mode` (codemix: Hinglish in Latin +
// Devanagari as spoken) is documented for v3; REST is for clips under 30 s.
import { z } from 'zod';

export interface SpeechToText {
  /** The transcript (trimmed, non-empty) or a SttError. */
  transcribe(audio: { data: Buffer; mimeType: string; filename: string }): Promise<{ text: string; language: string | null; ms: number }>;
}

export class SttError extends Error {
  constructor(
    message: string,
    readonly reason: 'not_configured' | 'too_long' | 'download' | 'unavailable' | 'empty',
  ) {
    super(message);
  }
}

const SarvamResponse = z.object({ transcript: z.string(), language_code: z.string().nullable().optional() });

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export function createSarvamStt(o: { apiKey: string; model?: string; fetch?: FetchFn; timeoutMs?: number; baseUrl?: string }): SpeechToText {
  const f = o.fetch ?? fetch;
  return {
    async transcribe(audio) {
      const t0 = performance.now();
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(audio.data)], { type: audio.mimeType }), audio.filename);
      form.append('model', o.model ?? 'saaras:v3');
      form.append('mode', 'codemix');
      form.append('language_code', 'unknown');
      let res: Response;
      try {
        res = await f(`${o.baseUrl ?? 'https://api.sarvam.ai'}/speech-to-text`, {
          method: 'POST',
          headers: { 'api-subscription-key': o.apiKey },
          body: form,
          signal: AbortSignal.timeout(o.timeoutMs ?? 30_000),
        });
      } catch (e) {
        throw new SttError(`sarvam request failed: ${(e as Error).message.slice(0, 160)}`, 'unavailable');
      }
      if (!res.ok) throw new SttError(`sarvam answered ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`, 'unavailable');
      const body = SarvamResponse.safeParse(await res.json().catch(() => null));
      if (!body.success) throw new SttError('sarvam returned an unexpected body', 'unavailable');
      const text = body.data.transcript.trim();
      if (!text) throw new SttError('empty transcript', 'empty');
      return { text, language: body.data.language_code ?? null, ms: Math.round(performance.now() - t0) };
    },
  };
}

/** Voice content of RC:HQVCMsg / RC:VcMsg as the server sees it (webhook or relay). */
export const VoiceContent = z.object({
  remoteUrl: z.string().url().max(2048),
  duration: z.coerce.number().min(0).max(3600).default(0),
  type: z.string().max(20).optional(),
  mentionedInfo: z.object({ type: z.number().optional(), userIdList: z.array(z.string().max(64)).max(30).optional() }).optional(),
});
export type VoiceContent = z.infer<typeof VoiceContent>;

/**
 * Downloads a voice note (https only, size-capped, no redirects to elsewhere). `allowedHosts`
 * empty = any https host (only for URLs from a signed webhook); a relayed URL must match a host.
 */
export async function downloadVoice(
  url: string,
  o: { allowedHosts: readonly string[] | null; maxBytes?: number; fetch?: FetchFn; timeoutMs?: number },
): Promise<{ data: Buffer; mimeType: string; filename: string }> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new SttError('bad voice url', 'download');
  }
  if (u.protocol !== 'https:') throw new SttError('voice url must be https', 'download');
  if (o.allowedHosts && !o.allowedHosts.some(h => u.hostname === h || u.hostname.endsWith(`.${h}`))) throw new SttError('voice host not allowed', 'download');
  const max = o.maxBytes ?? 3 * 1024 * 1024;
  let res: Response;
  try {
    res = await (o.fetch ?? fetch)(u.toString(), { redirect: 'error', signal: AbortSignal.timeout(o.timeoutMs ?? 15_000) });
  } catch (e) {
    throw new SttError(`voice download failed: ${(e as Error).message.slice(0, 120)}`, 'download');
  }
  if (!res.ok) throw new SttError(`voice download answered ${res.status}`, 'download');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0 || buf.length > max) throw new SttError(`voice file is ${buf.length} bytes`, 'download');
  const mimeType = (res.headers.get('content-type') ?? 'audio/aac').split(';')[0]!.trim() || 'audio/aac';
  const ext = /webm/.test(mimeType)
    ? 'webm'
    : /ogg|opus/.test(mimeType)
      ? 'ogg'
      : /mpeg|mp3/.test(mimeType)
        ? 'mp3'
        : /wav/.test(mimeType)
          ? 'wav'
          : /mp4|m4a/.test(mimeType)
            ? 'm4a'
            : 'aac';
  return { data: buf, mimeType, filename: `voice.${ext}` };
}

/** The friendly fallback line when a voice pitch can't be transcribed. */
export function voiceFallbackText(reason: SttError['reason'] | 'error', hindi: boolean): string {
  if (reason === 'too_long') return hindi ? 'वॉइस नोट 30 सेकंड से छोटा रखो, या टाइप कर दो 🙏' : 'Keep voice pitches under 30 seconds, or type it instead 🙏';
  return hindi
    ? 'माफ़ करना, अभी आपका वॉइस नोट सुन नहीं पाया। टाइप कर दो? 🙏'
    : "Sorry, I couldn't listen to that voice note right now. Could you type it instead? 🙏";
}
