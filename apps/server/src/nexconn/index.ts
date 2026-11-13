// Nexconn server integration: wiring from config. Server only.
import { Agent, fetch as undiciFetch } from 'undici';
import type { Config } from '../config';
import { NexconnClient, type FetchLike, type NexconnLog } from './client';

export * from './api';
export * from './client';
export * from './errors';
export * from './rate-limit';

/**
 * The base-URL guide says not to hold connections forever: switch after 55 s idle or 80 reuses.
 * This agent drops idle sockets after 50 s and recycles each connection after 80 requests.
 */
export function nexconnFetch(): FetchLike {
  const dispatcher = new Agent({ keepAliveTimeout: 10_000, keepAliveMaxTimeout: 50_000, maxRequestsPerClient: 80, connect: { timeout: 5_000 } });
  return (url, init) => undiciFetch(url, { ...init, dispatcher });
}

/** null when the App Key / Secret are not configured (dev before the console app exists). */
export function createNexconnClient(
  config: Pick<Config, 'NEXCONN_APP_KEY' | 'NEXCONN_APP_SECRET' | 'NEXCONN_API_BASE' | 'NEXCONN_API_BACKUP'>,
  log?: NexconnLog,
): NexconnClient | null {
  if (!config.NEXCONN_APP_KEY || !config.NEXCONN_APP_SECRET) return null;
  return new NexconnClient({
    appKey: config.NEXCONN_APP_KEY,
    appSecret: config.NEXCONN_APP_SECRET,
    baseUrls: [config.NEXCONN_API_BASE, config.NEXCONN_API_BACKUP],
    fetch: nexconnFetch(),
    ...(log && { log }),
  });
}
