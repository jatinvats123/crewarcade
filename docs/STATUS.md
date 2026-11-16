# Status

Updated at the end of every phase. Branch per phase (`phase-<n>`); the owner merges.

## Phase checklist

| Phase | Theme                       | Status                                                               |
| ----- | --------------------------- | -------------------------------------------------------------------- |
| 0     | Foundation                  | **Done** (branch `phase-0`)                                          |
| 1     | Identity, crews, chat       | **Built** (branch `phase-1`); live Nexconn check pending keys        |
| 2     | Pixel, cards, approval      | **Built** (branch `phase-2`); live Nexconn + Claude run pending keys |
| 3     | Forge, builds, play, scores | **Built** (branch `phase-3`); live E2E_CHAT run pending              |
| 4     | Glitch, playtest, publish   | —                                                                    |
| 5     | Bugs, voice, languages      | —                                                                    |
| 6     | Arcade and growth           | —                                                                    |
| 7     | Polish and launch           | —                                                                    |

## Phase 2: built, waiting for Nexconn and Anthropic keys to verify live (branch `phase-2`)

The agents are real chat members and Pixel works end to end. Everything below runs and is tested
locally against a fake Nexconn and the fake agents. **Not run yet:** anything against a real Nexconn
app or real Claude (no `NEXCONN_*` or `ANTHROPIC_API_KEY` on this machine), so the phone checklist,
the two-user Pixel e2e and the real cost numbers are still open (see "Needed from the owner").

### Done

- **Message router** (`apps/server/src/agents/router.ts`): on `message:send` in crew and game rooms,
  drops agent senders (no loops), finds agents by structured mention, `@pixel` / `@forge` / `@glitch`
  (any case, not inside emails or words), Hindi names (`@पिक्सेल`, "पिक्सेल, …", "pixel bhai …"),
  commands (`remix <game> into …` incl. Hinglish/Hindi forms, `explain …` / "kaise kaam karta",
  `bug: …` / `बग: …`, `make it …` / "isko …", `pitch: …`) and plain pitches in solo crews. 45-row
  table test in English, Hindi and Hinglish.
- **Jobs**: pg-boss 12 queue `agent` (+ `forge-build`, waiting for Phase 3). Job ids are UUIDs derived
  from the messageId (or `card:<id>:change:<n>`), so retries never run twice; 4 jobs per process
  (`AGENT_CONCURRENCY`), 1 per room (pg-boss `groupConcurrency: 1`, group = channel). Tested on PGlite
  through pg-boss's own adapter; an in-memory queue with the same rules serves the other tests.
  `JOBS_DATABASE_URL` takes a session/direct URL when `DATABASE_URL` is Supabase's transaction pooler.
- **Claude wrapper** (`apps/server/src/ai/claude.ts`): `structured()` (zod schema → JSON schema for
  `output_config.format`, optionally streaming one field live) and `streamText()`; `claude-opus-5-5`,
  explicit effort per call (plan/revise medium, explain low; Forge high and Glitch medium are set when
  they land), cached system prompt, `fallbacks: "default"` with beta `server-side-fallback-2026-07-01`,
  timeouts, typed errors (`AiRefusalError`, `AiOutputError`, `AiTimeoutError`, `AiUnavailableError`),
  `stop_reason` checked before content, no prefill, usage → tokens in/out, cache, cost (price table),
  ms, fallback flag. Tested against a local fake Messages API (exact request body and headers).
- **Pixel**: one streamed structured call per plan; the `intro` field streams into the chat while the
  rest of the JSON generates, then the `CA:PlanCard`. Input: pitch, last 30 room messages
  (`messages_log`, agent replies included), crew memory, pitch language (Devanagari, other Indian
  scripts, Hinglish heuristics). Output normalized to the engine `GameSpec` (4–8 checks renumbered,
  lengths clamped), unique slug (`chai-dash-2`…). Revisions (button or chat) post plan v+1 and
  supersede the old card; remix finds the source (slug, then approved title, then published) and sets
  `remixOfGameId`; explain streams ≤ 8 lines from the plan. Forge/Glitch and small talk get canned
  replies (no AI). Refusal → "I can't make that one. Try another idea?"; other failures → a friendly
  line; daily budget guard (`DAILY_BUDGET_USD`).
- **Prompt safety**: chat text only inside `<untrusted>` blocks in the user turn; every system prompt
  says not to follow instructions in it, not to reveal prompts or keys, change role, skip votes or
  approvals, or make non-game content, and to turn known games into original twists.
