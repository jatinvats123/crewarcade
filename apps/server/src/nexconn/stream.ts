// Streaming bridge: text from an AsyncIterable (Claude deltas) -> one RC:StreamMsg in a group
// channel, so agent replies type themselves out in the chat. Nexconn rules (send-group-stream.md):
// chunk 1 has no messageId and carries `type` + `user`; the response gives the messageId for every
// later chunk; seq starts at 1 and grows by exactly 1; the last chunk has complete: true; all
// chunks together stay under 128 KB. We batch deltas every ~300 ms (at most ~1 KB per chunk) to
// respect the 20 msg/s group quota. If any send fails, the rest of the text is collected and sent
// once as a normal text message, so the crew always gets the full reply.
import { BUILTIN_MESSAGE_TYPES, LIMITS } from '@crewarcade/shared';
import { sendGroupMessage, streamGroupMessage } from './api';
import type { NexconnClient } from './client';

export interface StreamSender {
  /** Nexconn user id of the agent. */
  id: string;
  name: string;
  portrait?: string;
}

export interface StreamOptions {
  channelId: string;
  sender: StreamSender;
  /**
   * 'single' (default): wait for the whole reply, then send it as one complete stream chunk.
   * 'chunked': send ~300 ms batches as the docs describe. Live check 2026-11-14: Nexconn kept only
   * the FIRST chunk of a multi-chunk stream (history showed "part one," of "part one, part two") and
   * Web clients got no live deltas, so 'chunked' stays off until Nexconn confirms the behaviour.
   */
  mode?: 'single' | 'chunked';
  batchMs?: number;
  maxChunkBytes?: number;
  maxTotalBytes?: number;
  now?: () => number;
  /** Called after each chunk is sent (tests, metrics). */
  onChunk?: (seq: number, content: string) => void;
}

export interface StreamResult {
  messageId: string | null;
  /** Everything that was streamed (or sent in the fallback message). */
  text: string;
  chunks: number;
  /** The stream failed and a normal text message carried the content instead. */
  fellBack: boolean;
}

const enc = new TextEncoder();
export const byteLength = (s: string): number => enc.encode(s).length;

/** The longest prefix of `s` that fits in `maxBytes` (never splits a code point or a surrogate pair). */
export function takeBytes(s: string, maxBytes: number): [string, string] {
  if (byteLength(s) <= maxBytes) return [s, ''];
  let bytes = 0;
  let i = 0;
  for (const ch of s) {
    const b = byteLength(ch);
    if (bytes + b > maxBytes) break;
    bytes += b;
    i += ch.length;
  }
  return [s.slice(0, i), s.slice(i)];
}

export async function streamToGroup(nexconn: NexconnClient, chunks: AsyncIterable<string>, o: StreamOptions): Promise<StreamResult> {
  const batchMs = o.batchMs ?? 300;
  const maxChunk = o.maxChunkBytes ?? 1024;
  // Leave room for the closing ellipsis and JSON escaping overhead.
  const maxTotal = (o.maxTotalBytes ?? LIMITS.streamTotalBytes) - 256;
  const now = o.now ?? Date.now;

  let messageId: string | null = null;
  let seq = 0;
  let sentBytes = 0;
  let sentText = '';
  let buffer = '';
  let failed: unknown = null;
  let truncated = false;
  let all = '';
  let lastFlush = now();

  const send = async (content: string, complete: boolean) => {
    seq++;
    const first = seq === 1;
    const res = await streamGroupMessage(nexconn, {
      fromUserId: o.sender.id,
      toChannelId: o.channelId,
      messageType: 'RC:StreamMsg',
      content: {
        content,
        seq,
        complete,
        ...(first
          ? { type: 'markdown' as const, user: { id: o.sender.id, name: o.sender.name, ...(o.sender.portrait && { portrait: o.sender.portrait }) } }
          : { messageId: messageId! }),
      },
      isEchoToSender: 0,
      shouldPersist: 1,
    });
    if (first) {
      if (!res.messageId) throw new Error('stream/send returned no messageId for the first chunk');
      messageId = res.messageId;
    }
    sentBytes += byteLength(content);
    sentText += content;
    lastFlush = now();
    o.onChunk?.(seq, content);
  };

  /** Sends whole ~1 KB pieces, and the rest when the batch window has passed (or `force`). */
  const flush = async (force: boolean) => {
    while (byteLength(buffer) >= maxChunk) {
      const [head, tail] = takeBytes(buffer, maxChunk);
      buffer = tail;
      await send(head, false);
    }
    if (buffer && (force || now() - lastFlush >= batchMs)) {
      const b = buffer;
      buffer = '';
      await send(b, false);
    }
  };

  if ((o.mode ?? 'single') === 'single') {
    for await (const piece of chunks) all += piece;
    const text = byteLength(all) > maxTotal ? `${takeBytes(all, maxTotal)[0]}…` : all;
    try {
      await send(text.trim() ? text : '…', true);
      return { messageId, text: sentText, chunks: seq, fellBack: false };
    } catch (e) {
      failed = e;
    }
  }

  for await (const piece of chunks) {
    all += piece;
    if (failed || truncated) continue; // keep draining so `all` has the full text
    let add = piece;
    if (sentBytes + byteLength(buffer) + byteLength(add) > maxTotal) {
      add = takeBytes(add, Math.max(0, maxTotal - sentBytes - byteLength(buffer)))[0] + '…';
      truncated = true;
    }
    buffer += add;
    try {
      await flush(truncated);
    } catch (e) {
      failed = e;
    }
  }

  if (!failed) {
    try {
      // The closing chunk carries whatever is left (Nexconn needs non-empty first content).
      if (seq === 0 && !buffer) buffer = all || '…';
      while (byteLength(buffer) > maxChunk) {
        const [head, tail] = takeBytes(buffer, maxChunk);
        buffer = tail;
        await send(head, false);
      }
      // The docs mark `content` as required; an empty closing chunk is avoided with a space.
      await send(buffer || ' ', true);
      buffer = '';
      return { messageId, text: sentText, chunks: seq, fellBack: false };
    } catch (e) {
      failed = e;
    }
  }

  // Fallback: one ordinary text message with the complete reply.
  const text = (all.trim() || sentText.trim() || '…').slice(0, LIMITS.chatTextChars * 4);
  const [fallbackId] = await sendGroupMessage(nexconn, {
    fromUserId: o.sender.id,
    toChannelIds: [o.channelId],
    messageType: BUILTIN_MESSAGE_TYPES.text,
    content: JSON.stringify({ content: takeBytes(text, LIMITS.messageContentBytes - 200)[0] }),
    shouldPersist: 1,
    isEchoToSender: 0,
  });
  return { messageId: fallbackId?.messageId ?? messageId, text, chunks: seq, fellBack: true };
}
