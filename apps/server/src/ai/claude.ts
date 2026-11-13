// Claude wrapper for the agents (server only). One function per call style:
//   structured(): JSON that matches a zod schema (output_config.format), optionally streaming one
//                 string field (Pixel's intro) to the chat while the rest is generated.
//   streamText(): plain streamed text (explanations, short replies).
// Every call: model from config (claude-opus-5-5), explicit effort, the stable system prompt cached
// (cache_control), server-side refusal fallbacks (beta server-side-fallback-2026-07-01,
// fallbacks: "default"), a timeout, stop_reason checked before content is read (refusal ->
// AiRefusalError, max_tokens -> AiOutputError), and usage + cost returned for the ledger.
// No assistant prefill (rejected by current models). SDK names checked in
// node_modules/@anthropic-ai/sdk (1.8.0): client.beta.messages.stream, BetaOutputConfig, fallbacks.
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { streamJsonStringField } from './json-stream';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
/** Which agent step a call belongs to (logs, ledger, the fake client's canned outputs). */
export type AiPurpose = 'pixel.plan' | 'pixel.revise' | 'pixel.explain' | 'pixel.reply' | 'forge.build' | 'glitch.scenario';

export interface AiUsage {
  model: string;
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  ms: number;
  /** A refusal was rescued by the server-side fallback model. */
  fellBack: boolean;
}

interface CallBase {
  purpose: AiPurpose;
  /** Stable system prompt (cached). Never put per-request data here. */
  system: string;
  /** The per-request part: untrusted chat text goes inside delimited blocks (prompts.ts). */
  user: string;
  effort: Effort;
  /** Output cap. Thinking counts against it, so leave room. */
  maxTokens: number;
  timeoutMs?: number;
  /** Structured inputs for the fake client (FAKE_AGENTS=1) to build deterministic outputs. Ignored by Claude. */
  hint?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface StructuredCall<T> extends CallBase {
  schema: z.ZodType<T>;
  /** Stream this top-level string field as it is generated (e.g. "intro"). */
  streamField?: string;
}
export type TextCall = CallBase;

export interface StructuredRun<T> {
  /** Chunks of `streamField` (empty when none was asked for). */
  fieldChunks: AsyncIterable<string>;
  done: Promise<{ value: T; usage: AiUsage }>;
}
export interface TextRun {
  chunks: AsyncIterable<string>;
  done: Promise<{ text: string; usage: AiUsage }>;
}

export interface AiClient {
  readonly model: string;
  structured<T>(call: StructuredCall<T>): StructuredRun<T>;
  streamText(call: TextCall): TextRun;
}

// ---- typed errors -------------------------------------------------------------------------

export class AiError extends Error {
  constructor(
    message: string,
    readonly usage?: AiUsage,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
/** stop_reason "refusal" (after fallbacks). The agent answers with a friendly message. */
export class AiRefusalError extends AiError {
  constructor(
    readonly category: string | null,
    usage?: AiUsage,
  ) {
    super(`Claude declined${category ? ` (${category})` : ''}`, usage);
  }
}
/** max_tokens hit, or output that does not match the schema. */
export class AiOutputError extends AiError {}
export class AiTimeoutError extends AiError {}
/** API errors after the SDK's retries (rate limits, 5xx, connection). */
export class AiUnavailableError extends AiError {}
export class AiNotConfiguredError extends AiError {
  constructor() {
    super('ANTHROPIC_API_KEY is not set (or set FAKE_AGENTS=1)');
  }
}

// ---- pricing (USD per million tokens; platform.claude.com pricing, cached 2026-11-03) -------

interface Price {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}
export const PRICES: Readonly<Record<string, Price>> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
};

/** Cost of one call. input_tokens excludes cached tokens, which are billed separately. */
export function costUsd(model: string, u: { input: number; output: number; cacheRead: number; cacheWrite: number }): number {
  const p = PRICES[model] ?? PRICES['claude-opus-5-5']!;
  const usd = (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1_000_000;
  return Math.round(usd * 1e6) / 1e6;
}

export function usageFrom(message: Anthropic.Beta.BetaMessage, ms: number): AiUsage {
  const u = message.usage;
  const tokens = {
    input: u.input_tokens,
    output: u.output_tokens,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
  };
  const fellBack = (u.iterations ?? []).some(i => (i as { type?: string }).type === 'fallback_message');
  return {
    model: message.model,
    tokensIn: tokens.input + tokens.cacheRead + tokens.cacheWrite,
    tokensOut: tokens.output,
    cacheReadTokens: tokens.cacheRead,
    cacheWriteTokens: tokens.cacheWrite,
    costUsd: costUsd(message.model, tokens),
    ms: Math.round(ms),
    fellBack,
  };
}

// ---- JSON schema for structured outputs ---------------------------------------------------

// Structured outputs accept a subset of JSON Schema; length/size/pattern constraints are enforced
// by zod after the call instead (the agent normalizes and retries on failure).
const DROP_KEYS = new Set([
  '$schema',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'maxItems',
  'default',
]);
export function outputJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (DROP_KEYS.has(k)) continue;
      if (k === 'minItems' && typeof v === 'number' && v > 1) continue;
      out[k] = walk(v);
    }
    if (out.type === 'object') out.additionalProperties = false;
    return out;
  };
  return walk(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })) as Record<string, unknown>;
}