- **FAKE_AGENTS=1** (`apps/server/src/ai/fake.ts`): same interface, deterministic plans from the pitch
  (same hero word → same title), language-aware intros, realistic delays (1.8 s thinking, typed
  intro), explain answers, Forge/Glitch fixture outputs for later phases. Allowed in production config.
- **Streaming bridge** (`apps/server/src/nexconn/stream.ts`): chunk 1 with `type: markdown` + user,
  seq +1, ~300 ms batches, ≤ 1 KB chunks, < 128 KB total, closing `complete: true`; any failure → one
  `RC:TxtMsg` with the full reply. The web app follows streams with `requestStreamMessage()` +
  delta/complete handlers and renders a safe Markdown subset with a soft caret.
- **Cards**: one registered type each (`CA:PlanCard`, `CA:HandoffCard`, `CA:BuildCard`, `CA:TestCard`,
  `CA:PublishCard`, `CA:BugCard`, `CA:ScoreCard`, `CA:RoomLink`) with `v` + zod content and metadata
  schemas; `CA:AgentState` status message. `postCard` (hasMetadata, `cards` row) / `updateCard`
  (metadata/set with retries; values always recomputed from `cards.state`, which is updated under a row
  lock). Renderers for all eight on `CardShell` with the AI badge; the plan card has optimistic votes
  (latest request wins), Approve (approvers only), a Change sheet and a Full plan expander.
