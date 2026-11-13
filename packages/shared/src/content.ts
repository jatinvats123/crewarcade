// Parsing of Nexconn message content at the boundary (zod: parse, don't trust). Used by the server
// (webhook logging) and the web client (rendering). Built-in content shapes come from the Web SDK
// typings (TextMessageContent.text, ImageMessageContent.remoteUrl/thumbnailBase64,
// HDVoiceMessageContent.remoteUrl/duration); messages sent through the server API use the wire
// format instead ({"content": "..."} for RC:TxtMsg), so text accepts either field.
import { z } from 'zod';
import { BUILTIN_MESSAGE_TYPES } from './constants';

export const MentionedInfoSchema = z.object({
  type: z.number().int(),
  userIdList: z.array(z.string()).optional(),
});

const TextContent = z
  .object({ text: z.string().optional(), content: z.string().optional(), mentionedInfo: MentionedInfoSchema.optional() })
  .transform(c => ({ text: c.text ?? c.content ?? '', mentionedUserIds: c.mentionedInfo?.userIdList ?? [], mentionAll: c.mentionedInfo?.type === 1 }));

const ImageContent = z.object({
  remoteUrl: z.string().optional(),
  imageUri: z.string().optional(),
  thumbnailBase64: z.string().optional(),
  content: z.string().optional(),
});

const VoiceContent = z.object({ remoteUrl: z.string(), duration: z.coerce.number().min(0).default(0) });

/** Accepts a JSON string or an already-parsed object. */
export function asObject(content: unknown): unknown {
  if (typeof content !== 'string') return content;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export interface ParsedText {
  text: string;
  mentionedUserIds: string[];
  mentionAll: boolean;
}
export function parseTextContent(content: unknown): ParsedText | null {
  const r = TextContent.safeParse(asObject(content));
  return r.success ? r.data : null;
}

export interface ParsedImage {
  url: string;
  thumb: string | null;
}
const safeUrl = (u: string | undefined): string | null => (u && /^(https?:|blob:)/.test(u) ? u : null);
export function parseImageContent(content: unknown): ParsedImage | null {
  const r = ImageContent.safeParse(asObject(content));
  if (!r.success) return null;
  const url = safeUrl(r.data.remoteUrl) ?? safeUrl(r.data.imageUri);
  if (!url) return null;
  const b64 = r.data.thumbnailBase64 ?? r.data.content;
  const thumb = b64 && /^[A-Za-z0-9+/=]+$/.test(b64) ? `data:image/jpeg;base64,${b64}` : null;
  return { url, thumb };
}

export interface ParsedVoice {
  url: string;
  durationS: number;
}
export function parseVoiceContent(content: unknown): ParsedVoice | null {
  const r = VoiceContent.safeParse(asObject(content));
  if (!r.success) return null;
  const url = safeUrl(r.data.remoteUrl);
  return url ? { url, durationS: Math.round(r.data.duration) } : null;
}

/** What the server keeps in messages_log.text: the text of text messages, nothing for other types. */
export function extractLogText(messageType: string, content: unknown, maxChars = 2000): string | null {
  if (messageType !== BUILTIN_MESSAGE_TYPES.text) return null;
  const parsed = parseTextContent(content);
  return parsed ? parsed.text.slice(0, maxChars) : null;
}
