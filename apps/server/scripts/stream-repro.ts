// Minimal live repro for Nexconn multi-chunk streams (RC:StreamMsg) in a group channel.
//
// 1. Creates a throwaway group with Pixel (sender) and a probe user (receiver).
// 2. Opens a headless Chromium page with @nexconn/chat (Web SDK), connects as the probe user,
//    registers every handler BEFORE connect, logs onMessageReceived / stream init, delta, complete /
//    metadata updates, and calls requestStreamMessage() on each incoming stream.
// 3. Sends 3-chunk streams in variants, logging every request body and raw response:
//      A  continuation chunks carry `messageId`                 (current docs)
//      B  continuation chunks carry `messageUID`                (legacy name)
//      C  `messageId` and the chunks sent with no pause at all
// 4. Loads the channel history and prints, per stream: the stored `content`, `isCompleted` and the
//    message metadata (Nexconn puts the final text in RC_Ext_StreamMsgSummary).
//
//   pnpm --filter @crewarcade/server stream:repro          (needs NEXCONN_APP_KEY / SECRET in .env)
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
import { launchBrowser } from '@crewarcade/engine';
import { z } from 'zod';
import { createGroup, issueToken } from '../src/nexconn/api';
import { NexconnClient, type FetchLike } from '../src/nexconn/client';

const appKey = process.env.NEXCONN_APP_KEY;
const appSecret = process.env.NEXCONN_APP_SECRET;
if (!appKey || !appSecret) {
  console.error('NEXCONN_APP_KEY / NEXCONN_APP_SECRET are not set (apps/server/.env).');
  process.exit(1);
}
const base = process.env.NEXCONN_API_BASE || 'https://api.sg-light-api.com';
const backup = process.env.NEXCONN_API_BACKUP || 'https://api-b.sg-light-api.com';
const t = () => new Date().toISOString().slice(11, 23);

// Every Platform API request and raw response, printed (signature headers left out).
const loggingFetch: FetchLike = async (url, init) => {
  const res = await fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: init.signal });
  const text = await res.text();
  if (url.includes('/stream/')) console.log(`${t()} → POST ${new URL(url).pathname}\n    body ${init.body}\n    ← ${res.status} ${text}`);
  return { status: res.status, text: async () => text };
};
const nexconn = new NexconnClient({ appKey, appSecret, baseUrls: [base, backup], fetch: loggingFetch });
const AnyResult = z.object({ code: z.number(), result: z.object({ messageId: z.string().optional() }).passthrough().optional() }).passthrough();
const post = (p: string, body: unknown) => nexconn.post(p, body, AnyResult, { bucket: 'groupMessage' });

const run = Date.now().toString(36);
const channelId = `streamrepro${run}`;
const probe = `streamprobe${run}`;
const sender = 'agentpixel';