- **Votes and approval**: `POST /api/cards/:messageId/vote|approve|change`; members only (404
  otherwise), Approve owner/approver only (403), one approval (409 after), votes close on approval.
  Approval creates the game room "🎮 <title>" with every crew member + agents (create, then join beyond
  30), `CA:RoomLink` in the crew chat, the approved plan copy + `CA:HandoffCard` (Pixel → Forge, "Forge
  will start soon") in the room, `game_versions` v1, a queued build job, and one crew-memory note
  (≤ 10). New crew members are added to existing game rooms.
- **Agent Status Strip**: three chips per room from `CA:AgentState` (thinking, designing,
  waiting_approval… with timers and progress), 5 s server heartbeat while busy, client expiry after 15 s
  without a beat, `GET /api/rooms/:channelId/agents` snapshot on open; tap → a sheet with the agent's
  last 5 ledger actions.
- **Decision Ledger**: `record()` on every agent step and human decision (tokens, cost, ms, input,
  output, reason); `GET /api/games/:id/ledger` (long strings redacted, totals); Story tab in the desktop
  context panel and a 📜 sheet on phones, with Details and Export JSON. `usage` gets each call's cost.
- **Game rooms in the web app**: `/crews/<id>/rooms/<channelId>`, room chips under the header,
  `GET /api/rooms/:channelId`, crew detail includes `games`.
- Docs: SPEC (§4.3 flow, card-type decision, agent states, ledger actions), NEXCONN (stream page
  re-checked 2026-11-14, Web stream flow, metadata keys, discrepancies 14–15), DESIGN, CLAUDE.

### Verified locally (2026-11-14)

- `pnpm lint` ✓ (ESLint, Prettier, client secret check), `pnpm typecheck` ✓, `pnpm build` ✓.
- `pnpm test`: **272 tests** (shared 24, engine 38, web 48, server 159, root 3). The server suite runs
  the whole Pixel flow on PGlite + fake Nexconn: webhook → router → job → states → stream → card →
  votes (incl. concurrent) → permissions → approval → room, link, copy, handoff, build → ledger order;
  plus explain, change (button and chat), remix, refusal, stream failure, idempotency, agent loops.
- `pnpm e2e`: **26 passed, 4 skipped** (the two-user chat and two-user Pixel specs, phone + desktop,
  skip without Nexconn). New: card UI, streamed Markdown and status strip on `/dev/ui`.
- `pnpm eval:fast`: **21/21 planted bugs caught, 0 false FAILs** (4.0 min; engine untouched).
- Checked in a browser at 375 px: plan card header, votes, Approve, handoff (fixed a squeezed title).

### First live run on the owner's Nexconn dev app (2026-11-14)

Local stack (Postgres 17 in Docker, server with `FAKE_AGENTS=1` and pg-boss, `next start`), the owner's
dev App Key. Webhooks cannot reach a laptop without a tunnel, so the `message:send` webhook for each
real chat message was delivered to the local server by a signed script; everything else was real.

- **Works live:** token issue, crew creation (group + agents), Pixel's welcome, Web SDK connect and
  history, sending messages, `CA:AgentState` status messages (strip and panel update live), Plan cards
  with metadata, votes (`metadata/set` → live update), Approve → game room group created, room link,
  approved plan copy + handoff, Forge state, Story/ledger.
- **Fixed during the run:** an empty `COOKIE_SECURE=` from `.env.example` stopped the server;
  `groupExtProfile` made group creation fail with 25415 (NEXCONN.md discrepancy 16); the card action
  row cut off Approve in the chat column.
- **Streamed replies, found and fixed:** Nexconn kept only the **first chunk** of a multi-chunk stream
  (a two-chunk test showed only "part one,"), and Web clients got no live deltas. The server now sends
  each agent reply as **one complete `RC:StreamMsg` chunk** (`mode: 'single'`, default; `'chunked'`
  kept behind the option), and the client fetches a room's newest messages when an agent message
  arrives. Verified: Pixel's intro appears live and complete, just before the plan card.
- Pixel answers on its own once the console webhook points at the server (quick tunnel for now).

### Cost per plan (not measured yet)

`pnpm --filter @crewarcade/server measure:pixel` runs 5 pitches (English, Hindi, Hinglish and a
"make Flappy Bird" one) through the production prompt and prints tokens, cost, time and time to the
first intro words, plus averages. It needs `ANTHROPIC_API_KEY` and was **not run** (no key here).
**Estimate only** (prices: $4 / $20 per million tokens): ~1.5 K input tokens (system ≈ 1 K + output
schema + request) ≈ $0.006, plus ~1.5–5 K output tokens including medium-effort thinking ≈
$0.03–0.10, so roughly **$0.04–0.11 and 20–60 s per plan**. The system prompt is probably under
Opus's minimum cacheable size, so expect `cache_read` ≈ 0 for Pixel until the prompt grows.

### Run the Pixel e2e (two users, FAKE_AGENTS)

1. Server with a **dev** Nexconn app (as in Phase 1) **and `FAKE_AGENTS=1`**. The Nexconn webhook must
   reach this server (`message:send`; use a tunnel for local runs) with "Include Server API Messaging
   in post-event webhooks" on.
2. `E2E_CHAT=1 E2E_API_ORIGIN=http://127.0.0.1:8080 pnpm e2e --project desktop`.

### Phone checklist (Phase 2)

1. Phone A (owner), in a crew with Phone B: send `@pixel a chai cup on a scooter dodging potholes`
   (pick Pixel from the @ list). The strip shows **Pixel · Thinking**, then **Designing**; Pixel's
   intro types itself out on both phones; the Plan card appears.
2. Both phones tap 👍: the count reaches 2 on both screens within a second or two. Phone B has no
   Approve button.
3. Phone B taps **Change**, types "make it faster": the card says "Change requested", then plan v2
   arrives and v1 says "Replaced by a newer plan".
4. Phone A taps **Approve** on v2: "Approved by …" on both; a "🎮 …" room link appears in the crew chat;
   the room shows the approved plan and "Forge will start soon"; 📜 shows the Story with tokens and
   cost for Pixel's steps; Export JSON downloads it.
5. In the room: `@pixel explain how does the jump work?` gives a short streamed answer.
6. In a solo crew, type a pitch without @: Pixel answers. Try "make flappy bird": the title is original.

### Known issues / open questions (Phase 2)

- **Real Claude has not run yet** (no key); structured outputs accepting our generated schema
  (`outputJsonSchema`) is unverified. Live Nexconn: see "First live run" above (streams are open).
- The intro streams only after Opus finishes thinking, so with real Claude the "thinking" chip may
  show for 10–30 s before words appear. If that feels slow, try Pixel at `low` effort after measuring
  plan quality.
- Forge's build job is queued but no worker runs it yet (Phase 3): the handoff card stays "Forge will
  start soon" and the Forge chip shows "Waiting for approval · build v1 starts soon".
- Live agent states and heartbeats live in process memory (one Render instance); a restart drops them
  (clients expire them after 15 s).
- No quorum before Approve (per the Phase 2 brief an approver decides); votes are advisory.
- The pre-messaging shield is still allow-all (agents rely on the prompt rules and typed outputs).
- The crew list's activity dot and unread badge follow the crew chat only, not game rooms.
- The server bundle now imports `@crewarcade/engine` (spec schemas), which loads Playwright's module
  at startup (no browser is launched).

### Needed from the owner

1. A dev Nexconn App Key/Secret (and a webhook URL Nexconn can reach) to run the two e2e specs and the
   phone checklist.
2. An `ANTHROPIC_API_KEY` in `apps/server/.env` (never committed), then
   `pnpm --filter @crewarcade/server measure:pixel` for the real cost and time per plan (≈ $0.50 total).
3. On Render: `JOBS_DATABASE_URL` = the Supabase **session** pooler URL (port 5432) for pg-boss, and
   optionally `FAKE_AGENTS=1` as a demo fallback.

## Phase 3: built, live E2E_CHAT run pending (branch `phase-3`)

Forge builds games from approved plans, players play them in a sandboxed full-screen player, scores
reach leaderboards, and games get a public page with a link-preview image. Owner decisions
(2026-11-14): Build-card progress AND real multi-chunk streaming; `AI_PROVIDER` switchable with a
stronger Forge model; production refuses to start without Supabase Storage; run the `E2E_CHAT=1` e2e
live and give a 5-step phone check before merging.

### Done

- **Streams fixed** (`pnpm --filter @crewarcade/server stream:repro`): `messageId` is right (the legacy
  `messageUID` makes every chunk a new message); stored history keeps only chunk 1 and Web clients are
  not pushed server streams. Now: chunked sends with a debug log per chunk, `CA:AgentState.streamId`
  after chunk 1, the client fetches that message and calls `requestStreamMessage()` (also for history
  streams) and applies `RC_Ext_StreamMsgSummary`. Not yet watched live in the app.
- **AI config:** Forge uses `GEMINI_BUILD_MODEL` (`gemini-3.5-flash`) / `ANTHROPIC_BUILD_MODEL`; Pixel the
  cheap model; every build metric carries the model. Gemini retries 503/429 before any text streamed.
- **Storage:** Supabase (private `games` bucket) in production (config fails without it), local disk in
  development, memory in tests.
- **Forge:** build worker; code inserted into the starter / previous version / remixed game; static
  check + Game-object rules + 6 s smoke playtest (`FORGE_SMOKE=1`); ≤ 2 retries with numbered problems;
  live Build-card steps + agent progress; HTML in storage; `game_versions` with size, time, tokens,
  cost, model; handoff to Glitch + queued playtest (FAKE: simulated PASS); failed card + Try again;
  change requests → v+1; remix v1 from the original's published code.
- **Serving:** `/play/:slug/v/:n` with the strict CSP, nosniff, no-referrer, immutable cache; drafts need
  a 30-minute signed token (members only).
- **Scores:** plausibility (cap, min time, 1 per 3 s), leaderboard, ScoreCard, Glitch challenge DM
  (1 per pair per hour). Migration `0001_phase3_builds_scores`.
- **Web:** sandboxed full-screen player, Build/Score cards, leaderboard tab + sheet, ▶ Play in rooms,
  `?play=latest` deep link, Glitch DM view, public `/g/[slug]` + Open Graph image.
- **Engine fix:** the starter read `localStorage` unguarded, which throws in the player's sandbox (no
  game would have started). Guarded, with a test.

