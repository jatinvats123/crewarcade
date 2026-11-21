# Status

Updated at the end of every phase. Branch per phase (`phase-<n>`); the owner merges.

## Phase checklist

| Phase | Theme                       | Status                                                               |
| ----- | --------------------------- | -------------------------------------------------------------------- |
| 0     | Foundation                  | **Done** (branch `phase-0`)                                          |
| 1     | Identity, crews, chat       | **Built** (branch `phase-1`); live Nexconn check pending keys        |
| 2     | Pixel, cards, approval      | **Built** (branch `phase-2`); live Nexconn + Claude run pending keys |
| 3     | Forge, builds, play, scores | **Built** (branch `phase-3`); live E2E_CHAT run pending              |
| 4     | Glitch, playtest, publish   | **Built** (branch `phase-4`); live E2E_CHAT run pending (Docker)     |
| 5     | Bugs, voice, languages      | **Built** (branch `phase-5`); live on the free plan (no playtests)   |
| 6     | Polish, harden, launch prep | **Built** (branch `phase-6`)                                         |
| 7     | Final push to submission    | **In progress** (branch `phase-7`)                                   |
| 7     | Polish and launch           | —                                                                    |

## Phase 7: final push to submission (branch `phase-7`, from `phase-6`)

- **P0.1 Render Standard:** `render.yaml` is now `plan: standard`, `preDeployCommand: node dist/migrate.js`,
  `PLAYTESTS`/`FORGE_SMOKE` `true`, no `MIGRATE_ON_START`. The service was created by hand, so the owner
  switches the instance type, branch, pre-deploy command and env in the dashboard (steps in the Phase 7 report).
  Live loop to verify once it's switched.
- **Live on Render Standard (2026-11-20):** card added, compute 1 CPU / 2 GB, branch `main`,
  `PLAYTESTS`/`FORGE_SMOKE` `true`, pool 8, agent concurrency 3; `/health` → `1d14fdc`, `db: up`.
  Pre-deploy command was still locked right after the plan change, so `MIGRATE_ON_START=true` stays
  for now (works on any plan). Supabase: new DB password + new `sb_secret_` key in Render (storage
  sends it as `apikey` only). Vercel production branch = `main`; Vercel skips commits that don't touch
  `apps/web`, so a server-only push to `main` needs a manual production deploy. GitHub default = `main`.
- **Live loop verified (2026-11-20, owner on the live app):** pitch → Pixel plan (4:01 PM) → Approve
  → game room → Forge build → Glitch headless playtest PASS with clip (v2 after a fix) → Publish card
  (4:07 PM) → Allow → published, listed in `/arcade`. About 6 minutes end to end on Gemini's free tier.
  Story panel: 17 steps, 23,524 tokens. Also checked live by the owner: the shield (member's ship
  command and prompt injection removed, 🛡 notice, `/safety` lists them) and bug report → repro →
  hotfix → credited. **All P0 verified live.**
- **P0.2 AI busy, honestly:** Gemini's busy retries report to the running job (`ai/busy.ts`, AsyncLocalStorage),
  and the agent's live state reads "AI model busy, retrying (2/3)…" / "switching to …". An agent job whose
  model stays busy is re-queued twice (45 s) with a chat notice, and a busy build says so. No paid key yet.
- **P0.3 Safety shield:** rules in `safety/shield.ts` (prompt injection EN/Hindi/Hinglish, ship command
  from a non-approver, abuse, spam/floods). Pre-delivery answers `*:pre_messaging`; after-delivery
  (live now) deletes for everyone via `/v4/message/delete`, posts a 🛡 notice, skips the agents, and
  logs `moderation_log` + ledger `shield.blocked`. Public `/safety` page + `GET /api/public/safety`.
  Drafts for Nexconn: `docs/outreach/pre-messaging.md`.
