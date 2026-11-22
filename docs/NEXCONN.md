# Nexconn integration cheat sheet

How CrewArcade uses Nexconn, with the exact shapes we rely on. **The live docs win**: when
<https://docs.nexconn.ai/llms.txt> (every page is fetchable as `.md`) disagrees with this file, follow
the docs and fix this file in the same change.

## Built with the official Nexconn coding-agent skill

CrewArcade is built with Nexconn's official AI integration skill, **`nexconn-chat`**
([github.com/NexconnAI-Dev/nexconn-skills](https://github.com/NexconnAI-Dev/nexconn-skills)), installed
per [Install Nexconn Skills](https://docs.nexconn.ai/chatsdk-web/build-with-ai/install-skills.md):

```bash
npx skills add https://github.com/NexconnAI-Dev/nexconn-skills.git --agent claude-code --skill '*' --copy -y
```

It lives in `.claude/skills/nexconn-chat/` (pinned in `skills-lock.json`). Every phase that writes
Nexconn code uses it: it fetches the live docs (`scripts/fetch-docs.sh`, cache gitignored), forbids
inventing API details, and enforces secret isolation (App Secret, signing and token issuance only on
our server). Every fact below was checked with it on **2026-11-13** unless marked _unverified_.

**Integration decision (skill's five-layer framework):** _Layer 3, Chat SDK API + our own UI._ Chat UI
for Web is "not tuned for portrait H5 mobile layouts" (Chat UI Web quickstart), and we need custom
cards, an embedded game player and a bottom-sheet flow. Packages: `@nexconn/engine` + `@nexconn/chat`
(npm), data center Singapore (`AreaCode.SG`).

## Console and plans

- Console: <https://console.nexconn.ai>. App Key and App Secret: **Key Management** page
  (`/agile/apps/km`), which also shows the data center. One App Key per app for dev, test and release.
- **Free plan (pricing page):** new apps start on Free, valid **one month**, no card. Up to **2,000 MAU**,
  PCC 5% of MAU, 500 MB storage/upload, no overage: over the limit new connections fail. **After it
  expires the app is blocked until a paid plan is chosen.** Free includes pre-messaging webhooks,
  client-side presence, message metadata, read receipts, typing, mentions, translation (10K chars).
  Free limits we must respect: **300 members per group channel**, **50 concurrent open channels**,
  message size 15K.
- _Unverified:_ the **Free Chat Plan promo** (10K MAU, Pro features, locked in once the first message is
  sent before 2026-12-31 SGT) is **not on the pricing page**. Confirm in the console or the challenge
  announcement before relying on it, and send a first message early.
- MAU = unique user IDs that connect through a client SDK in a calendar month (what judges count).

## Server API basics

- **Base URL (Singapore):** `https://api.sg-light-api.com`, backup `https://api-b.sg-light-api.com`.
  Failover: on a timeout (recommended 5 s) or an unexpected HTTP status, switch to the backup and
  remember the switch. Avoid long-lived keep-alive: drop a connection after 55 s idle or 80 reuses.
  Config: `NEXCONN_API_BASE`, `NEXCONN_API_BACKUP`.
- **Every call is `POST`** with headers:

  | Header         | Value                                                         |
  | -------------- | ------------------------------------------------------------- |
  | `App-Key`      | App Key                                                       |
  | `Nonce`        | random string, ≤ 18 chars, new per request                    |
  | `Timestamp`    | Unix time in **ms**                                           |
  | `Signature`    | lowercase hex `sha1(AppSecret + Nonce + Timestamp)`           |
  | `X-Request-ID` | optional, ≤ 36 chars, new per request (recommended, for logs) |
  | `Content-Type` | `application/json` (v4 endpoints)                             |

  Bad signature → HTTP `401`. Success → body `code: 0`. Refreshing the App Secret invalidates every token.

- **IDs:** user and channel IDs are **letters and digits only**, ≤ 64 bytes; avoid sequential IDs.
  Our IDs come from `newId()` in `@crewarcade/shared` (alphanumeric nanoid with a prefix).
  The spec's agent IDs (`agent-pixel`, ...) contain `-`, so at the Nexconn boundary we always use
  `nexconnUserId(id)` (`agent-pixel` → `agentpixel`). See "Discrepancies" below.

### Issue a user token

`POST /v4/auth/access-token/issue` · 200 req/s

```json
{ "userId": "u4fK9xQ2LmN8pR3tV", "name": "Asha", "avatarUrl": "https://…/a.png" }
```

`name` is **required** (≤ 64 chars, used for push), `avatarUrl` optional (≤ 1024 bytes). Response:
`{ "code": 0, "result": { "userId": "…", "accessToken": "…(≤256 bytes)" } }`. The same userId can be
re-issued; all valid tokens work; re-issuing overwrites name/avatar. Tokens never expire by default.
Clients never call this; our server does, then stores the token encrypted
(`users.nexconn_token_encrypted`, AES-256-GCM with `TOKEN_ENCRYPTION_KEY`).

### Group channels (crews and game rooms)

`POST /v4/group-channel/create` · 100 req/s

```json
{
  "channelId": "crewAbC123…",
  "name": "Friday Crew",
  "owner": "u…",
  "userIds": ["agentpixel", "agentforge", "agentglitch"],
  "groupProfile": { "introduction": "≤512", "announcement": "≤1024", "portraitUrl": "≤128 chars" },
  "permissions": { "joinPerm": 0, "removePerm": 0, "memInvitePerm": 0, "invitePerm": 0, "profilePerm": 0, "memProfilePerm": 0 }
}
```

`userIds` ≤ 30 per request. Permissions: `joinPerm` 0 owner approval (default) / 1 open / 2 owner or
admin / 3 closed; `removePerm` and `memInvitePerm` and `profilePerm` 0 owner / 1 owner+admins / 2 all;
`invitePerm` 0 no consent needed / 1 consent. `groupExtProfile` keys start with `ext_`, key ≤ 32 chars,
value ≤ 256 chars, ≤ 10 pairs. Response `{ "code": 0 }`. We join people with our invite codes, so the
server adds members directly:

`POST /v4/group-channel/join` · 100 req/s · `{ "channelId": "…", "userIds": ["…"] }` (≤ 100), no approval.

Account deletion (Phase 6, checked against the live docs 2026-11-19):
`POST /v4/group-channel/member/kickout-all` · 100 req/s · `{ "userId": "…" }` removes the user from every
group of the app; `POST /v4/group-channel/dismiss` · 100 req/s · `{ "channelId": "…" }` deletes a group.

### Send a group message as anyone (agents included)

`POST /v4/group-channel/message/send` · **20 messages/s** (3 target groups = 3 messages)

```json
{
  "fromUserId": "agentpixel",
  "toChannelIds": ["crewAbC…"],
  "messageType": "CA:PlanCard",
  "content": "{\"v\":1,\"gameId\":\"g…\",…}",
  "pushContent": "Pixel posted a plan",
  "isEchoToSender": 0,
  "shouldPersist": 1,
  "hasMetadata": true,
  "metadata": { "status": "pending", "yes": "0", "no": "0", "voters": "{}" },
  "needReadReceipt": 0
}
```

- `toChannelIds` ≤ 3; `toUserIds` (targeted message) only with one channel, and then no metadata/push fields.
- `messageType`: built-in (`RC:TxtMsg`, …) or custom: must not start with `RC:` (the Web docs also
  reserve `NC:`), ≤ 32 chars, registered on the client. Ours: one type per card
  (`CA:PlanCard`, `CA:HandoffCard`, `CA:BuildCard`, `CA:TestCard`, `CA:PublishCard`, `CA:BugCard`,
  `CA:ScoreCard`, `CA:RoomLink`) plus `CA:AgentState`, `CA:Notice`, `CA:Reaction`, `CA:Typing`
  (`MESSAGE_TYPES` in `@crewarcade/shared`).
- `content` is a **JSON string**, ≤ 10 KB (except image/stream/voice/… types).
- Flags are **numbers** (`isEchoToSender`, `shouldPersist`, `hasMention`, `needReadReceipt`: 0/1);
  `hasMetadata`, `disablePush` are **booleans**. `hasMetadata`/`metadata` work only with one target channel.
- Response: `{ "code": 0, "result": { "messageIds": [{ "channelId": "…", "messageId": "XXXX-…" }] } }`.
  We store `messageId` in `cards.nexconn_message_id`.

### Message metadata (live card state: votes, approval)

`POST /v4/channel-type/message/metadata/set` · 100 req/s overall, **group metadata 20/s**

```json
{
  "messageId": "XXXX-…",
  "userId": "u…",
  "channelType": 3,
  "channelId": "crewAbC…",
  "metadata": { "yes": "2", "no": "0", "voters": "{\"u123\":\"yes\",\"u456\":\"yes\"}" },
  "isEchoToSender": 1
}
```

The message must have been sent with `hasMetadata: true`. Keys ≤ 32 chars of letters, digits and
`+ = - _`; values ≤ 4096 chars; ≤ 100 pairs per request, ≤ 300 per message. Clients get
`onMessageMetadataUpdated`. Our keys (Phase 2): plan `status` (pending | approved | changes_requested |
superseded), `yes`, `no`, `voters` (JSON `{nexconnUserId: "yes"|"no"}`), `approvedBy`, `supersededBy`,
`roomChannelId`; handoff/build/test/publish/bug `status` (+ `decidedBy`, `decidedAt`, `reproClipUrl`,
`fixedInVersion`). The server always writes the full set computed from `cards.state`, so a retried
`metadata/set` is idempotent; the operator `userId` is the human who acted (votes, approval) or the
agent. 30 voters in one JSON value stay far below 4,096 chars (tested).

### Streaming (AI-style) messages

`POST /v4/group-channel/message/stream/send` (direct: `/platform-chat-api/message/send-direct-stream.md`)

```json
{
  "fromUserId": "agentforge",
  "toChannelId": "gameXyz…",
  "messageType": "RC:StreamMsg",
  "content": {
    "content": "Building the title screen…",
    "seq": 1,
    "complete": false,
    "type": "markdown",
    "user": { "id": "agentforge", "name": "Forge · Builder", "portrait": "https://…/agents/forge.svg" }
  },
  "isEchoToSender": 1,
  "shouldPersist": 1
}
```

- Note **`toChannelId` (singular)** and **`content` is an object**, not a JSON string.
- First chunk: no `messageId`; set `type` (`text` | `markdown` | `html`), `user`, `mentionedInfo`,
  `extra` only here. Response `result.messageId` (first chunk only); send it in every later chunk.
- `seq` starts at 1 and increases by exactly 1. Last chunk `complete: true` (optional `completeReason`).
- All chunks together ≤ 128 KB. `isEchoToSender` defaults to **1** here. `toUserIds` ≤ 10 for targeted streams.
- Re-checked against the live page on **2026-11-14**: request/response shapes above are current; the
  docs list `content` as required on every chunk (we never send an empty one: the closing chunk
  carries the tail, or a single space). `metadata` is accepted on stream sends; we do not use it.
- Ours: `apps/server/src/nexconn/stream.ts` batches deltas every ~300 ms, ≤ 1 KB per chunk, keeps the
  total under 128 KB (truncates with "…"), and on any failure sends the full reply once as `RC:TxtMsg`.
- Web: a stream arrives through `onMessageReceived` as an `RC:StreamMsg` whose content is
  `StreamMessageContent { content, isCompleted }`. While not completed the client calls
  `message.requestStreamMessage()`; chunks then arrive on `onStreamMessageRequestDelta` (keyed by
  `messageId` only, so the client finds the channel itself) and the end on
  `onStreamMessageRequestComplete`. History loads carry the final content. _Unverified until the first
  live run:_ whether chunks also arrive without `requestStreamMessage()` for online receivers.
- Web client: `MessageHandler.onStreamMessageRequestInit({ messageId })`,
  `onStreamMessageRequestDelta({ messageId, chunkInfo: { content, messageContent } })`
  (`messageContent` = everything so far), `onStreamMessageRequestComplete({ messageId, code })`.

#### Live stream findings (repro `pnpm --filter @crewarcade/server stream:repro`, 2026-11-14)

- Continuation chunks must carry **`messageId`** inside `content`. With the legacy **`messageUID`**
  every continuation became a NEW message (each response returned a new messageId): do not use it.
- With `messageId`, Nexconn assembles the stream correctly: when the last chunk (`complete: true`)
  lands, every online client gets `onMessageMetadataUpdated` with
  `RC_Ext_StreamMsgSummary = {"complete":true,"summary":"<full text>"}` (also with 0 ms between chunks).
- **Web SDK 26.2.1 never fires `onMessageReceived` for a server-sent `RC:StreamMsg`** (a control
  `RC:TxtMsg` from the same sender in the same run did fire). Handlers were registered before connect.
- **History** (`createMessagesQuery`, `getMessagesByIds`) returns the stream with `content` = the
  FIRST chunk only, `isCompleted: false` and empty `metadata`, even after completion. This is the
  "only part one" symptom: the stream was fine, the client read the wrong field.
- `requestStreamMessage()` on a history copy works: init → one delta with the full text
  (`chunkInfo.messageContent`) → complete (code 0).
- **What we do (Phase 3):** the server streams in ~300 ms chunks again (`mode: 'chunked'`, a debug log
  per chunk) and, right after chunk 1, re-sends the agent's `CA:AgentState` with `streamId` = the new
  messageId; the client fetches that message by id (`getMessagesByIds`) and calls
  `requestStreamMessage()`, so the reply grows live. `RC_Ext_StreamMsgSummary` fills in the final text.
- Client rule that follows: for every `RC:StreamMsg` (live or history) call `requestStreamMessage()`
  unless we already have its full text; also apply `RC_Ext_StreamMsgSummary` from metadata updates
  (keyed by messageId, the client finds the channel itself). Since live chunks are not pushed, the
  first sight of a live reply is the summary update or the catch-up fetch.

### Direct messages from agents (Glitch's score challenges, Phase 3)

`POST /v4/direct-channel/message/send` (`toUserIds`, `RC:TxtMsg` from `agentglitch`). The Web SDK keys
a direct channel by the other user's id, so these arrive as channel `agentglitch`; history uses
`new DirectChannel('agentglitch')`. The app shows them read-only at `/messages/glitch`.

### Open channels (Live Build Theater)

`POST /v4/open-channel/create` · 100 req/s

```json
{ "channelId": "liveAbC…", "destroyType": 0, "ttlMinutes": 120 }
```

`destroyType` 0 = destroy after `ttlMinutes` of inactivity, 1 = destroy `ttlMinutes` after creation
(60–10,080, default 60). Also `shouldFreeze`, `allowedSendersList` (≤ 20), `metadataOwnerId` +
`metadata` (≤ 20 entries, key ≤ 128 chars). Online-only (no offline storage/push). **Free plan: 50
concurrent open channels**, so live rooms must be closed when a build ends. _To verify in Phase 5:_ send,
destroy, participants and metadata endpoints (`/platform-chat-api/open-channel/*.md`) and the Web join
flow (`/chatsdk-web/open-channel/*.md`).

## Webhooks

- One URL for all events: Console → **Chat → Chat settings → Webhooks → Config**. Ours:
  `PUBLIC_API_ORIGIN/webhooks/nexconn`. Singapore sender IPs are listed on the overview page.
  Because the console takes **one** URL, pre-messaging events arrive there too and are answered
  synchronously in the same handler (`apps/server/src/webhooks/routes.ts`); `/webhooks/nexconn/pre` is
  only an alias. Flow: verify the signature (constant time) and that `Timestamp` is within
  `WEBHOOK_MAX_SKEW_MS` (the signature does not cover the body) → `*:pre_messaging` answers
  `{ "pass": 1 }` at once (Phase 1) → other events: insert the event id into `webhook_events`
  (duplicate → 200), reply 200, process asynchronously (in-process now; pg-boss in Phase 3).
- Body: `{ "type": "message:send", "id": "<uuid or snowflake>", "time": <ms>, "data": [ { … } ] }`
  (`WebhookEnvelope` in shared; empty fields omitted).
- Verify headers **`AppKey`** (no dash, unlike API calls), `Nonce`, `Timestamp`, `Signature`, where
  `Signature = sha1(AppSecret + Nonce + Timestamp)` lowercase hex. Mismatch → discard.
- Delivery: 5 s timeout, **3 attempts total**; any 2xx is success. Circuit breaker: if 30 events in a
  minute all fail, delivery pauses for 1 minute. → Handlers answer fast and are idempotent: insert
  the event id into `webhook_events` first, skip duplicates, do the work after replying.
- Events we use:
  - `message:send` data: `userId, channelId, channelType, messageType, content (JSON string), time,
messageId, os (iOS|Android|Websocket|Server)`, optional `groupUserIds, aiGenerated, profanityType`.
    → `messages_log`, agent triggers (@mentions, pitches, bug reports).
  - `user:connection_status` data: `status` **string** `"0"` connected / `"1"` disconnected / `"2"`
    logged out, `userId`, `os`, `time`, `clientIp`, `sessionId`. Abnormal disconnects arrive within 5 min.
    → `connections` (event id as key), `/stats` unique users.
  - `group_channel:operation` (join/leave/kick/create/dismiss), `group_channel:changed`, and
    `open_channel:operation` for viewer counts. _Payloads to verify when implemented._ Phase 1
    acknowledges every other event type and logs it at debug.
  - Server-API sends (Pixel's welcome, join notices) reach `message:send` only when **Include Server
    API Messaging in post-event webhooks** is on (Chat → Chat settings → Messages).

### Console setup (once per App Key)

1. <https://console.nexconn.ai> → your app → **Key Management**: copy the **App Key** and **App Secret**
   into Render (`NEXCONN_APP_KEY`, `NEXCONN_APP_SECRET`). Check that the data center is **Singapore**.
2. **Chat → Chat settings → Webhooks → Config**: URL `https://<render-service>.onrender.com/webhooks/nexconn`.
   Add the events **`message:send`**, **`user:connection_status`** and **`group_channel:pre_messaging`**
   (Phase 4 also needs `direct_channel:pre_messaging`). Save.
3. **Chat → Chat settings → Messages**: turn on **Include Server API Messaging in post-event webhooks**.
4. **Chat → Chat settings**: turn on **Subscribe to user online status** (presence dots) and, if the
   console lists it, **group read receipts** (the "Seen by" sheet).
5. Leave automatic moderation and the profanity filter off: our pre-messaging shield owns safety.
6. Send one message in a crew (this also locks in the plan promo if it applies) and check the server
   log shows `webhook: processed` for `message:send`.

- Channel types: 1 direct, 3 group, 4 open, 6 system, 10 community.

### Pre-messaging (synchronous safety gate)

Events `direct_channel:pre_messaging`, `group_channel:pre_messaging`, `open_channel:pre_messaging`,
`community_channel:pre_messaging`. Available on **Free and Pro, not Starter**. Same URL as other webhooks.

- `data[0]`: `appKey, userId, channelId, channelType, messageType, content (JSON string), time,
messageId, os`, optional `pushContent, disablePush, pushConfig, isMetadata, metadata, groupUserIds,
clientIp, aiGenerated`.
- Respond within **5 s**, HTTP 200:
  `{ "pass": 0|1|2, "replaceContent"?, "replacePushContent"?, "replaceDisablePush"?, "replacePushConfig"?,
"replaceMetadata"?: { "key": { "v": "value" } }, "extra"? }`. `pass` 0 blocks, 1 allows, 2 allows
  and skips remaining callbacks. `extra` (≤ 1024 chars) reaches the sender only when blocked.
- If all 3 attempts time out, the original message is delivered. So the gate must be cheap and
  deterministic (regex rules, prompt-injection heuristics); slow AI review happens after delivery.
- We do **not** use Nexconn automatic moderation (English/Arabic only, needs a card).
- **Live finding (2026-11-19):** on our App Key the console would not let us select the pre-messaging
  events, although the pricing page lists them for Free. Asked Nexconn (`docs/outreach/pre-messaging.md`).
  Until it is enabled the shield runs **after delivery** (below); the same rules answer pre-messaging
  the moment events arrive, and `/safety` shows which mode is live.

### Delete for everyone (the shield's after-delivery mode)

`POST /v4/message/delete` (docs: /platform-chat-api/message/msgrecall.md, checked 2026-11-20; 100/s):
`{ fromUserId, channelType (1|3|4|6|10), channelId, messageId, sentAt?, disablePush?, extra? }` → `{ code: 0 }`.
`messageId`/`sentAt` come from the `message:send` webhook. Clients replace the message with a delete
notice; the Web SDK fires `onMessageDeleted` (our reducer drops it). `deleteMessage()` in
`apps/server/src/nexconn/api.ts`; flow in `apps/server/src/safety/runtime.ts`.

## Web client (`@nexconn/chat`)

Installed: **`@nexconn/chat@26.2.1` + `@nexconn/engine@26.2.1`** (npm `latest`, same version for both,
as the import guide requires). Every name below was checked in
`apps/web/node_modules/@nexconn/chat/index.d.ts` on 2026-11-13. Our wrapper is
`apps/web/src/lib/nexconn/NexconnProvider.tsx` (one provider for the whole signed-in app).

```ts
import {
  NCEngine,
  AreaCode,
  LogLevel,
  ConnectionStatus,
  ConnectionStatusHandler,
  MessageHandler,
  ChannelHandler,
  UserHandler,
  GroupChannel,
  BaseChannel,
  SendTextMessageParams,
  SendMessageParams,
  Helper,
  MentionedType,
  SubscribeType,
  MessageReadReceiptStatus,
} from '@nexconn/chat';

NCEngine.initialize({ appKey, areaCode: AreaCode.SG, logLevel: LogLevel.WARN }); // once per page lifetime (DEBUG in dev)
NCEngine.registerCustomMessages(MESSAGE_TYPE_REGISTRY); // BEFORE connect: { messageType, isPersisted, isCounted, isStatusMessage? }
NCEngine.addConnectionStatusHandler(id, new ConnectionStatusHandler({ onConnectionStatusChanged({ status, code }) {} }));
NCEngine.addMessageHandler(
  id,
  new MessageHandler({
    onMessageReceived,
    onOfflineMessageSyncCompleted,
    onMessageDeleted,
    onMessageBlocked /* { info: { messageId, channelIdentifier, blockType, extra? } } */,
    onMessageReceiptResponse /* { responses: [{ messageId, readCount, totalCount, users }] } */,
    onMessageMetadataUpdated,
    onStreamMessageRequestInit,
    onStreamMessageRequestDelta,
    onStreamMessageRequestComplete,
  }),
);
NCEngine.addChannelHandler(id, new ChannelHandler({ onTypingStatusChanged({ channelIdentifier, userTypingStatus }) {} }));
NCEngine.addUserHandler(id, new UserHandler({ onSubscriptionChanged({ events }) {} }));
const res = await NCEngine.connect({ token }); // NCResult: res.isOk / res.code / res.data.userId; the SDK reconnects every 5 s itself
```

- **Lifecycle:** the browser asks our server for its token (`POST /api/nexconn/token` →
  `{ token, appKey, userId }`). `appKey` comes from the server, so the web app needs no Nexconn env.
  The SDK is loaded with `import('@nexconn/chat')` inside the provider (never during SSR, never on the
  landing page). `ConnectionStatus` = `CONNECTED 0 | CONNECTING 1 | DISCONNECTED 2 | SUSPENDED 3`.
  Codes we act on (`/chatsdk-web/code.md`): `31004` token invalid or expired → ask the server for a
  fresh token (`{ refresh: true }` re-issues it) and connect again; `31010` kicked by another login →
  banner with "Use it here"; `33007` auto-reconnect exhausted → connect again. The browser `online`
  event triggers a manual connect only when the SDK reports `DISCONNECTED` (not while `CONNECTING`).
- **Send:** `new GroupChannel(id).sendMessage(new SendTextMessageParams({ text, mentionedInfo? }))`;
  custom types with `new SendMessageParams(content, 'CA:…')`; media with
  `Helper.createSendImageMessageParams(file)` / `Helper.createSendHDVoiceMessageParams(file)`
  (→ `NCResult<Send…Params>`), then `channel.sendMediaMessage(params)` with `onUploadProgress(progress)`.
  We set `params.needReceipt = true` on text, image and voice. Client limit: **5 messages/s across all channels**.
- **Mentions** (`/chatsdk-web/group-channel/groupat.md`): `mentionedInfo: { type: MentionedType.USERS, userIdList }`.
  The chat package's `MentionedType` is `{ ALL: 1, USERS: 2 }` (the engine's own enum says `SINGAL`; use the chat one).
- **History:** `BaseChannel.createMessagesQuery({ channelIdentifier: new GroupChannel(id).identifier, startTime, pageSize: 30, isAscending: false })`
  → `query.loadNextPage()` → `res.data.data`; `query.hasNext` says whether more pages exist. Web keeps
  nothing locally: every page comes from the server. Channel list (previews, unread):
  `BaseChannel.createChannelsQuery({ pageSize: 50 }).loadNextPage()` → `BaseChannel[]` with
  `latestMessage` and `unreadCount`; `channel.clearUnreadCount()` while a chat is open.
- **Read receipts (group):** the reader calls `channel.sendReadReceiptResponse(messageIds)`; the sender gets
  `onMessageReceiptResponse`; on history load `channel.getMessageReadReceiptInfo(ids)` →
  `{ messageId, readCount, totalCount }[]`; the "Seen by" list is
  `BaseChannel.createMessagesReadReceiptUsersQuery({ channelIdentifier, messageId, pageSize, status: MessageReadReceiptStatus.RESPONDED })`.
- **Typing:** `sendTypingStatus(type)` exists **only on `DirectChannel`** in 26.2.1. Group channels
  support transient status messages (Channel Guide: online members receive them instantly; not
  stored; not counted toward quotas), so groups use **`CA:Typing`** (registered `isPersisted: false,
isCounted: false, isStatusMessage: true`), sent at most every 4 s while typing; receivers show it for
  6.5 s. The server leaves status types out of `messages_log`.
- **Presence** (`/chatsdk-web/user/subscribe_online.md`):
  `NCEngine.userModule.subscribeEvent({ userIds, subscribeType: SubscribeType.ONLINE_STATUS })`, then
  `NCEngine.userModule.getSubscribeUsersOnlineStatus(userIds)` → `{ userId, isOnline }[]`. On
  `onSubscriptionChanged` we re-query those users instead of decoding `details[].eventValue`. Needs the
  console service **Subscribe to user online status**. Agents show as "Always here".
- **Blocked messages:** `onMessageBlocked({ info })` → an inline "Not delivered: <extra>" under the
  sender's message (`extra` comes from our pre-messaging answer; the rules arrive in Phase 4).
- Offline messages are kept 7 days and arrive through `onMessageReceived` during sync;
  `onOfflineMessageSyncCompleted` refreshes the channel list.

### Built-in translation

- Enable: Console → **Chat → Chat settings → Messages → Translation**.
- `NCEngine.translateModule`: `setTranslationLanguage('hi')`, `getTranslationLanguage()`,
  `setAutoTranslateEnabled(true)`, `getAutoTranslateEnabled()` (all `{ isOk, data }`), per-channel
  strategy, `translateMessages({ list: TranslateMessageParam[] (≤10), force? })` where
  `new TranslateMessageParam(messageId, 'auto', 'hi', text)` (**`text` is required on Web**, else
  error 35060), and `translateTexts({ list: TranslateTextParam[] })`. The promise only means
  "accepted"; results arrive on `TranslateHandler.onTranslationCompleted`. Mode: `MECHANICAL` only.
- Codes we offer: `en hi ta bn te mr gu kn ml ur` (verified on the supported-languages page).
- **Billing:** Free includes **10,000 characters**; beyond that a card is required (else translation
  is disabled). Billed daily, and **a day with any usage is billed as at least 1,000 characters** → at
  most ~10 billable days on the free allowance. Translate on demand (tap to translate), batch per day,
  and track `usage.translations_chars`.
- **Phase 5 (tap only, no auto-translate):** [Translate] under someone else's message first calls
  `POST /api/translate/quota {chars}`, which reserves characters of `LIMITS.dailyTranslationChars` per
  user per day in `usage.translations_chars` (one atomic upsert). Over the cap the user gets a friendly
  "back tomorrow" message. Then `setTranslationLanguage(<user language>)` (once) and `translateMessages`
  with the text. The result arrives on `NCEngine.addTranslateHandler(..., new TranslateHandler({
onTranslationCompleted }))` (`results[].identifier` = messageId, `code === 0`, `translateInfo.translatedText`).

## Speech-to-text (voice pitches, Hindi/Hinglish)

Nexconn's Web SDK has voice **messages** (`RC:HQVCMsg`). Its type definitions (26.2.1) also list a
speech-to-text event for HQ voice (`SpeechToTextCompletedEvent`), but it isn't in llms.txt and it
isn't built for Hinglish, so we use **Sarvam AI**: `POST https://api.sarvam.ai/speech-to-text`,
header `api-subscription-key`, multipart `file`, `model`, `mode`, `language_code=unknown`. Live docs
(checked 2026-11-17): models `saaras:v4` (default) and `saaras:v3`. **`mode` (`transcribe`,
`translate`, `verbatim`, `translit`, `codemix`) is documented for `saaras:v3`**, so we send
`saaras:v3` + `mode=codemix`. Response `{ transcript, language_code }`. REST is for clips under 30 s
(WAV, MP3, AAC, M4A, OGG, OPUS, WebM…). Server only (`SARVAM_API_KEY`, `apps/server/src/ai/sarvam.ts`).

**Voice pitch flow (Phase 5):** the composer sends an HQ voice note with `mentionedInfo` when the
user typed `@pixel` (etc.) before recording. On `message:send` (or the browser relay, only for hosts
in `NEXCONN_MEDIA_HOSTS`) the server queues an agent job. Only notes that mention an agent, or any
note in a solo crew, are transcribed. The job downloads the file (https, ≤ 3 MB, ≤ 30 s), transcribes
it and routes the transcript exactly like a text message. On any failure the agent posts a friendly
"type it instead" line.

## Secret isolation (enforced)

- Browser: only `NEXT_PUBLIC_NEXCONN_APP_KEY` (public by design), the user's own access token
  (fetched from our server after sign-in), and our API origin.
- Server only: `NEXCONN_APP_SECRET`, signing, token issuance, webhook verification, every Platform
  Chat API call.
- CI: `scripts/check-client-secrets.mjs` fails if a server secret name appears in `apps/web` or
  `packages/shared`, or in the built bundle; ESLint blocks non-`NEXT_PUBLIC_` env reads in browser code.

## Discrepancies found (prompt facts vs live docs vs installed SDK)

1. **Agent user IDs**: the docs allow only letters and digits; `agent-pixel` has a dash. We keep the
   DB IDs and map with `nexconnUserId()` (`agent-pixel` → `agentpixel`). **Decided by the owner
   (2026-11-13): keep the mapping.** Every Nexconn call (tokens, channel members, `fromUserId`) and
   every webhook lookup goes through it; never pass a DB user ID to Nexconn directly.
2. **Streaming send** uses `toChannelId` (singular) and an object `content`; `isEchoToSender` defaults to 1.
3. **Webhook signature header** is `AppKey`, not `App-Key`.
4. **Free plan**: one month, 2,000 MAU, app blocked after expiry; the 10K-MAU promo is not documented.
5. **Translation**: daily minimum of 1,000 billable characters on any day with usage.
6. **Group create**: `groupProfile.portraitUrl` ≤ 128 chars; `groupExtProfile` values ≤ 256 chars; rate
   limit 100/s. Joining is `POST /v4/group-channel/join` (≤ 100 users, no approval).
7. Free plan limits worth designing around: 300 members/group, 50 concurrent open channels, 15K message size.
8. **`registerCustomMessages` flag:** the customize doc says `isPersited`; the installed typings
   (`CustomMessageRegistration`, 26.2.1) say **`isPersisted`**. The installed code wins; the shared
   registry uses `isPersisted`. (Phase 1)
9. **Group typing:** the typing doc calls `sendTypingStatus` on a channel, but in 26.2.1 only
   `DirectChannel` has it. Groups use the `CA:Typing` status message. (Phase 1)
10. **Read-receipt users query:** the doc example passes `MessageReadReceiptStatus.READ`; the enum is
    `{ RESPONDED: 0, UNRESPONDED: 1 }`. We use `RESPONDED`. (Phase 1)
11. **`MentionedType`:** the engine enum has `ALL = 1, SINGAL = 2`; the chat package exports
    `{ ALL: 1, USERS: 2 }` as the groupat doc says. We use the chat package's. (Phase 1)
12. **`NCEngine.connect` result** is an `NCResult` with `isOk`, `code`, `msg` and `data` (this sheet
    used to say `{ code, data }`). (Phase 1)
13. **Group `joinPerm`:** crews are created with `joinPerm: 0` (client-side joins need the owner's
    approval, which our UI never offers) and people are added with the server `join` API, which the
    docs say needs no approval. Whether `3` ("nobody can join") also blocks the server API is
    unverified, so we did not use it. (Phase 1)
14. **Server-sent status messages:** the Platform API has no `isStatusMessage` flag; `CA:AgentState`
    is sent with `shouldPersist: 0`, `disablePush: true`, `disableUpdateLastMsg: true`, and clients
    treat it as a status message because it is registered with `isStatusMessage: true`. (Phase 2)
15. **Card types:** the Phase 0 sheet planned one `CA:Card` envelope; Phase 2 uses one registered type
    per card (see SPEC §5 decision). All ≤ 32 chars, none start with `RC:`/`NC:`. (Phase 2)
16. **groupExtProfile keys must exist first:** the create-group page documents `groupExtProfile` (`ext_` keys,
    ≤ 10 pairs) but does not say the keys must be registered for the app. Live, sending
    `ext_crewId` fails with **25415 "The extended profile key does not exist"** (codes page). We no longer
    send it; the database maps channel → crew/game. (First live run, 2026-11-14)
17. **Multi-chunk streams keep only chunk 1 (live, 2026-11-14):** server-sent `RC:StreamMsg` with chunk 1
    (`type`, `user`) and chunk 2 (`messageId`, `seq: 2`, `complete: true`), all answered `code: 0`, showed
    only chunk 1's text in history ("part one," of "part one, part two"), and the Web SDK 26.2.1 client got
    no live `onStreamMessageRequest*` events. A single chunk with `complete: true` arrives whole. So
    `streamToGroup` then defaulted to one complete chunk per reply. **Superseded (Phase 3, 2026-11-16):**
    with `messageId` on every chunk the stream assembles correctly, so `mode: 'chunked'` is the default
    again and clients pull the text with `requestStreamMessage()` (see "Live stream findings").