### Verified locally (2026-11-16)

- lint ✓, typecheck ✓, builds ✓; `pnpm test` 333 passing; `pnpm e2e` 32 passed, 6 skipped (E2E_CHAT
  specs); `pnpm eval:fast` 21/21, 0 false FAILs.
- Link previews: correct og/twitter tags, 1200×630 PNG ~100–110 KB. Indic titles are not drawn on the
  card (satori cannot shape them); the phone shows the real title as preview text.

### Build metrics (3 real builds, `pnpm --filter @crewarcade/server real:builds`)

Plans `gemini-3.5-flash-lite`; builds `gemini-3.5-flash` (API reports `gemini-3.6-flash`). Free tier.

| Game | Attempts | Build time | Tokens in / out | Smoke | Full playtest |
| --- | --- | --- | --- | --- | --- |
| Chai Scooter Dash | 1 | 57 s | 3.5 K / 6.6 K | PASS | PASS |
| Ice Delivery | 2 | 85 s | 10.7 K / 18.9 K | PASS | Space key does nothing |
| दिवाली पटाखा बिल्ली (Hindi) | 2 | 61 s | 9.7 K / 15.0 K | PASS | PASS |

Average 68 s, retry rate 67 %, $0 per build. Both retries: redeclared engine globals (prompt now lists
them; not re-measured).

### Phone check (5 steps)

1. Pitch `@pixel a chai cup on a scooter dodging potholes`: the intro types out live, then the plan.
   Approve, open the 🎮 room.
