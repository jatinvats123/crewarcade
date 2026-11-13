// What route handlers and services get: injected dependencies, no globals.
import type { FastifyBaseLogger } from 'fastify';
import type { SessionOptions } from './auth/session';
import type { Config } from './config';
import type { Db } from './db/types';
import type { NexconnClient } from './nexconn/client';

export interface Ctx {
  config: Config;
  db: Db;
  /** null when Nexconn keys are not configured: chat routes answer 503. */
  nexconn: NexconnClient | null;
  log: FastifyBaseLogger;
  session: SessionOptions;
  now: () => number;
  /** Fire-and-forget work after the response (webhook processing). Tests collect and await it. */
  runInBackground: (name: string, task: () => Promise<void>) => void;
}