- **P0.4 Awake and faster:** `.github/workflows/keepalive.yml` pings `/health` and the web home every
  10 min (GitHub runs schedules from the **default branch** only, so it starts once `main` is default).
  Hot path: a game room resolves in one parallel round trip (channel → crew/game mapping remembered),
  member counts cached 30 s (dropped on join), shield role lookups cached 60 s (`util/ttl-cache.ts`).
- **P0.6 No developer UI in production:** `/dev/*` is 404 in production builds (checked on `next start`)
  unless `NEXT_PUBLIC_DEV_PAGES=1` (only the e2e config sets it). The landing has no UI-kit link.
  Next.js 16.4.4 → 16.4.5 (patch for two moderate `use cache` advisories).
- **P0.5 Repo:** `phase-5`'s last docs commit merged into `phase-7`, so every phase branch is an ancestor;
  `main` = `phase-7`. History secret scan (regexes for DB URLs, JWTs, Google/Anthropic/GitHub keys,
  private keys, secret assignments, `.env` files): clean. Only hit: the dev-only session secret, which
  production refuses.
- **AI on Claude Haiku 5.5 (2026-11-21):** Gemini billing could not be set up (RuPay card refused,
  `OR_BACR2_59`), so production runs `AI_PROVIDER=anthropic` with `ANTHROPIC_MODEL` and
  `ANTHROPIC_BUILD_MODEL` = `claude-haiku-5-5` on $5 of prepaid credit (org spend limit $5). Measured
  live: about $0.02 per game. `ADMIN_USER_IDS` set, `/admin` works. Gemini prices are still not wired
  into the ledger (cost shows $0 on Gemini, so `DAILY_BUDGET_USD` would not stop Gemini spend).
- **Glitch false FAILs fixed (2026-11-21):** `/admin` showed test 2 OK / 13 failed. The game rooms showed
  `error in "state().score > marks.m.score": state is not a function`: scenarios written by the model
  call `state()` (the prompts phrase acceptance items as `state().field`), but `playSteps` passed `state`
  as a plain object. Expects now get `state`, `start` and each mark as a snapshot that is readable and
  callable (`packages/engine/src/player.ts`), with a browser test. Engine 48 ✓, server 288 ✓, typecheck,
  lint, `pnpm eval:fast` 21/21 caught, 0 false FAILs. Live on `main` (`a6374f7`); Roof Rider v4 and
  Pedal Pup then passed and were published.
- **Glitch "could not write the scenario" fixed (2026-11-21):** a live test card showed
  `scenario valid: could not write the scenario` on Haiku. The API drops numeric and length limits
  from the JSON schema it enforces (`outputJsonSchema`), so the model could return e.g. `wait: 95000`,
  and the zod limits in `RawStep` / `ReproOutput` then threw before the repair round. The model-facing
  schemas now hold types only; `convertSteps` checks step count (2–80) and the engine schema checks the
  rest with step numbers, and `writeScenario` / `writeRepro` send malformed output (bad JSON, schema
  mismatch, max_tokens) to the repair round. Token limits 4000 → 8000 (scenario) and 3000 → 6000
  (repro), since thinking counts toward them. 4 new tests; server 292 ✓, typecheck, lint. Live (`72893de`).
- **Phone layout pass (2026-11-21):** a real user reported "things not aligned in mobile view". No page
  scrolls sideways at 320/360/375/390 px (local scan, signed in), so the issues were cramped headers:
  game-room title cut to "STAR DO…" by five icons (title may now take two lines on phones; Invite moves
  to Crew info ⓘ in game rooms), "Make a game" and "Your crews" wrapping onto two lines (no-wrap,
  tighter padding; the theme toggle below 360 px and the Arcade text link below 400 px wait for room),
  long game titles breaking mid-word (smaller size for titles over 24 characters, hyphens), and agent
  names cut ("GLITCH · PLAYTES…") by the badge (shows "✦ AI" on phones, full label for screen
  readers). Web 68 ✓, typecheck, lint, e2e cards/smoke/player 24/24 (phone + desktop). The game-room
  header was checked in code only: local chat has no Nexconn, so rooms can't open locally. Live (`6bf1f3a`);
  the owner's phone confirmed the two-line game-room title.