// ---- the real client ----------------------------------------------------------------------

export interface ClaudeOptions {
  apiKey: string;
  model: string;
  /** Default per-call timeout. */
  timeoutMs?: number;
  baseURL?: string;
  log?: { warn(obj: object, msg: string): void; debug(obj: object, msg: string): void };
}

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Turns an async producer into an AsyncIterable fed by push(). */
export function channel<T>(): { push: (v: T) => void; end: () => void; fail: (e: unknown) => void; iterable: AsyncIterable<T> } {
  const queue: T[] = [];
  let waiting: ((r: IteratorResult<T>) => void) | null = null;
  let rejectWaiting: ((e: unknown) => void) | null = null;
  let done = false;
  let error: unknown = null;
  return {
    push: v => {
      if (done) return;
      if (waiting) {
        const w = waiting;
        waiting = rejectWaiting = null;
        w({ value: v, done: false });
      } else queue.push(v);
    },
    end: () => {
      done = true;
      if (waiting) {
        const w = waiting;
        waiting = rejectWaiting = null;
        w({ value: undefined as never, done: true });
      }
    },
    fail: e => {
      error = e;
      done = true;
      if (rejectWaiting) {
        const r = rejectWaiting;
        waiting = rejectWaiting = null;
        r(e);
      }
    },
    iterable: {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          if (queue.length) return Promise.resolve({ value: queue.shift()!, done: false });
          if (error) return Promise.reject(error);
          if (done) return Promise.resolve({ value: undefined as never, done: true });
          return new Promise<IteratorResult<T>>((resolve, reject) => {
            waiting = resolve;
            rejectWaiting = reject;
          });
        },
      }),
    },
  };
}

export function createClaudeClient(o: ClaudeOptions): AiClient {
  const client = new Anthropic({ apiKey: o.apiKey, maxRetries: 2, ...(o.baseURL && { baseURL: o.baseURL }) });

  /** Runs one streamed request; `onText` gets every text delta. Resolves with the final message. */
  async function run(
    call: CallBase,
    format: Record<string, unknown> | null,
    onText: (t: string) => void,
  ): Promise<{ message: Anthropic.Beta.BetaMessage; ms: number }> {
    const t0 = performance.now();
    const timeoutMs = call.timeoutMs ?? o.timeoutMs ?? 90_000;
    const stream = client.beta.messages.stream(
      {
        model: o.model,
        max_tokens: call.maxTokens,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        system: [{ type: 'text', text: call.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: call.user }],
        output_config: { effort: call.effort, ...(format && { format: { type: 'json_schema', schema: format } }) },
      },
      { timeout: timeoutMs, ...(call.signal && { signal: call.signal }) },
    );
    stream.on('text', delta => onText(delta));
    try {
      const message = await stream.finalMessage();
      return { message, ms: performance.now() - t0 };
    } catch (e) {
      if (e instanceof Anthropic.APIConnectionTimeoutError) throw new AiTimeoutError(`${call.purpose} timed out after ${timeoutMs} ms`);
      if (e instanceof Anthropic.APIUserAbortError) throw new AiTimeoutError(`${call.purpose} was aborted`);
      if (e instanceof Anthropic.AuthenticationError) throw new AiNotConfiguredError();
      if (e instanceof Anthropic.BadRequestError) throw new AiOutputError(`${call.purpose} was rejected: ${e.message.slice(0, 200)}`);
      if (e instanceof Anthropic.APIError) throw new AiUnavailableError(`${call.purpose} failed: ${e.status ?? 'network'} ${e.message.slice(0, 200)}`);
      throw e;
    }
  }

  /** stop_reason first, then content. */
  function finalText(call: CallBase, message: Anthropic.Beta.BetaMessage, usage: AiUsage): string {
    if (message.stop_reason === 'refusal') throw new AiRefusalError(message.stop_details?.category ?? null, usage);
    if (message.stop_reason === 'max_tokens') throw new AiOutputError(`${call.purpose} hit max_tokens (${call.maxTokens})`, usage);
    return message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');
  }

  return {
    model: o.model,
    structured<T>(call: StructuredCall<T>): StructuredRun<T> {
      const field = channel<string>();
      const extractor = call.streamField ? streamJsonStringField(call.streamField, field.push) : null;
      const done = (async () => {
        try {
          const { message, ms } = await run(call, outputJsonSchema(call.schema), t => extractor?.(t));
          const usage = usageFrom(message, ms);
          const text = finalText(call, message, usage);
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            throw new AiOutputError(`${call.purpose} returned invalid JSON`, usage);
          }
          const parsed = call.schema.safeParse(json);
          if (!parsed.success) throw new AiOutputError(`${call.purpose} output did not match the schema: ${parsed.error.issues[0]?.message ?? ''}`, usage);
          o.log?.debug({ purpose: call.purpose, ...usage }, 'claude: structured call done');
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
          const { message, ms } = await run(call, null, chunks.push);
          const usage = usageFrom(message, ms);
          const text = finalText(call, message, usage);
          o.log?.debug({ purpose: call.purpose, ...usage }, 'claude: text call done');
          return { text, usage };
        } finally {
          chunks.end();
        }
      })();
      done.catch(() => {});
      return { chunks: chunks.iterable, done };
    },
  };
}
