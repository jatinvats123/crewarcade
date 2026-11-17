// What route handlers and services get: injected dependencies, no globals.
import type { FastifyBaseLogger } from 'fastify';
import type { AgentServices } from './agents/runtime-deps';
import type { SessionOptions } from './auth/session';
import type { Config } from './config';
import type { Db } from './db/types';
import type { NexconnClient } from './nexconn/client';
import type { ObjectStorage } from './storage';

export interface Ctx {
  config: Config;
  db: Db;
  /** null when Nexconn keys are not configured: chat routes answer 503. */
  nexconn: NexconnClient | null;
  log: FastifyBaseLogger;
  /** Private `games` bucket (Supabase in production, local disk in development, memory in tests). */
  storage: ObjectStorage;
  /** Public `clips` bucket: playtest GIFs and screenshots. */
  clips: ObjectStorage;
  session: SessionOptions;
  now: () => number;
  /** AI client, job queue and live agent states. null: agents are not running (card actions answer 503). */
  agents: AgentServices | null;
  /** Fire-and-forget work after the response (webhook processing). Tests collect and await it. */
  runInBackground: (name: string, task: () => Promise<void>) => void;
}