- **Cards pushed off the phone screen (2026-11-21):** the owner's phone showed Glitch's test card cut at
  the right edge. In a chat row the bubble column is `items-start`, so a card sized to its content, and a
  test detail with long unbroken JSON (`state {"scene":"playing",…}`) made that content wider than the
  screen. Card messages now take the row's width and card bodies wrap with `overflow-wrap:anywhere`. The
  `/dev/ui` gallery now renders its cards inside the real chat row (after hydration, since the row
  prints a locale clock time) with long JSON details, and a new e2e checks every card stays inside the
  screen. e2e cards/smoke/player 26/26 twice (phone + desktop).

## Phase 6: polish, harden, launch prep (branch `phase-6`)

- **Arcade:** public `/arcade` (Newest / Top by plays then best score) from `GET /api/public/arcade`; published games only, fixture slugs never listed (tested).
- **New look (desktop-first):** black + acid-lime tokens app-wide (dark by default, light on request),
  Anton poster type for the logo and page titles, new flat logo mark. Landing rebuilt as a poster with a
  3D glass game controller (React Three Fiber, modelled in code) that refracts the headline and zooms on
  scroll; without WebGL2 the HTML headline stays. See DESIGN.md "Landing hero".
  Sign-up is now one calm screen (name, 8 players, language from the browser, Start playing); the
  invite screen `/i/<code>` uses the same form under a big crew-name headline (`QuickProfileForm`);
  Settings keeps the full `ProfileForm`. e2e smoke updated for the dark-only
  landing (theme toggle checked on /arcade).
- **Referrers + admin:** `?ref=` (first touch, localStorage) → `users.referrer` at sign-up (migration `0005_users_referrer`); invite links carry `?ref=invite`. Owner-only `/admin` (`ADMIN_USER_IDS`, 404 for others, tested): stage OK/failed + p50/p95 from the ledger, cost per day, queue depth, signups by referrer.
- **Security:** `docs/SECURITY.md`. Hostile-game test (21 attacks, all blocked; sandbox loosened = 13 leaks). Fixed: games could navigate their own frame (checker rule + player stop), client-secret check missed `GEMINI_API_KEY`/`SESSION_SECRET`/`JOBS_DATABASE_URL`. Prompt injection: 10/10 resisted on live `gemini-3.5-flash-lite`. Open: `X-Forwarded-For` trust on direct Render calls.
- **Privacy:** public `/privacy`; Settings → Delete my account (`DELETE /api/me`: crews pass on or go, rows credited to "Deleted player", Nexconn kickout-all + dismiss, screenshots removed; tested). Fixed: the 30-day message-log retention never ran; `purgeExpired()` now runs at startup and every 6 h (tested).

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

## Phase 5: built, deployed live on free hosting (branch `phase-5`)

Players report bugs, Glitch reproduces them on camera, Forge ships a hotfix that must pass every old
repro, and it goes public only through Allow. Plus voice pitches (Sarvam) and tap-to-translate.

### Done

- **Bug intake:** [Report a bug] in the player (crew pages; text + optional phone screenshot) and
  `bug: …` in a game room both call `reportBug` (`services/bugs.ts`). The screenshot is checked
  (magic bytes, ≤ 4 MB), goes to the private `uploads` bucket and is served to crew members only
  (`GET /api/bugs/:id/screenshot`). Glitch posts `CA:BugCard`, ledger `bug.reported`, repro queued.
- **Repro (`agents/bugs.ts`):** these jobs share the playtest queue (one browser job per room).
  The cheap model reads the report plus the screenshot (image input added to the Claude and Gemini
  clients) and writes steps plus one `BUG <n>:` expect, validated with a repair round. The repro runs
  alone (`only` mode). FAIL = reproduced: repro GIF on the BugCard, `bug.reproduced`, Forge's hotfix
  starts. PASS = not reproduced: Glitch asks one follow-up question (`bug.not_reproduced`). A check
  that throws counts as a broken repro, never the bug (one more draft).