2. Forge's Build card ticks its lines and turns Ready in ~1–1.5 min.
3. ▶ Play: full screen, touch buttons work, a run ends with a "New best" toast. Repeat on desktop with
   arrow keys.
4. 🏆 shows your score and a Glitch ScoreCard; when a friend beats you, Glitch DMs you a Play again link.
5. ✏️ Change → "make it faster": v2 appears, v1 still plays. Paste `/g/<slug>` into WhatsApp: the
   preview card appears.

### Known issues

- Live E2E_CHAT run not done (Docker Desktop / local Postgres did not start). `e2e/forge.spec.ts` ready.
- Nothing can be published until Phase 4; public play and remix were tested with a published flag set
  in the database.
- The Phase 4 playtester should load games in a sandboxed iframe like the player.
- Per-user daily build limit not enforced yet; Live Build Theater not built.

### Needed from the owner

1. Start Docker Desktop (or give a Postgres URL) for the live `E2E_CHAT=1` run.
2. Render: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AI_PROVIDER=gemini`, `GEMINI_API_KEY`.
   Vercel: `NEXT_PUBLIC_SITE_URL` = the https URL.

## Next: Phase 4

Glitch: sandboxed playtest worker for the queued `glitch-playtest` jobs, PASS/FAIL cards with GIFs,
auto-fix loop, publish request + Allow/Block, screenshots for the OG image.

## Phase 1: built, waiting for Nexconn keys to verify live (branch `phase-1`)

Everything below is implemented and tested locally. What has **not** run yet is anything that needs a
real Nexconn app: the two-user chat e2e, the deploy, and the phone checklist. Those need the owner's
dev App Key and App Secret (see "Needed from the owner").

### Done

- **Guest identity:** `/start` (name 2–24, 24 emojis, 6 ring colours, optional language, one tap
  "Let's go"); `POST /api/auth/guest`, `GET /api/me`, `PATCH /api/me`, `POST /api/auth/logout`. Session
  cookie `ca_session` = HS256 JWT (90 days, `HttpOnly`, `SameSite=Lax`, `Secure` in production).
  Sign-ups rate-limited per IP. `is_judge` kept in the schema.
- **First-party API proxy:** `next.config.ts` rewrites `/api/*` to `NEXT_PUBLIC_API_ORIGIN`, so the
  cookie is first-party on the Vercel domain (decision recorded in `docs/SPEC.md` §4.1).
- **Nexconn server client** (`apps/server/src/nexconn/`): signed headers, Singapore primary → backup
  failover (timeout 5 s, 5xx, non-Nexconn responses), retries with full jitter (network, timeout, 5xx,
  HTTP 429, code 1008), token buckets per endpoint family (group send + group metadata share 20/s),
  zod-validated inputs and responses, typed errors (`NexconnApiError` with the business code).
  `issueToken`, `createGroup`, `joinGroup`, `sendGroupMessage`, `sendDirectMessage`,
  `setMessageMetadata`; stubs with doc links for `streamGroupMessage` and the open-channel calls.
  Keep-alive capped at 50 s idle / 80 requests per connection, as the base-URL guide asks.
- **`POST /api/nexconn/token`:** issues once, caches AES-256-GCM-encrypted, `{ refresh: true }`
  re-issues (used on SDK code 31004). Tokens are never logged.
- **Webhooks** (`apps/server/src/webhooks/`): one URL `/webhooks/nexconn` (the console takes one);
  constant-time signature check + timestamp freshness; `*:pre_messaging` answered synchronously with
  `{ pass: 1 }` and timing logs (warn above 150 ms; p95 in tests ≪ 150 ms); other events deduped by
  event id in `webhook_events`, 200 at once, processed after the reply: `message:send` →
  `messages_log` (text only for text messages; status messages skipped; agent ids mapped back),
  `user:connection_status` → `connections` (+ `users.last_seen_at`), everything else logged at debug.
  `/webhooks/nexconn/pre` is an alias.
- **Crews:** `POST/GET /api/crews`, `GET /api/crews/:id`, `PATCH /api/crews/:id/members/:userId`,
  `GET /api/invites/:code`, `POST /api/invites/:code/join`. Nexconn group first (owner + Pixel, Forge,
  Glitch, `joinPerm 0`), DB second, then Pixel's welcome text; joins post a `CA:Notice`. Agents are
  seeded at server start (idempotent) and get tokens on first use. Owner-only role changes; agents and
  the owner never change role; non-members get 404.
- **Shared** (`packages/shared`): API schemas (`api.ts`), content parsers (`content.ts`), the full
  `CA:*` registry (Card, Handoff, AgentState, Notice, Reaction, **Typing**), `dbUserIdFromNexconn`.
- **Web chat** on `@nexconn/chat@26.2.1` (no Chat UI kit): one `NexconnProvider` (init once, register
  types, handlers, connect, token refresh, reconnect banner, offline sync), crews list (preview, unread
  badge, agent activity dot, solo crew), chat (day + sender grouping, sending/sent/failed + retry,
  text with links and @mention highlight, image with tap-to-zoom, voice with waveform bar, notices,
  card fallback), composer (IME-safe Enter on desktop, send button on phones, @mention autocomplete
  sent as real mentions, camera/gallery photos compressed to ≤ 1600 px, hold-to-record or tap-to-lock
  voice notes, throttled `CA:Typing`), typing line, ✓ / ✓✓ "Seen by N" sheet, presence dots,
  scroll-to-latest pill, crew info sheet (members, roles, invite + share), settings (profile, language,
  theme, sign out), invite screen `/i/<code>` with inline sign-up, 3-column desktop layout.
- **Timeline rendering:** a `column-reverse` scroller keeps the view anchored to the newest message
  and lets older pages load above without a jump; each sender group has `content-visibility: auto`
  (the browser skips layout and paint off screen) and history is paged 30 at a time. This is
  render virtualization, not DOM windowing (see known issues).
- **Accessibility:** labels on all icon buttons, 44 px targets (e2e-checked on `/start`), focus
  states, rem-based text so large system fonts scale, `faint` token raised to ≥ 4.5:1 in both themes.

### Verified locally (2026-11-14)

- `pnpm lint` (ESLint, Prettier, client secret check) ✓, `pnpm typecheck` ✓, `pnpm build` ✓ (web +
  server bundle; secret check of the built bundle ✓).
- `pnpm test`: **166 tests** (shared 21, engine 38, web 37, server 67, root 3). Server tests run the
  real migrations on PGlite with a fake Nexconn that records every Platform API call.
- `pnpm e2e`: **16 passed, 2 skipped** (the two-user chat test, phone + desktop, skips with
  "needs the CrewArcade server running with a Nexconn dev app…").
- `pnpm eval:fast`: **21/21 planted bugs caught, 0 false FAILs** on 3 clean games (3.8 min; engine untouched).
- Local stack (Postgres 17 in Docker + server bundle + `next start`): sign-in through the proxy,
  cookie, crews list, "chat isn't set up" banner, crew-create error path, invite screen, crew info
  sheet and the desktop 3-column layout checked in a browser at 375 px and 1366 px.
- **Lighthouse mobile** (local `next start`, Lighthouse 12.8.2): chat page **performance 92–93,
  accessibility 100**, best practices 96; `/start` 95 / 100; landing 91 / 100. Caveat: without Nexconn
  keys the SDK chunk is never downloaded on the chat page, so re-run once keys exist.

### Run the two-user chat e2e

1. Start Postgres and the server with a **dev** Nexconn app's keys (`apps/server/.env`: `DATABASE_URL`,
   `NEXCONN_APP_KEY`, `NEXCONN_APP_SECRET`, `TOKEN_ENCRYPTION_KEY`), then `pnpm db:migrate` and
   `pnpm --filter @crewarcade/server dev`.
2. `E2E_CHAT=1 E2E_API_ORIGIN=http://127.0.0.1:8080 pnpm e2e --project desktop`
   (webhooks are not needed for this test; the chat itself is pure Nexconn).

### Deploy (owner clicks, in this order)

1. **Supabase:** copy the transaction-pooler connection string (port 6543) → `DATABASE_URL`.
2. **Render:** New → Blueprint → this repo, branch `phase-1` (or `main` after merging) → it reads
   `render.yaml`. Set the secret env vars: `WEB_ORIGIN` (the Vercel URL, e.g.
   `https://crewarcade.vercel.app`), `PUBLIC_API_ORIGIN` (the Render URL), `DATABASE_URL`,
   `NEXCONN_APP_KEY`, `NEXCONN_APP_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `ANTHROPIC_API_KEY`, `TOKEN_ENCRYPTION_KEY` (`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`).
   `SESSION_SECRET` is generated by Render. Deploy; pre-deploy runs the migrations; open
   `https://<render>/health` → `{"ok":true,"db":"up","nexconn":"configured"}`.
3. **Vercel:** New Project → this repo, root directory `apps/web` (uses `vercel.json`). Env:
   `NEXT_PUBLIC_API_ORIGIN` = the Render URL, `NEXT_PUBLIC_SITE_URL` = the Vercel URL. Deploy. Changing
   `NEXT_PUBLIC_API_ORIGIN` needs a redeploy (the rewrite is built in).
4. If the Vercel URL differs from what you put in `WEB_ORIGIN`, fix `WEB_ORIGIN` on Render (it gates
   mutating requests and builds agent avatar URLs) and redeploy the server.
5. **Nexconn console:** follow `docs/NEXCONN.md` → "Console setup" (webhook URL
   `https://<render>/webhooks/nexconn`, events `message:send`, `user:connection_status`,
   `group_channel:pre_messaging`; server-API messages in webhooks; online-status subscription).
6. Sign in on the Vercel URL, start a solo crew, send a message: Pixel's welcome must appear and the
   Render log must show `webhook: processed` for `message:send` and `user:connection_status`. That
   first real message also locks in the Free Chat Plan promo if it applies.

### Phone checklist (two phones)

1. Phone A: open the Vercel URL → **Start a crew** → type a name → **Let's go**. Time it: it should take
   under 10 seconds to reach "Crews".
2. Phone A: **Name a crew and invite friends** → create it. Pixel's welcome appears; tap ⓘ and check
   the members list shows you (Owner) plus Pixel, Forge and Glitch.
3. Phone A: tap 📤 → share to WhatsApp → send to Phone B. Phone B: open the link → crew name and
   avatars show → type a name → **Join crew** → the chat opens; Phone A sees "<name> joined the crew".
4. Type on Phone B without sending: Phone A shows "<name> is typing…". Send it; then on Phone A send a
   message with `@pixel` (pick it from the list) and check it is highlighted on both phones.
5. With the chat open on Phone B, Phone A's last message turns to **✓✓ Seen by 1**; tap it to see the
   name. The header on Phone A shows "2 online" (put Phone B to sleep: within a few minutes it drops).
6. Phone B: tap ＋ → Take a photo (opens in full screen when tapped), then hold 🎙️, speak, release
   (or tap once to lock and press ➤): both arrive on Phone A and the voice note plays. Turn on flight
   mode on Phone A for 10 s: the banner says offline, then "Back online", and any missed messages appear.

### Known issues / open questions (Phase 1)

- **Nothing has talked to a real Nexconn app yet.** Request shapes follow the live docs and the SDK
  typings; the chat e2e, deploy and phone checklist are the real proof.
- Group typing uses the `CA:Typing` status message because the Web SDK (26.2.1) has typing only on
  `DirectChannel`; each keystroke burst sends at most one message per 4 s (client limit 5/s).
- "Seen by" depends on group read receipts being available for the app (console). If the console has
  no such switch and receipts don't arrive, the ✓ stays single; nothing else breaks.
- `joinPerm 0` (not 3) for crews: see `docs/NEXCONN.md` discrepancy 13.
- The timeline uses render virtualization (`content-visibility`) plus 30-message pages, not DOM
  windowing. Fine for crews of this size; switch to a windowed list if long sessions get slow.
- Webhook processing runs in-process after the 200 (a crash between the dedupe insert and the write
  would drop that event); Phase 3 moves it to pg-boss.
- Rate limits for sign-up/crew creation are in-memory (one Render instance).
- Production config still requires `SUPABASE_*` and `ANTHROPIC_API_KEY` even though Phase 1 does not
  use them (unchanged from Phase 0; set them now to avoid a second round).
- Local dev runs on Node 24 here; the Docker image enforces Node 22 LTS.
- Fixed during this phase: the server bundle imported `nanoid` (via `@crewarcade/shared`) without
  declaring it; a test now checks that every dependency of bundled workspace packages is declared.

## Phase 0: done

- Monorepo (pnpm workspaces, TypeScript strict, Node 22): `apps/web`, `apps/server`, `packages/engine`, `packages/shared`.
- **Engine imported** (first commit `Import game engine and playtest tools`): starter with the
  `window.__crew` hook and the `crewarcade:start` / `crewarcade:score` postMessage hook, static
  checker, headless playtester and GIF clipper as library functions (HTML string in, structured
  results out, deterministic seed 42 + paused fake clock), versioning helpers, CLIs, fixtures (test
  only), planted-bug eval. New since the import: FPS is measured at 4× CPU throttle (phone-class),
  which is what lets the eval catch light frame-time bugs.
- **Eval: 21/21 planted bugs caught, 0 false FAILs on 3 clean fixtures** (`pnpm eval`, 5.2 min;
  `pnpm eval:fast` also 21/21). Details: `packages/engine/eval/RESULTS.md`.
- Verified locally (2026-11-13): lint, typecheck, 71 tests (incl. browser playtests and migrations +
  seed on Postgres via PGlite), build, web e2e 8/8 (phone + desktop), `pnpm dev` (web 200, server
  `/health` 503 without a DB, as designed), library playtest + GIF of a fixture.
- Nexconn `nexconn-chat` skill installed; Nexconn facts verified against the live docs (`docs/NEXCONN.md`).
- Docs: `CLAUDE.md`, `docs/SPEC.md`, `docs/NEXCONN.md`, `docs/ENGINE.md`, `docs/DESIGN.md`, this file.
- Data model: Drizzle schema (15 tables incl. `webhook_events` for webhook dedupe), migration
  `apps/server/drizzle/0000_init.sql`, idempotent agent seed (`agent-pixel`, `agent-forge`, `agent-glitch`).
- Server skeleton: zod config (fails fast; service keys required in production), Fastify `/health`
  (DB ping, 503 when down), pino logging with header redaction, esbuild bundle, Dockerfile on
  `mcr.microsoft.com/playwright:v1.64.1-noble` with Node 22 LTS, `render.yaml` (Singapore, standard plan 2 GB, pre-deploy migrations).
- Web skeleton: landing placeholder, `/dev/ui` component gallery, design tokens (dark-first + light),
  Space Grotesk + Inter, logo/wordmark/favicon, agent avatars, base components, public env schema, `vercel.json`.
- Tooling: ESLint (flat), Prettier, Vitest per package, Playwright e2e (phone + desktop), client secret
  check (source + built bundle), GitHub Actions CI (lint → typecheck → tests → eval fast → build; e2e;
  Docker build).

## Phase 0 notes

- **Docker image verified locally (2026-11-13):** builds; runs as `pwuser` on Node 22.23.5;
  `node dist/migrate.js` + `node dist/seed.js` (twice, idempotent) against Postgres 17 create the 15
  tables and 3 agents; the server refuses to start in production without its keys and lists them all;
  `/health` returns 200 with the DB up, 503 when Postgres is stopped, 200 again when it returns; Docker
  `HEALTHCHECK` reports healthy; headless Chromium 156 launches inside the image.
- The Playwright base image ships **Node 26** (no corepack). The Dockerfile copies the official
  `node:22.23.5-bookworm-slim` runtime into it so the server runs Node 22 LTS (a test enforces it).
- The image is **3.9 GB** (the Playwright image includes Firefox and WebKit). Fine for Render, but
  deploys are slower; trimming it (Chromium only) is a Phase 7 candidate.
- Migrate/seed use a DB-only config (`loadDbScriptConfig`), so Render's pre-deploy step does not need
  the AI and chat keys.
- **CI green on the first run** (private repo `jatinvats123/crewarcade`, branch `phase-0`, 2026-11-13):
  checks + eval + build 8 min (eval 21/21, 0 false FAILs on Linux), web e2e 8/8, Docker image build 4 min.
- Migration not applied to Supabase yet: needs the Supabase connection string (see the Phase 0 report).
- Decided: agent DB IDs stay `agent-pixel` / `agent-forge` / `agent-glitch`; Nexconn sees
  `agentpixel` / `agentforge` / `agentglitch` via `nexconnUserId()`. Phase 1 must also map webhook
  user IDs back (Nexconn ID → DB ID) for agents.
- Free Chat Plan promo (10K MAU) is not in the Nexconn pricing docs; the documented Free plan lasts one
  month (2,000 MAU) and then blocks the app. Confirm in the console.
- Translation bills at least 1,000 characters per day with any usage (10K free) → on-demand only.
- `pg-boss`, Supabase Storage, Anthropic and Sarvam clients are not wired yet (Phases 1–5).
- Windows Smart App Control on the dev machine blocks native `@next/swc` (Turbopack) and Rollup
  binaries, so the web app runs `next dev/build --webpack` (WASM SWC locally) and the server builds
  with esbuild. Same commands everywhere; local web builds are slower (~1 min).
- Next 16 writes `apps/web/AGENTS.md` on `next dev`; it is committed to keep the tree clean.