// ---- the receiver page (Web SDK bundled with esbuild, served from 127.0.0.1) --------------------
const require = createRequire(import.meta.url);
const sdkEntry = require.resolve('@nexconn/chat', { paths: [path.resolve(import.meta.dirname, '../../web')] });
const bundle = await build({
  stdin: {
    contents: `import * as NC from ${JSON.stringify(sdkEntry.replace(/\\/g, '/'))}; window.NC = NC;`,
    resolveDir: path.dirname(sdkEntry),
    loader: 'js',
  },
  bundle: true,
  format: 'iife',
  write: false,
  platform: 'browser',
  mainFields: ['browser', 'module', 'main'],
  conditions: ['browser', 'import'],
  // The SDK's engine has Electron/Node code paths that never run in a browser.
  external: ['path', 'fs', 'os', 'crypto', 'electron', 'child_process', 'url'],
  logLevel: 'silent',
});
const sdkJs = bundle.outputFiles[0]!.text;
const server = createServer((req, res) => {
  if (req.url === '/sdk.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(sdkJs);
  res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><script src="/sdk.js"></script><body>probe</body>');
});
await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;

console.log(`${t()} group ${channelId}, sender ${sender}, receiver ${probe}`);
await issueToken(nexconn, { userId: sender, name: 'Pixel' });
const { accessToken } = await issueToken(nexconn, { userId: probe, name: 'Stream probe' });
await createGroup(nexconn, { channelId, name: 'stream repro', owner: probe, userIds: [sender] });

const browser = await launchBrowser();
const page = await browser.newPage();
// tsx compiles with keepNames, which wraps functions passed to page.evaluate in __name().
await page.addInitScript('window.__name = (f) => f;');
page.on('console', m => console.log(`${t()} [web] ${m.text()}`));
await page.goto(`http://127.0.0.1:${port}/`);
const connected = await page.evaluate(
  async ({ appKey, token }) => {
    const { NCEngine, MessageHandler, AreaCode, LogLevel } = (window as never as { NC: Record<string, never> }).NC as never as {
      NCEngine: { initialize(o: object): void; addMessageHandler(id: string, h: object): void; connect(o: object): Promise<{ isOk: boolean; code: number }> };
      MessageHandler: new (o: object) => object;
      AreaCode: { SG: number };
      LogLevel: { WARN: number };
    };
    NCEngine.initialize({ appKey, areaCode: AreaCode.SG, logLevel: LogLevel.WARN });
    const w = window as never as { seen: Record<string, unknown>[] };
    w.seen = [];
    NCEngine.addMessageHandler(
      'repro',
      new MessageHandler({
        onMessageReceived: ({
          messages,
        }: {
          messages: Array<{
            messageId: string;
            messageType: string;
            content: { content?: string; isCompleted?: boolean };
            requestStreamMessage?: () => Promise<{ isOk: boolean; code: number }>;
          }>;
        }) => {
          for (const m of messages) {
            console.log(`received ${m.messageType} id=${m.messageId} content=${JSON.stringify(m.content.content)} isCompleted=${m.content.isCompleted}`);
            if (m.messageType === 'RC:StreamMsg' && m.requestStreamMessage)
              void m.requestStreamMessage().then(r => console.log(`requestStreamMessage id=${m.messageId} -> isOk=${r.isOk} code=${r.code}`));
          }
        },
        onStreamMessageRequestInit: ({ messageId }: { messageId: string }) => console.log(`stream init id=${messageId}`),
        onStreamMessageRequestDelta: ({ messageId, chunkInfo }: { messageId: string; chunkInfo: { content: string; messageContent: string } }) =>
          console.log(`stream delta id=${messageId} chunk=${JSON.stringify(chunkInfo.content)} sofar=${JSON.stringify(chunkInfo.messageContent)}`),
        onStreamMessageRequestComplete: ({ messageId, code }: { messageId: string; code: number }) =>
          console.log(`stream complete id=${messageId} code=${code}`),
        onMessageMetadataUpdated: ({ messageId, metadata }: { messageId: string; metadata: unknown }) =>
          console.log(`metadata updated id=${messageId} ${JSON.stringify(metadata)}`),
      }),
    );
    const r = await NCEngine.connect({ token });
    return r.isOk ? 'ok' : `failed ${r.code}`;
  },
  { appKey, token: accessToken },
);
console.log(`${t()} receiver connect: ${connected}`);

// ---- the streams -------------------------------------------------------------------------------
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function stream(label: string, idField: 'messageId' | 'messageUID', pauseMs: number): Promise<string> {
  console.log(`\n${t()} ===== variant ${label}: continuation field "${idField}", pause ${pauseMs} ms`);
  const parts = [`${label} part one, `, `${label} part two, `, `${label} part three.`];
  const first = await post('/v4/group-channel/message/stream/send', {
    fromUserId: sender,
    toChannelId: channelId,
    messageType: 'RC:StreamMsg',
    content: { content: parts[0], seq: 1, complete: false, type: 'markdown', user: { id: sender, name: 'Pixel' } },
    isEchoToSender: 0,
    shouldPersist: 1,
  });
  const id = first.result?.messageId ?? '';
  for (let i = 1; i < parts.length; i++) {
    await sleep(pauseMs);
    await post('/v4/group-channel/message/stream/send', {
      fromUserId: sender,
      toChannelId: channelId,
      messageType: 'RC:StreamMsg',
      content: { content: parts[i], seq: i + 1, complete: i === parts.length - 1, [idField]: id },
      isEchoToSender: 0,
      shouldPersist: 1,
    });
  }
  return id;
}

// Control: an ordinary text message from the same sender must reach onMessageReceived.
await nexconn.post(
  '/v4/group-channel/message/send',
  {
    fromUserId: sender,
    toChannelIds: [channelId],
    messageType: 'RC:TxtMsg',
    content: JSON.stringify({ content: 'control text' }),
    isEchoToSender: 0,
    shouldPersist: 1,
  },
  AnyResult,
  { bucket: 'groupMessage' },
);
await sleep(2000);

const ids: Record<string, string> = {};
ids.A = await stream('A', 'messageId', 600);
await sleep(3000);
ids.B = await stream('B', 'messageUID', 600);
await sleep(3000);
ids.C = await stream('C', 'messageId', 0);
await sleep(6000);

// ---- what the server stored --------------------------------------------------------------------
console.log(`\n${t()} ===== history (as a client loads it later)`);
const history = await page.evaluate(async channelId => {
  const { BaseChannel, GroupChannel } = (window as never as { NC: Record<string, never> }).NC as never as {
    BaseChannel: {
      createMessagesQuery(o: object): { loadNextPage(): Promise<{ isOk: boolean; code: number; data?: { data: Array<Record<string, unknown>> } }> };
    };
    GroupChannel: new (id: string) => { identifier: unknown };
  };
  const q = BaseChannel.createMessagesQuery({
    channelIdentifier: new GroupChannel(channelId).identifier,
    startTime: Date.now() + 10_000,
    pageSize: 20,
    isAscending: false,
  });
  const r = await q.loadNextPage();
  if (!r.isOk || !r.data) return `history failed ${r.code}`;
  return r.data.data.map(m => ({
    id: m.messageId,
    type: m.messageType,
    content: (m.content as { content?: string }).content,
    isCompleted: (m.content as { isCompleted?: boolean }).isCompleted,
    metadata: m.metadata,
  }));
}, channelId);
for (const [label, id] of Object.entries(ids)) {
  const h = Array.isArray(history) ? history.find(m => m.id === id) : null;
  console.log(`variant ${label} (${id}):`, h ? JSON.stringify({ content: h.content, isCompleted: h.isCompleted, metadata: h.metadata }) : 'not in history', '');
}
if (!Array.isArray(history)) console.log(history);

// ---- pulling the stored streams: requestStreamMessage() and getMessagesByIds ---------------------
console.log(`
${t()} ===== requestStreamMessage() on the history copies, then getMessagesByIds`);
const pulled = await page.evaluate(
  async ({ channelId, ids }) => {
    const { BaseChannel, GroupChannel } = (window as never as { NC: Record<string, never> }).NC as never as {
      BaseChannel: {
        createMessagesQuery(o: object): {
          loadNextPage(): Promise<{
            isOk: boolean;
            data?: {
              data: Array<{
                messageId: string;
                messageType: string;
                requestStreamMessage(): Promise<{ isOk: boolean; code: number }>;
                toObject(): Record<string, unknown>;
              }>;
            };
          }>;
        };
        getMessagesByIds(
          o: object,
        ): Promise<{ isOk: boolean; code: number; data?: Record<string, { content: unknown; metadata?: unknown; toObject(): Record<string, unknown> }> }>;
      };
      GroupChannel: new (id: string) => { identifier: unknown };
    };
    const identifier = new GroupChannel(channelId).identifier;
    const q = BaseChannel.createMessagesQuery({ channelIdentifier: identifier, startTime: Date.now() + 10_000, pageSize: 20, isAscending: false });
    const r = await q.loadNextPage();
    const streams = (r.data?.data ?? []).filter(m => m.messageType === 'RC:StreamMsg' && ids.includes(m.messageId));
    console.log(`history keys: ${Object.keys(streams[0]?.toObject() ?? {}).join(',')}`);
    for (const m of streams) {
      const res = await m.requestStreamMessage();
      console.log(`requestStreamMessage(history ${m.messageId}) -> isOk=${res.isOk} code=${res.code}`);
    }
    await new Promise(res => setTimeout(res, 3000));
    const byId = await BaseChannel.getMessagesByIds({ channelIdentifier: identifier, messageIds: ids });
    return byId.isOk
      ? Object.entries(byId.data ?? {}).map(([id, m]) => ({ id, content: m.content, metadata: m.toObject().metadata ?? null }))
      : `getMessagesByIds failed ${byId.code}`;
  },
  { channelId, ids: [ids.A!, ids.C!] },
);
console.log(JSON.stringify(pulled, null, 1).slice(0, 1500));

await browser.close();
server.close();