- **Hotfix:** `startFix` gained a hotfix mode. Version meta keeps `bugId` through the fix rounds
  (max 2 automatic). The first note is `hotfix: <bug> (bug hunter: <name>)`. The playtest replays
  every saved repro as hard checks (`hotfixPasses`: they must all run and pass; old scenarios stay
  advisory). PASS → `clip({kind:'fix'})` side-by-side GIF → publish card with a `hotfix` block
  (same Allow gate). Allow → bug `fixed`, BugCard turns green, `bugHunters` credited on `/g/:slug`.
  Migration `0003_phase5_bugs` (bug number, card id, hotfix version, question).
- **Voice pitches:** an HQ voice note with an agent mention (type `@pixel `, then hold the mic) or
  any note in a solo crew → agent job → download (https, size cap; relayed URLs only from
  `NEXCONN_MEDIA_HOSTS`) → Sarvam `saaras:v3` `mode=codemix` (≤ 30 s) → routed exactly like text.
  No key or any failure → a friendly "type it instead" line (Hindi for Hindi users).
- **Translate (tap only):** [Translate] under others' messages → `POST /api/translate/quota` (atomic,
  `LIMITS.dailyTranslationChars` = 1,000 chars per user per day in `usage`) → Nexconn
  `translateMessages` + `TranslateHandler`. Over the cap: "back tomorrow".

### Verified locally (2026-11-17, rerun 2026-11-19 after the deploy fixes)

- 2026-11-19: typecheck ✓, ESLint ✓, client secret check ✓; tests package by package: shared 26,
  engine 39, server 240 (1 skipped: gated real builds), web 60, all passing; `pnpm eval:fast`
  21/21 caught, 0 false FAILs (8 min). Run in parallel, `pnpm test` once failed the engine's
  frame-rate check (28 fps < 30) while the server's Chromium tests shared the CPU: a load flake,
  so run the suites one at a time.

- lint ✓, typecheck ✓, `pnpm test` 355 passing (1 skipped: the gated real-builds test), `pnpm eval:fast`
  21/21 caught, 0 false FAILs, `pnpm e2e` 35 passed, 7 skipped (same skips as Phase 4; built first,
  then Playwright against `next start`: the first build stopped on Next's advisory check again).
- **Sarvam live** (owner's key, `saaras:v3` + `codemix`): a 8 s Hinglish pitch read by a Windows
  English TTS voice came back in 1.1 s as "Pixel, EK Billy Wala game, Baneo Jo Chai K Cups…"
  (`en-IN`); the router's leading "Pixel," makes it a pitch. A real Hindi speaker is still to try.
- New tests: `test/bugs-unit.test.ts` covers repro mapping, repro format, the hotfix rule,
  screenshots, the translation cap and the voice fallback, plus webhook voice → plan card. The
  integration test `test/bugs.test.ts` uses real Chromium (~100 s): the penguin-slide
  `collision-disabled` mutant as v1 → report with screenshot → reproduced → hotfix v2 passes the
  repro → member 403, owner Allow → fixed + credited. `e2e/bugs.spec.ts` (FAKE demo) covers
  BugCard → hotfix card → Allow.

### Phone check (4 steps)

1. In a game room, play v1 → 🐞 Report a bug → describe it (+ screenshot) → a BugCard appears;
   it turns "Reproduced" with a GIF, or Glitch asks one question.
2. A reproduced bug: Forge's hotfix build card, then a "🩹 Hotfix vN" card with the side-by-side GIF
   and "Bug hunter: <you>". Only the owner/approver sees Allow; after Allow `/g/<slug>` lists the hunter.
3. Type `@pixel `, hold the mic, say a Hinglish pitch → Pixel's plan card (needs `SARVAM_API_KEY`).
4. Tap Translate under a friend's message → the translation appears; enable Console → Translation first.

### Known issues

- Not run live: Nexconn translation (needs the Console switch + the app key). Sarvam is checked live with a synthetic clip only.
  The voice relay is off until `NEXCONN_MEDIA_HOSTS` lists Nexconn's file host, so the webhook is
  the only trigger.
- Voice notes in multi-human crews are transcribed only when they mention an agent (Sarvam bills per
  second). Spoken "Pixel, …" without a typed mention isn't routed there.
- In FAKE mode Glitch's repro is generic: a working game "doesn't reproduce" and Glitch asks a question.
- The translated source language isn't shown (the SDK result gives only the target).

### Live deploy (2026-11-18/19)

- Web: **https://crewarcade.vercel.app** (Vercel project `crewarcade`, root `apps/web`, production
  branch `phase-5`; env `NEXT_PUBLIC_API_ORIGIN`, `NEXT_PUBLIC_SITE_URL`).
- Server: **https://crewarcade-server.onrender.com** (Render **free** web service, created by hand, not
  by Blueprint; `/health` gives `db: up`). Agents on Gemini's free tier (`AI_PROVIDER=gemini`).
