// The production queue (pg-boss) on PGlite: deterministic ids make enqueues idempotent, and the
// group limit keeps one job per room at a time.
import { PGlite } from '@electric-sql/pglite';
import { fromPglite } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPgBossQueue, type AgentJobData, type JobQueue } from '../src/agents/queue';

let pg: PGlite;
let q: JobQueue;
const log = { info: () => {}, warn: () => {}, error: () => {} };
const job = (key: string, channelId: string): AgentJobData => ({
  key,
  crewId: 'c1',
  channelId,
  messageId: key,
  fromUserId: 'u1',
  agent: 'pixel',
  intent: 'plan',
  text: 'x',
  attachments: [],
});

beforeAll(async () => {
  pg = new PGlite();
  q = createPgBossQueue({ db: fromPglite(pg) }, { concurrency: 4, log, pollingIntervalSeconds: 0.5 });
}, 60_000);
afterAll(async () => {
  await q.stop();
  await pg.close();
});

describe('pg-boss queue', () => {
  it('enqueues once per key and runs jobs with one job per room at a time', async () => {
    expect(await q.enqueueAgent(job('msg:1', 'roomA'))).toBe(true);
    expect(await q.enqueueAgent(job('msg:1', 'roomA'))).toBe(false);
    expect(await q.enqueueAgent(job('msg:2', 'roomA'))).toBe(true);
    expect(await q.enqueueAgent(job('msg:3', 'roomB'))).toBe(true);
    expect(await q.enqueueBuild({ key: 'g1:v1', gameId: 'g1', version: 1, channelId: 'roomA', handoffMessageId: 'H1' })).toBe(true);
    expect(await q.enqueueBuild({ key: 'g1:v1', gameId: 'g1', version: 1, channelId: 'roomA', handoffMessageId: 'H1' })).toBe(false);

    const done: string[] = [];
    let inRoomA = 0;
    let peakA = 0;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`only ran ${done.join(',')}`)), 30_000);
      void q.start(async j => {
        if (j.channelId === 'roomA') peakA = Math.max(peakA, ++inRoomA);
        await new Promise(r => setTimeout(r, 300));
        if (j.channelId === 'roomA') inRoomA--;
        done.push(j.key);
        if (done.length === 3) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    expect(done.sort()).toEqual(['msg:1', 'msg:2', 'msg:3']);
    expect(peakA).toBe(1);
  }, 60_000);
});
