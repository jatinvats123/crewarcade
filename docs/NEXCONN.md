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
  "permissions": { "joinPerm": 0, "removePerm": 0, "memInvitePerm": 0, "invitePerm": 0, "profilePerm": 0, "memProfilePerm": 0 },
  "groupExtProfile": { "ext_gameId": "g…" }
}
```

`userIds` ≤ 30 per request. Permissions: `joinPerm` 0 owner approval (default) / 1 open / 2 owner or
admin / 3 closed; `removePerm` and `memInvitePerm` and `profilePerm` 0 owner / 1 owner+admins / 2 all;
`invitePerm` 0 no consent needed / 1 consent. `groupExtProfile` keys start with `ext_`, key ≤ 32 chars,
value ≤ 256 chars, ≤ 10 pairs. Response `{ "code": 0 }`. We join people with our invite codes, so the
server adds members directly:

`POST /v4/group-channel/join` · 100 req/s · `{ "channelId": "…", "userIds": ["…"] }` (≤ 100), no approval.

### Send a group message as anyone (agents included)

`POST /v4/group-channel/message/send` · **20 messages/s** (3 target groups = 3 messages)

```json
{
  "fromUserId": "agentpixel",
  "toChannelIds": ["crewAbC…"],
  "messageType": "CA:Card",
  "content": "{\"v\":1,\"payload\":{…}}",
  "pushContent": "Pixel posted a plan",
  "isEchoToSender": 0,
  "shouldPersist": 1,
  "hasMetadata": true,
  "metadata": { "status": "voting" },
  "needReadReceipt": 0
}
```

- `toChannelIds` ≤ 3; `toUserIds` (targeted message) only with one channel, and then no metadata/push fields.
- `messageType`: built-in (`RC:TxtMsg`, …) or custom: must not start with `RC:` (the Web docs also
  reserve `NC:`), ≤ 32 chars, registered on the client. Ours: `CA:Card`, `CA:Handoff`,
  `CA:AgentState`, `CA:Notice`, `CA:Reaction` (`MESSAGE_TYPES` in `@crewarcade/shared`).
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
  "metadata": { "vote_u123": "yes" },
  "isEchoToSender": 1
}
```

The message must have been sent with `hasMetadata: true`. Keys ≤ 32 chars of letters, digits and
`+ = - _`; values ≤ 4096 chars; ≤ 100 pairs per request, ≤ 300 per message. Clients get
`onMessageMetadataUpdated`. Our keys: `status`, `actor`, `vote_<userId>` (`META` in shared).

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
- Web client: `MessageHandler.onStreamMessageRequestInit({ messageId })`,
  `onStreamMessageRequestDelta({ messageId, chunkInfo: { content, messageContent } })`
  (`messageContent` = everything so far), `onStreamMessageRequestComplete({ messageId, code })`.

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
- Body: `{ "type": "message:send", "id": "<uuid or snowflake>", "time": <ms>, "data": [ { … } ] }`
  (`WebhookEnvelope` in shared; empty fields omitted).
- Verify headers **`AppKey`** (no dash, unlike API calls), `Nonce`, `Timestamp`, `Signature`, where
  `Signature = sha1(AppSecret + Nonce + Timestamp)` lowercase hex. Mismatch → discard.
- Delivery: 5 s timeout, **3 attempts total**; any 2xx is success. Circuit breaker: if 30 events in a
  minute all fail, delivery pauses for 1 minute. → Handlers answer fast and are idempotent: insert
  the event id into `webhook_events` first, skip duplicates, do the work in a pg-boss job.
- Events we use:
  - `message:send` data: `userId, channelId, channelType, messageType, content (JSON string), time,
messageId, os (iOS|Android|Websocket|Server)`, optional `groupUserIds, aiGenerated, profanityType`.
    → `messages_log`, agent triggers (@mentions, pitches, bug reports).
  - `user:connection_status` data: `status` **string** `"0"` connected / `"1"` disconnected / `"2"`
    logged out, `userId`, `os`, `time`, `clientIp`, `sessionId`. Abnormal disconnects arrive within 5 min.
    → `connections` (event id as key), `/stats` unique users.
  - `group_channel:operation` (join/leave/kick/create/dismiss), `group_channel:changed`, and
    `open_channel:operation` for viewer counts. _Payloads to verify when implemented._
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

## Web client (`@nexconn/chat`)

