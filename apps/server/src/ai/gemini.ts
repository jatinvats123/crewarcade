// Google Gemini client (AI Studio key) behind the same AiClient interface as Claude, so agents,
// ledger and tests do not change. Chosen with AI_PROVIDER=gemini (owner decision 2026-11-14: no
// Anthropic budget; the AI Studio free tier is used). Structured output: responseMimeType JSON +
// responseJsonSchema (generated from the zod schema), streamed so Pixel's intro can still be shown
// as it is generated. Safety blocks become AiRefusalError (the friendly "I can't make that one").
// Free-tier calls are logged with real token counts and $0 cost. SDK names checked in
// node_modules/@google/genai (3.3.0): GoogleGenAI, models.generateContentStream, usageMetadata.
import { GoogleGenAI, type GenerateContentResponse } from '@google/genai';
import {
  AiNotConfiguredError,
  AiOutputError,
  AiRefusalError,
  AiTimeoutError,
  AiUnavailableError,
  channel,
  outputJsonSchema,
  type AiClient,
  type AiUsage,
  type StructuredCall,
  type StructuredRun,
  type TextCall,
  type TextRun,
} from './claude';
import { streamJsonStringField } from './json-stream';

export interface GeminiOptions {
  apiKey: string;
  /** e.g. gemini-3.5-flash-lite (fast on the free tier; bigger free models stalled in testing). */
  model: string;
  timeoutMs?: number;
  /** USD per million tokens when billed (0 on the free tier). */
  prices?: { input: number; output: number };
  baseUrl?: string;
  log?: { debug(obj: object, msg: string): void };
  /** Extra tries on "busy" answers (503 UNAVAILABLE / 429 RESOURCE_EXHAUSTED), also mid-stream. Default 3. */
  retries?: number;
  /** Backoff before retry n (1-based); default 2 s, 6 s, 15 s (+ jitter). */
  retryDelayMs?: (n: number) => number;
  sleep?: (ms: number) => Promise<void>;
}

/** A temporary "the model is busy" answer, worth retrying (the free tier sees these at peaks). */
export const isBusyError = (msg: string): boolean => /\b(503|429)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand/i.test(msg);

const REFUSAL_REASONS = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY', 'RECITATION']);