- Database and storage: Supabase (Tokyo, `ap-northeast-1`) through the transaction pooler (6543).
  The direct string is IPv6-only and Render can't reach it. About 70-440 ms per query from Singapore.
- Nexconn Console: webhook `https://crewarcade-server.onrender.com/webhooks/nexconn` with
  `message:send` and `user:connection_status`. "Include Server API Messaging" is on. Translation is off.

**Checked live (2026-11-19):** guest sign-in, a crew, `@pixel` pitch → plan card → Approve → game
room → handoff → Forge built Chai Paws v1 (▶ Play) → Glitch: "playtests are switched off".

**Why free:** the owner doesn't want a card on file, and Render asks for one for any paid instance
(even with the $50 hackathon credit). Free is 512 MB, 0.1 CPU, sleeps after 15 min idle (about 1 min
to wake), 750 h/month. Chromium needs about 2 GB, so `PLAYTESTS=false` and `FORGE_SMOKE=false`: builds
are playable, bug reports are saved but not replayed, and **nothing can be published**. Checked and
rejected: Hugging Face Docker Spaces need the paid PRO plan and block outbound Postgres ports.
Full product: `plan: standard`, both flags `true`, `preDeployCommand: node dist/migrate.js`, and
drop `MIGRATE_ON_START`.

### Deploy fixes (found while going live)

- **Migrations at startup** (`MIGRATE_ON_START=true`, `src/db/migrations.ts`): the free plan has no
  pre-deploy step, and Render's Docker Command keeps literal quotes (`sh -c "a && b"` exited 127).
  A failure prints the driver cause (e.g. `ECONNREFUSED 127.0.0.1:5432`) and exits.
- **Waking server** (web `src/lib/wake.ts`): Vercel's proxy answers 502 before a sleeping Render
  instance wakes (58 s measured). The API client now shows "Waking up the server…", pings `/api/me`
  until it answers, and retries the request once; real errors are never retried.
- **Gemini busy answers** (`src/ai/gemini.ts`): the free tier returned "503 high demand" mid-stream
  (Pixel's plan) and through every retry (Forge's build). Busy answers now retry 3 times (2/6/15 s)
  even mid-stream without repeating shown text, then fall back to the other model
  (`gemini-3.5-flash` ↔ `gemini-3.5-flash-lite`; the ledger marks `fellBack`).
- **Game status `built`** ("Ready to play", migration `0004_game_status_built`): with playtests off a
  built game no longer sits at "testing", and the Forge → Glitch handoff closes. The side panel
  refreshes the game status when the room's cards or agent posts change.
- **Claude Haiku 5.5 support** (price, no server-side fallback) for a cheaper Claude setup later.

### Needed from the owner

1. **Rotate the Supabase database password and the `service_role` key** (both were shared in chat),
   then update `DATABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` on Render.
2. To see bug repros, hotfixes and publishing live: Render Standard (2 GB; a card on file, paid from
   the hackathon credit) and the three changes under "Why free".