```ts
import { NCEngine, AreaCode, LogLevel, ConnectionStatusHandler, MessageHandler, GroupChannel, SendTextMessageParams, SendMessageParams } from '@nexconn/chat';

NCEngine.initialize({ appKey, areaCode: AreaCode.SG, logLevel: LogLevel.WARN }); // exactly once per app lifetime
NCEngine.registerCustomMessages(MESSAGE_TYPE_REGISTRY); // BEFORE connect; options: messageType, isPersited, isCounted, isStatusMessage?, remoteFileUrlField?
NCEngine.addConnectionStatusHandler('crew', new ConnectionStatusHandler({ onConnectionStatusChanged({ status, code }) {} }));
NCEngine.addMessageHandler('crew', new MessageHandler({ onMessageReceived({ messages }) {} /* + metadata, stream, offline sync */ }));
const res = await NCEngine.connect({ token }); // res.code === 0 → res.data.userId; built-in reconnect, call once
await new GroupChannel(id).sendMessage(new SendTextMessageParams({ text }));
await new GroupChannel(id).sendMessage(new SendMessageParams(payload, 'CA:Card'));
```

- Install `@nexconn/engine@latest @nexconn/chat@latest`; the docs import everything from `@nexconn/chat`.
  The skill requires checking exact enum/class names in `node_modules/@nexconn/**/*.d.ts` when we install
  them (Phase 1). `areaCode` defaults to SG, `logLevel` to WARN (use Debug while integrating).
- Results are `{ code, data }`; `code === 0` is success.
- History: `BaseChannel.createChannelsQuery({ pageSize })`, `BaseChannel.createMessagesQuery({
channelIdentifier, startTime, pageSize (1–100), isAscending })` → `query.loadNextPage()`. Offline
  messages are kept 7 days.
- Message handler events we use: `onMessageReceived`, `onMessageDeleted`, `onMessageBlocked`,
  `onMessageReceiptResponse`, `onMessageMetadataUpdated`, `onMessageMetadataDeleted`,
  `onOfflineMessageSyncCompleted`, the three stream events. _To verify in Phase 1:_ exact names of all
  but the stream events; channel handler `onTypingStatusChanged`; presence `onSubscriptionChanged`;
  media helpers (`Helper.createSendHDVoiceMessageParams`, image helpers). Doc paths:
  `/chatsdk-web/message/read-receipt.md`, `/chatsdk-web/channel/typing-status.md`,
  `/chatsdk-web/user/subscribe_online.md`, `/chatsdk-web/group-channel/groupat.md`.

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

## Speech-to-text (voice pitches, Hindi/Hinglish)

Nexconn's Web SDK has voice **messages** (`RC:HQVCMsg`) but no speech-to-text API (none in llms.txt),
so we use **Sarvam AI**: `POST https://api.sarvam.ai/speech-to-text`, header `api-subscription-key`,
multipart `file`, `model=saaras:v4` (default; `saaras:v3` still available), `mode=codemix` for
Hinglish (or `transcribe` / `translate`). REST accepts ≤ 30 s of audio (WAV, MP3, AAC, FLAC, OGG,
WEBM…). Server only (`SARVAM_API_KEY`).

## Secret isolation (enforced)

- Browser: only `NEXT_PUBLIC_NEXCONN_APP_KEY` (public by design), the user's own access token
  (fetched from our server after sign-in), and our API origin.
- Server only: `NEXCONN_APP_SECRET`, signing, token issuance, webhook verification, every Platform
  Chat API call.
- CI: `scripts/check-client-secrets.mjs` fails if a server secret name appears in `apps/web` or
  `packages/shared`, or in the built bundle; ESLint blocks non-`NEXT_PUBLIC_` env reads in browser code.

## Discrepancies found (prompt facts vs live docs, 2026-11-13)

1. **Agent user IDs**: the docs allow only letters and digits; `agent-pixel` has a dash. We keep the
   DB IDs and map with `nexconnUserId()`. Alternative: rename the agents to `agentpixel` etc.
2. **Streaming send** uses `toChannelId` (singular) and an object `content`; `isEchoToSender` defaults to 1.
3. **Webhook signature header** is `AppKey`, not `App-Key`.
4. **Free plan**: one month, 2,000 MAU, app blocked after expiry; the 10K-MAU promo is not documented.
5. **Translation**: daily minimum of 1,000 billable characters on any day with usage.
6. **Group create**: `groupProfile.portraitUrl` ≤ 128 chars; `groupExtProfile` values ≤ 256 chars; rate
   limit 100/s. Joining is `POST /v4/group-channel/join` (≤ 100 users, no approval).
7. Free plan limits worth designing around: 300 members/group, 50 concurrent open channels, 15K message size.