export function createGeminiClient(o: GeminiOptions): AiClient {
  // v1beta: where the current models and the "-latest" aliases live (the SDK defaults to v1 here).
  const ai = new GoogleGenAI({ apiKey: o.apiKey, httpOptions: { apiVersion: 'v1beta', ...(o.baseUrl && { baseUrl: o.baseUrl }) } });
  const prices = o.prices ?? { input: 0, output: 0 };

  function usageOf(last: GenerateContentResponse | null, ms: number): AiUsage {
    const u = last?.usageMetadata;
    const tokensIn = u?.promptTokenCount ?? 0;
    const tokensOut = (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0);
    return {
      model: last?.modelVersion ?? o.model,
      tokensIn,
      tokensOut,
      cacheReadTokens: u?.cachedContentTokenCount ?? 0,
      cacheWriteTokens: 0,
      costUsd: Math.round(((tokensIn * prices.input + tokensOut * prices.output) / 1_000_000) * 1e6) / 1e6,
      ms: Math.round(ms),
      fellBack: false,
    };
  }

  const sleep = o.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const delay = o.retryDelayMs ?? ((n: number) => [2000, 6000, 15000][Math.min(n, 3) - 1]! + Math.floor(Math.random() * 500));

  /**
   * Retries busy answers, also when they arrive mid-stream (the free tier drops streams at peaks).
   * `newAttempt` gives each try a fresh text sink: the caller suppresses what it already showed, so a
   * retried reply never repeats on screen.
   */
  async function run(call: TextCall, json: Record<string, unknown> | null, newAttempt: () => (t: string) => void): Promise<{ text: string; usage: AiUsage }> {
    const tries = 1 + (o.retries ?? 3);
    for (let n = 1; ; n++) {
      try {
        return await runOnce(call, json, newAttempt());
      } catch (e) {
        if (!(e instanceof AiUnavailableError) || n >= tries || !isBusyError(e.message)) throw e;
        o.log?.debug({ purpose: call.purpose, attempt: n }, 'gemini: model busy, retrying');
        await sleep(delay(n));
      }
    }
  }

  /** One streamed request; `onText` gets every text delta. Checks block/finish reasons before returning. */
  async function runOnce(call: TextCall, json: Record<string, unknown> | null, onText: (t: string) => void): Promise<{ text: string; usage: AiUsage }> {
    const t0 = performance.now();
    const timeoutMs = call.timeoutMs ?? o.timeoutMs ?? 120_000;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    const onOuterAbort = () => abort.abort();
    call.signal?.addEventListener('abort', onOuterAbort);
    let text = '';
    let last: GenerateContentResponse | null = null;
    try {
      const stream = await ai.models.generateContentStream({
        model: o.model,
        contents: [{ role: 'user', parts: [...(call.images ?? []).map(i => ({ inlineData: { mimeType: i.mediaType, data: i.data } })), { text: call.user }] }],
        config: {
          systemInstruction: call.system,
          maxOutputTokens: call.maxTokens,
          abortSignal: abort.signal,
          ...(json && { responseMimeType: 'application/json', responseJsonSchema: json }),
        },
      });
      for await (const chunk of stream) {
        last = chunk;
        const piece = chunk.text;
        if (piece) {
          text += piece;
          onText(piece);
        }
      }
    } catch (e) {
      if (abort.signal.aborted) throw new AiTimeoutError(`${call.purpose} timed out after ${timeoutMs} ms`);
      const msg = (e as Error).message ?? String(e);
      if (/API key|permission|401|403/i.test(msg)) throw new AiNotConfiguredError();
      if (/400|invalid/i.test(msg)) throw new AiOutputError(`${call.purpose} was rejected: ${msg.slice(0, 200)}`);
      throw new AiUnavailableError(`${call.purpose} failed: ${msg.slice(0, 200)}`);
    } finally {
      clearTimeout(timer);
      call.signal?.removeEventListener('abort', onOuterAbort);
    }
    const usage = usageOf(last, performance.now() - t0);
    const block = last?.promptFeedback?.blockReason;
    const finish = last?.candidates?.[0]?.finishReason;
    if (block || (finish && REFUSAL_REASONS.has(String(finish)))) throw new AiRefusalError(String(block ?? finish).toLowerCase(), usage);
    if (finish === 'MAX_TOKENS') throw new AiOutputError(`${call.purpose} hit maxOutputTokens (${call.maxTokens})`, usage);
    o.log?.debug({ purpose: call.purpose, ...usage }, 'gemini: call done');
    return { text, usage };
  }

  return {
    model: o.model,
    structured<T>(call: StructuredCall<T>): StructuredRun<T> {
      const field = channel<string>();
      const shown = replayGuard(field.push);
      const done = (async () => {
        try {
          // Each attempt parses its own JSON from the start; the guard skips the part already shown.
          const { text, usage } = await run(call, outputJsonSchema(call.schema), () => {
            const sink = shown.attempt();
            const extractor = call.streamField ? streamJsonStringField(call.streamField, sink) : null;
            return t => extractor?.(t);
          });
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            throw new AiOutputError(`${call.purpose} returned invalid JSON`, usage);
          }
          const parsed = call.schema.safeParse(json);
          if (!parsed.success) throw new AiOutputError(`${call.purpose} output did not match the schema: ${parsed.error.issues[0]?.message ?? ''}`, usage);
          return { value: parsed.data, usage };
        } finally {
          field.end();
        }
      })();
      done.catch(() => {});
      return { fieldChunks: field.iterable, done };
    },
    streamText(call: TextCall): TextRun {
      const chunks = channel<string>();
      const done = (async () => {
        try {
          const shown = replayGuard(chunks.push);
          return await run(call, null, () => shown.attempt());
        } finally {
          chunks.end();
        }
      })();
      done.catch(() => {});
      return { chunks: chunks.iterable, done };
    },
  };
}

/**
 * Streams the same reply across retries without repeating it (pure; tested): each attempt's text is
 * passed on only past the length already shown. A retry's wording can differ slightly from the first
 * attempt's; the seam stays invisible in practice because busy errors cut streams early.
 */
export function replayGuard(push: (t: string) => void): { attempt: () => (t: string) => void } {
  let shown = 0;
  return {
    attempt() {
      let seen = 0;
      return (t: string) => {
        const start = seen;
        seen += t.length;
        if (seen <= shown) return;
        push(t.slice(Math.max(0, shown - start)));
        shown = seen;
      };
    },
  };
}