3. Optional: Nexconn Console → Chat settings → Messages → Translation (billed after 10,000 free
   characters), and a real voice pitch in the app (type `@pixel `, hold the mic).
4. Optional: Nexconn's media host in `NEXCONN_MEDIA_HOSTS` (the browser relay for voice).
5. Nexconn pre-messaging webhooks (the safety shield) need its Pro plan; on Free they can't be selected.
6. Merge `phase-5` (the owner merges).

## Phase 4: built, live E2E_CHAT run pending (branch `phase-4`)

Glitch playtests every build in the sandbox, failures go back to Forge automatically (max 2 rounds),
and nothing goes public until an owner or approver taps Allow.

### Done

- **Carry-over (live E2E_CHAT):** not run. Docker Desktop crashed on start (a stale
  `dockerInference` socket; worked around by renaming `%LOCALAPPDATA%/Docker/run` to `run.old-*`), then its WSL VM
  (`docker-desktop`) never came up. No Postgres, so no live run.
- **Sandboxed playtests (engine):** `playtest({ sandbox: true })` and `clip({ sandbox: true })` load the
  game in `<iframe sandbox="allow-scripts">` on a host page, like the player. Checks run in the
  frame, the fake clock and keys work through it, score messages land on the host. Same results as
  unsandboxed on the 3 real builds. `onProgress(done, total)` drives Glitch's `testing n/total`.
- **Glitch worker** (`agents/glitch.ts`): `glitch-playtest` jobs, one per room at a time (pg-boss
  group + memory queue). Probe of `state()`, then a scenario from the cheap model as flat JSON steps,
  validated (one action per step, engine schema, a start, exactly one `A<n> …` expect per acceptance
  item, ≤ 90 s game time) with one repair round. Then `playtest()` with saved repros (hard) and
  earlier scenarios (advisory), plus a GIF. Stored in `game_versions`: scenario, report, fps,
  `test_ms`, GIF + screenshot paths (new `clips` storage: public Supabase bucket / `.data/clips` /
  memory, served at `GET /clips/<slug>/v<N>/{play.gif,shot.png}`). Ledger `test.passed` / `test.failed`.
  The FAKE simulated PASS is gone: FAKE_AGENTS now runs the real worker with a generic scenario.
- **Test card:** PASS/FAIL, passed/total, fps, fix round, one row per acceptance item, ⚠ warnings, GIF, ▶ Play,
  [Ask for fix] (members), [Try again] once automatic fixes are used up.
- **Auto-fix loop:** FAIL → Glitch → Forge handoff with the failed checks → v+1 (`reason: fix`,
  `meta.fixRound`) → retest. After 2 automatic rounds: game `failed`, Glitch asks the crew. A member's
  fix starts at round 0. If Glitch can't write a valid scenario, nothing goes to Forge; Try again
  re-runs the playtest.
- **Publish gate:** PASS → `CA:PublishCard` (Play, GIF, Allow/Block), game `awaiting_approval` (a
  published game keeps its status), ledger `publish.requested`. `POST /api/cards/:id/publish`
  allows owner/approver only (agents never), claimed under the card row lock (2nd tap: 409).
  Allow → `published_version`, version `published`, card turns into the published card with the
  `/g` link + Share, Glitch announces it. Block → `blocked` (migration `0002_phase4_publish`).
  Ledger `publish.approved` / `publish.blocked`.
- **Public:** `/g/<slug>` plays the published version (Phase 3 page), `screenshotUrl` added; the OG
  image draws Glitch's screenshot (emoji tile fallback).

### Verified locally (2026-11-17)

- lint ✓ (ESLint, Prettier, client secret check), typecheck ✓, `pnpm test` 340 passing (1 skipped:
  the gated real-builds test), `pnpm eval:fast` 21/21 caught, 0 false FAILs.
- `pnpm e2e` 33 passed, 7 skipped (6 E2E_CHAT specs + the phone copy of `publish.spec.ts`, which owns
  the mock API port on desktop). Next 16.4.4's build stopped once inside Playwright's webServer with
  a "security vulnerability, upgrade" notice; building and starting the app first, then running
  Playwright against it, works.
- New tests: `test/glitch.test.ts` (scenario validation, round limit, fps rule, publish permissions,
  FAIL → 2 auto-fixes → Ask for fix → PASS → member 403 / owner Allow → public page + clip),
  `test/real-playtests.test.ts`, `e2e/publish.spec.ts`. Builds tests now run the real worker with a
  stub playtester.

### Playtest metrics (3 saved real builds, `REAL_PLAYTESTS=1`)

Real Chromium, sandboxed iframe, fake scenario writer, fake Forge for fixes (no new paid builds):
`REAL_PLAYTESTS=1 pnpm --filter @crewarcade/server exec vitest run test/real-playtests.test.ts`.

| Game                        | First try                | Auto-fix rounds | Playtest time | fps     | Result       |
| --------------------------- | ------------------------ | --------------- | ------------- | ------- | ------------ |
| Chai Scooter Dash           | PASS                     | 0               | 30 s          | 60      | published    |
| Ice Delivery                | FAIL: Space does nothing | 1               | 33 s + 47 s   | 58 / 57 | published v2 |
| दिवाली पटाखा बिल्ली (Hindi) | PASS                     | 0               | 30 s          | 60      | published    |

Average playtest 35 s (probe + scenario + playtest + GIF), first-try pass rate 2/3, 1 auto-fix round
in total. Earlier runs on the same laptop under load measured 10–34 fps for the same games (see Known
issues).

### Phone check (4 steps, after the Phase 3 ones)

1. After Forge's Build card turns Ready, Glitch's strip shows `testing 1/5 … 5/5`, then a Test
   card with a GIF and ✅ rows.
2. As a member: the publish card shows Play only, no Allow. As the owner: Allow → "is live", the
   `/g` link opens and plays.
3. Ask Forge for a change that breaks something: a FAIL card, then Forge's fix build and a new
   Test card without any tap.
4. Paste `/g/<slug>` into WhatsApp: the preview shows the game screenshot.

### Known issues

- The live E2E_CHAT run (Phase 3 + 4) is still pending: Docker Desktop's VM won't start here.
- **Frame rate is advisory in the worker** (decision this phase): the same game measured 58 fps,
  then 28 fps, and in one loaded run every game failed fps (31 min run; fixes could never pass).
  The worker passes `advisoryFps`: a low frame rate shows as ⚠ on the Test card and goes to Forge
  along with real failures, but it never fails a version alone. The engine default and the eval
  keep it hard. Phones are still the real test: the approver plays before Allow.
- Ice Delivery's v1 really fails (Space does nothing); one automatic round fixes it.
- A playtest takes ~30–50 s real time on top of the build (probe + scenario + playtest + GIF).
- Next.js 16.4.4 reports a known security advisory on build (an upgrade is suggested; not done here).

### Needed from the owner

1. Fix Docker Desktop (it fails to start its WSL VM) or give a Postgres URL, for the live E2E_CHAT run.
2. Render: nothing new; the `clips` bucket is created (public) on start with the Supabase keys.

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

| Game                        | Attempts | Build time | Tokens in / out | Smoke | Full playtest          |
| --------------------------- | -------- | ---------- | --------------- | ----- | ---------------------- |
| Chai Scooter Dash           | 1        | 57 s       | 3.5 K / 6.6 K   | PASS  | PASS                   |
| Ice Delivery                | 2        | 85 s       | 10.7 K / 18.9 K | PASS  | Space key does nothing |
| दिवाली पटाखा बिल्ली (Hindi) | 2        | 61 s       | 9.7 K / 15.0 K  | PASS  | PASS                   |

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

## Next: Phase 6

Public Arcade, game pages, share links + OG images, remixes, classroom mode, judge mode, `/stats`.

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
