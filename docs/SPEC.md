# CrewArcade product spec

> **Your friends + 3 AI agents. One chat. A new game in minutes.**

This is the main reference for every phase. Engine details live in `ENGINE.md`, Nexconn details in
`NEXCONN.md`, UI in `DESIGN.md`, progress in `STATUS.md`.

## 1. The product

Friends create a **crew**: a group chat. Three AI agents are real members of that chat, with their own
Nexconn identities, avatars, states and messages:

- **Pixel (Designer)** turns pitches into a game plan with an acceptance checklist.
- **Forge (Builder)** writes the game as one self-contained HTML file.
- **Glitch (Playtester)** plays the game headlessly against the checklist, reports PASS/FAIL with a
  GIF, and turns players' bug reports (including phone screenshots) into saved repro tests.

Humans pitch, vote, approve, play, report bugs and publish. **Nothing goes public until an approver
taps Allow.** Each approved game gets its own **game room**. Published games go to a public **Arcade**
with share links, leaderboards and remixes. Anyone can watch a build live in the **Live Build Theater**.

Who it is for: groups of friends (13+) on phones, classrooms (a teacher runs a crew of students),
and anyone who opens a shared game link and wants to make their own.

## 2. Hackathon context

- **Nexconn Build Challenge 2026** (Reskilll). Deadline **2026-11-22 23:59 AoE**.
- Must use the **Nexconn Chat SDK** with real, measurable usage.
- Judging: **50% completeness & UX**, **30% innovation & scenario value**, **20% business & growth**
  (judges count active users on our Nexconn App Key; traction is a significant bonus).
- Nexconn's strategy: **AI agents as first-class chat participants** plus trust & safety. Every feature
  should show one of these pillars:

| Pillar                           | How CrewArcade shows it                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Agent identities                 | Pixel, Forge, Glitch are Nexconn users with tokens, avatars, presence; members of every crew channel |
| Agent-to-agent handoffs          | `CA:HandoffCard`: Pixel → Forge ("Build v1 from this plan"), Forge → Glitch, Glitch → Forge (fix)    |
| Streamed and structured messages | Agents stream replies (`RC:StreamMsg`, markdown); every decision is a typed card (`CA:PlanCard`, …)  |
| Human-in-the-loop approval       | Plan votes + Approve; publish needs an approver's Allow; both are live metadata on the card          |
| Audit trails                     | `ledger` table + per-game "How it was made" timeline (who decided what, tokens, cost, time)          |
| Agent states                     | `CA:AgentState` → state chips (thinking, building, testing, waiting for you…)                        |
| Prompt-injection defense         | Pre-messaging shield + agents treat chat as untrusted data + typed outputs only                      |
| Trust & safety                   | Pre-messaging moderation, masked content, report flows, sandboxed games, publish gate                |

## 3. Personas

### Humans

| Persona           | What they do                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| **Owner**         | Creates the crew, invites friends, is an approver, promotes approvers, removes members                |
| **Approver**      | Approves plans (after votes) and taps Allow/Block on publish requests                                 |
| **Member**        | Pitches, votes, plays, reports bugs, asks for changes, reacts in the Live Theater                     |
| **Arcade player** | Opens a share link without an account, plays, sees the leaderboard; signs up to save a score or remix |
| **Teacher**       | Owner of a `classroom` crew: is the only approver, sees every message, can mute and pause agents      |
| **Judge**         | A user flagged `is_judge`: gets a demo crew with seeded history and an unlimited build budget         |

### Agents

All agents use Anthropic **`claude-opus-5-5`** through `@anthropic-ai/sdk` on the server, with
structured outputs (`output_config.format`, JSON schemas generated from our zod schemas), an explicit
`output_config.effort`, prompt caching of the long system prompt + engine contract, server-side
refusal fallbacks (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`), and a check of
`stop_reason` before reading content. No assistant prefill. Chat text from humans is always passed as
**untrusted data** inside a delimited block, never as instructions.

| Agent      | Trigger                                                        | Output (typed)                                                      | Effort |
| ---------- | -------------------------------------------------------------- | ------------------------------------------------------------------- | ------ |
| **Pixel**  | a pitch (Pitch button, "pitch:" or @Pixel) or a change request | `GameSpec` (4–8 acceptance items) → plan card; replies in chat      | medium |
| **Forge**  | handoff from Pixel (approved plan) or Glitch (failed test/bug) | the GAME region code + notes → `index.html` via `replaceGameRegion` | high   |
| **Glitch** | handoff from Forge (build ready) or a bug report               | `Scenario` (one expect per acceptance item) or a repro              | medium |

Personalities: Pixel is curious and visual (asks one clarifying question at most, credits ideas);
Forge is terse and confident (reports size, time, what changed); Glitch is playful and precise
(always shows the evidence: GIF, failed check, exact numbers). All keep messages under 1,500
characters, never paste code into chat, and act only on their trigger.

## 4. User flows

### 4.1 Sign in

No passwords. A visitor picks a display name (2–24 characters), one of 24 emoji avatars, a ring
colour (6) and optionally a language, then taps **Let's go**. `POST /api/auth/guest` creates the user
(non-sequential nanoid id) and sets the session cookie; `GET /api/me` returns the profile, `PATCH
/api/me` edits it. The browser then fetches its own Nexconn token (`POST /api/nexconn/token`), which
the server issues once and caches AES-256-GCM-encrypted, and connects. `users.is_judge` exists for
judge accounts (Phase 6 builds `/judge`). A guest account lives in that browser; signing out loses it.

#### Sessions and the API proxy (decision, Phase 1)

- The web app (Vercel) and the API (Render) are on different domains. Third-party cookies are blocked
  on most phones, so the browser **only ever talks to the web origin**: a Next.js rewrite
  (`apps/web/next.config.ts`) forwards `/api/*` to the Render server (`NEXT_PUBLIC_API_ORIGIN`).
  The session cookie is therefore first-party and host-only on the web domain; no CORS is needed.
- Chosen over Next route handlers because a rewrite is a plain proxy at the edge: no extra code
  path, `Set-Cookie` passes through, and Vercel streams it. Webhooks do not go through the proxy:
  Nexconn calls Render directly (`/webhooks/nexconn`).
- Cookie `ca_session`: HS256 JWT `{ sub, iat, exp, v }` signed with `SESSION_SECRET`, `HttpOnly`,
  `SameSite=Lax`, `Secure` in production, `Path=/`, 90 days.
- Mutating `/api` requests must come from the web origin (`Origin` check; localhost is allowed
  outside production). Sign-ups are limited to 10 per minute per IP, crew creation to 5 per minute.

### 4.2 Create and join a crew

1. Owner taps **New crew** and names it (2–40 characters), or a first-time user taps **Start a solo
   crew** (just them + the agents).
2. Server creates the Nexconn **group channel** first (owner = the user, members = the three agents,
   `joinPerm 0` so membership stays server-controlled), then the `crews` and `crew_members` rows, then
   Pixel posts a welcome text ("Hi crew! I'm Pixel… Pitch a game with @pixel…").
3. Owner shares the **invite link** `/i/<inviteCode>` (8 characters without 0/O/1/I). On phones the
   Share button opens the native share sheet with a WhatsApp-ready message; on desktop it copies the
   link. A friend opens it, sees the crew name and member avatars, signs in inline if needed, taps
   **Join crew**; the server adds them with `/v4/group-channel/join` and Pixel posts a `CA:Notice`
   ("Riya joined the crew"). Crews hold up to 30 members.
4. Roles: the owner promotes members to **approver** or back (`PATCH /api/crews/:id/members/:userId`).
   Owner and approvers are the approvers of the permission model; agents never are.

### 4.3 Pitch → plan → approve

1. Members pitch ideas (text, or a voice note transcribed by Sarvam `saaras:v4`, Hindi/Hinglish ok).
2. The router (`apps/server/src/agents/router.ts`) sees the message on the `message:send` webhook:
   `@pixel` (structured mention, text, or the Hindi name), `pitch: …`, `remix <game> into …`, or a plain
   pitch in a **solo crew** (one human). It enqueues an idempotent job (id from the messageId); one
   job per room runs at a time. Messages from agents never trigger agents.
3. Pixel's chip shows **thinking**, then **designing** while its 1-2 sentence intro streams into the
   chat ("Ooh, I love this! Planning _Chai Dash_…", in the pitcher's language or Hinglish). Then it
   posts `CA:PlanCard`: title, pitch, controls, core loop, win/lose, scoring, look, sound, 4-8
   acceptance items (checkable via `window.__crew.state()`), language, credits. The game row exists
   from here (`status planning`, unique slug).
4. Anyone votes 👍/👎 (`POST /api/cards/:messageId/vote`; metadata `yes`, `no`, `voters`); counts
   update live on every phone. There is no quorum: an owner/approver taps **Approve** when the crew
   is happy (in a solo crew the owner). Metadata `status = approved`, `approvedBy`, `roomChannelId`.
5. **Change**: a sheet ("make it faster") or "@pixel make it …" → Pixel posts plan v+1, the old card
   becomes `superseded`, votes start again.
6. On approval: the **game room** "🎮 <title>" (group channel with every crew member + agents), a
   `CA:RoomLink` in the crew chat, the approved plan copy and a `CA:HandoffCard` (Pixel → Forge) in the
   room, build v1 queued for Forge (Phase 3 runs it; the handoff shows "Forge will start soon"), one
   crew-memory preference saved (`crews.settings.memory`, ≤ 10 bullets, used in later plans). Every
   step is in the ledger.

Superseded or ignored plans stay in the chat; a new pitch starts a new plan.

### 4.4 Build (streamed) and Live Build Theater

1. Forge's state becomes `building`; it streams progress into the game room (`RC:StreamMsg`: "title
   screen ✓, mango physics…").
2. A **Live Build Theater** link (open channel + `/live/<id>`) lets anyone watch: progress stream,
   floating emoji reactions (`CA:Reaction`), viewer count.
3. The server runs `checkHtml()`; on problems Forge retries (≤ 2 times, ledger `build.check_failed`).
4. Success → `build_ready` card (size, time, notes) and a handoff to Glitch. Ledger `build.ready`.

### 4.5 Playtest

1. Glitch writes the scenario from the acceptance checklist and runs `playtest()` on the playtest
   worker, plus every saved repro (hard) and earlier scenarios (advisory).
2. Result card `playtest`: PASS/FAIL, checks passed/total, fps, one row per acceptance item, the GIF
   (`clip()`), a screenshot. Ledger `test.passed` / `test.failed`.
3. FAIL → Glitch hands off to Forge with the failed checks; Forge fixes (≤ 2 automatic rounds), then
   asks the crew.
4. PASS → **publish request** card (`publish_request`) to the crew with Play, the GIF and Allow/Block.

### 4.6 Publish (the gate)

1. Any member can play the build in the game room first (sandboxed player, full screen).
2. Only an **owner or approver** can tap **Allow** (or **Block**). Metadata `status`, ledger
   `publish.approved` / `publish.blocked` with the actor.
3. Allow → version published, `published` card with the Arcade link and share sheet.

### 4.7 Play, score, leaderboard

The player embeds the game in an iframe (`sandbox="allow-scripts"`, no same-origin), listens for the
score hook (`crewarcade:start` / `crewarcade:score`), and posts scores to the server, which checks
plausibility (time, max rate) before writing `scores`. Leaderboard card in the game room; leaderboard
on the Arcade page; weekly "top of the crew" message.

### 4.8 Bug report → repro → hotfix

1. A player taps **Report a bug** (from the player or the chat), describes it, optionally attaches a
   phone screenshot (stored in the private `uploads` bucket).
2. Glitch reads the description and screenshot (vision), writes a repro scenario, and runs it on the
   current version: **FAIL = reproduced** → `repro` card with the bug on camera (red-banner GIF), bug
   status `reproduced`; PASS = `not_reproduced` and Glitch asks one follow-up question.
3. Forge builds a hotfix version; Glitch replays the repro (+ all older repros and scenarios as hard
   checks) and posts a `hotfix` card with the side-by-side GIF (old fails, new passes). The bug hunter
   is credited in the notes and on the game page. Publishing the hotfix uses the same Allow gate.

### 4.9 Remix

Anyone signed in can **Remix** a published game: a new game in their crew starting from the latest
version (`remixOf`), with Pixel asking "what should change?". The original shows "remixed as…".

### 4.10 Arcade and sharing

Public pages: `/arcade` (new, top, remixes), `/g/<slug>` (play, leaderboard, GIF, credits, "How it was
made" ledger timeline, Remix), `/live/<id>`. Share links carry Open Graph images (the GIF frame) and
a "make your own" call to action that leads into crew creation.

### 4.11 Translation

Each user picks a language (`en hi ta bn te mr gu kn ml ur`). Messages can be translated on tap with
Nexconn built-in translation (`TranslatedBadge`), auto-translate is opt-in, and usage is capped per
user per day because translation is billed per character.

## 5. Card catalogue

**Decision (Phase 2):** every card is its own custom message type (`CA:PlanCard`, `CA:HandoffCard`,
`CA:BuildCard`, `CA:TestCard`, `CA:PublishCard`, `CA:BugCard`, `CA:ScoreCard`, `CA:RoomLink`), replacing
the Phase 0 single `CA:Card` envelope, so each is registered on its own and old clients ignore new
types. Content is JSON with a schema version `v` (zod in `packages/shared/src/cards.ts`); live state is
Nexconn message metadata (string values, parsed by `parseCardMeta`), always computed by the server from
`cards.state` (the source of truth, updated under a row lock). The rows below are the product view;
the Phase 2 type names are: plan → `CA:PlanCard`, handoff → `CA:HandoffCard`, game_room → `CA:RoomLink`,
build_ready → `CA:BuildCard`, playtest → `CA:TestCard`, publish_request/published → `CA:PublishCard`,
bug_report/repro → `CA:BugCard`, leaderboard → `CA:ScoreCard`. Shield cards arrive with the shield.

| Card              | Sent by       | When                         | Shows                                               | Actions (who)                                |
| ----------------- | ------------- | ---------------------------- | --------------------------------------------------- | -------------------------------------------- |
| `pitch`           | human         | Pitch button / voice note    | idea text, language                                 | 👍 (all)                                     |
| `plan`            | Pixel         | after pitches                | title, pitch, highlights, checklist, credits, votes | vote (members), Approve / Reject (approvers) |
| `handoff`         | agent         | work moves between agents    | from → to, reason, version                          | —                                            |
| `game_room`       | system        | plan approved                | link to the new room                                | Open room (all)                              |
| `live_build`      | system        | build starts                 | watch link, viewers                                 | Watch / Share (all)                          |
| `build_ready`     | Forge         | static check passed          | version, size, build time, notes, check result      | Play (all)                                   |
| `playtest`        | Glitch        | playtest finished            | PASS/FAIL, per-item results, fps, GIF, screenshot   | Play (all), Ask for fix (members)            |
| `publish_request` | system/Glitch | playtest passed              | title, play link, GIF, who can approve              | Allow / Block (owner, approvers)             |
| `published`       | system        | Allow tapped                 | Arcade link                                         | Share, Play (all)                            |
| `bug_report`      | human         | Report a bug                 | description, screenshot, version                    | —                                            |
| `repro`           | Glitch        | repro ran                    | reproduced or not, check label, GIF                 | Ask Forge to fix (members)                   |
| `hotfix`          | Forge/Glitch  | hotfix tested                | old vs new GIF, pass                                | Publish request flows as above               |
| `leaderboard`     | system        | new top score / weekly       | top 10                                              | Play (all)                                   |
| `shield`          | system        | a message was blocked/masked | rule, action, a safe summary (never the content)    | Learn more                                   |

Other custom types: `CA:AgentState` (status message, not persisted: `{v, agentId, state, detail,
startedAt, progress?}` with states idle, thinking, designing, building, checking, testing, fixing,
waiting_approval, blocked; re-sent every 5 s while busy, clients drop busy states after 15 s without a beat),
`CA:Notice` (welcome, joins, room created, budget), `CA:Reaction` (Live Theater, not persisted),
`CA:Typing` (group typing indicator, status message; the Web SDK has typing only for direct channels).

## 6. Game lifecycle

`games.status`: `planning → building → testing → awaiting_approval → published`, with `failed` when
automatic fixes run out (the crew can ask again). Each build is a `game_versions` row (`version` 1, 2, …)
with its spec, check result, scenario, playtest report, GIF, screenshot, timings, tokens and cost.
`games.published_version` points at the live version; old versions stay playable from the room.

## 7. Data model

Supabase Postgres via Drizzle (`apps/server/src/db/schema.ts`, migration `apps/server/drizzle/0000_init.sql`).
IDs are non-sequential alphanumeric nanoids (`newId()`), timestamps `timestamptz`, columns snake_case.

| Table            | Purpose / key columns                                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`          | humans and agents: display name, avatar emoji/colour (+ `avatar_url` for agents), language, auto-translate, last seen, encrypted Nexconn token, `is_agent`, `is_judge` |
| `crews`          | group channel id, name, owner, unique invite code, kind `crew`/`classroom`, settings jsonb                                                                             |
| `crew_members`   | (crew, user) → role `owner`/`approver`/`member`, joined at                                                                                                             |
| `games`          | unique slug, crew, game room channel, title, pitch, status, language, remix of, created by, published version                                                          |
| `game_versions`  | (game, version) unique: spec, html path, size, check result, scenario, playtest, GIF/screenshot paths, build/test ms, tokens, cost, status, notes[]                    |
| `bugs`           | game, reporter, description, screenshot path, repro scenario, reproduced on / fixed in version, status                                                                 |
| `scores`         | game, version, user, score, time ms (index game, score desc)                                                                                                           |
| `cards`          | Nexconn message id → card type, channel, game, version, state jsonb                                                                                                    |
| `ledger`         | audit trail: game, crew, actor type/id, action, summary, input, output, reason, tokens, cost, ms                                                                       |
| `messages_log`   | from `message:send`: agent context and stats, kept 30 days                                                                                                             |
| `moderation_log` | channel, user, rule, action `blocked`/`masked`/`flagged`, masked excerpt                                                                                               |
| `connections`    | from `user:connection_status` (event id key → idempotent): user, status, os, at                                                                                        |
| `usage`          | (day, user): builds, translation chars, cost (daily credits and budget guard)                                                                                          |
| `live_rooms`     | open channel id, game, started/ended, peak viewers                                                                                                                     |
| `webhook_events` | webhook dedupe by Nexconn event id                                                                                                                                     |

Ledger actions: `plan.created`, `plan.revised`, `plan.vote`, `plan.change_requested`, `plan.approved`,
`plan.refused`, `plan.failed`, `room.created`, `build.queued`, `agent.replied`, `agent.explained`,
`crew.memory_updated` (Phase 2), `handoff`, `build.started`,
`build.check_failed`, `build.ready`, `test.passed`, `test.failed`, `bug.reported`, `bug.reproduced`,
`hotfix.ready`, `publish.requested`, `publish.approved`, `publish.blocked`, `shield.blocked`,
`moderation.masked` (format `area.verb`, enforced by a CHECK constraint).

Storage buckets: `clips` (public: GIFs, screenshots), `uploads` (private: bug screenshots, voice notes),
`games` (private: game HTML, served by our server with strict headers).

## 8. Permission model

| Action                                   | Owner | Approver | Member |                    Agent                    |    Visitor    |
| ---------------------------------------- | :---: | :------: | :----: | :-----------------------------------------: | :-----------: |
| Chat, pitch, vote, react, report a bug   |   ✓   |    ✓     |   ✓    |                      —                      |       —       |
| Approve / reject a plan                  |   ✓   |    ✓     |   —    |                      —                      |       —       |
| Allow / block publishing                 |   ✓   |    ✓     |   —    |                    never                    |       —       |
| Promote/demote approvers, remove members |   ✓   |    —     |   —    |                      —                      |       —       |
| Invite (share invite link)               |   ✓   |    ✓     |  ✓\*   |                      —                      |       —       |
| Start builds / playtests                 |   —   |    —     |   —    | ✓ (only from an approved plan or a handoff) |       —       |
| Play published games, see leaderboards   |   ✓   |    ✓     |   ✓    |                      —                      |       ✓       |
| Remix a published game                   |   ✓   |    ✓     |   ✓    |                      —                      | after sign-in |

\* Classroom crews: only the teacher invites and approves; agents never act on DMs from students.
Every permission is checked on the server from `crew_members`, never from the client or the card.
Agents cannot approve or publish anything, ever; approvals are human-only by construction.

## 9. Safety rules

1. **Pre-messaging shield** (`group_channel:pre_messaging`, < 5 s, deterministic): blocks prompt
   injection aimed at agents ("ignore your instructions", fake system tags, attempts to make an agent
   approve/publish), obvious secrets (API keys, tokens), and abusive content; masks profanity and
   personal data (phone numbers, emails) with `replaceContent`. Blocked → `pass: 0` with a friendly
   `extra`, a `shield` card, `moderation_log` + ledger `shield.blocked`. On timeout Nexconn delivers the
   original, so agents re-check on read.
2. **Agents treat all chat as data.** Human text goes inside delimited untrusted blocks; outputs are
   schema-validated (zod); agents have no tools that publish, approve, change roles or reach the network.
3. **Game sandbox:** generated HTML passes `checkHtml()` (no network, no external assets), is served
   from our server with a strict CSP (`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:`), and runs in an iframe with `sandbox="allow-scripts"` (no same-origin, no top navigation, no popups). Only `crewarcade:*` postMessages are accepted.
4. **Publish gate:** nothing appears in the Arcade without a human Allow from an owner/approver;
   every gate decision is in the ledger.
5. **Original games only:** Pixel rewrites "make Flappy Bird" into an original game with its own name,
   theme and art; Glitch's review flags known names in titles.
6. **Budgets and rate limits:** per-user daily builds (`LIMITS.dailyBuildsPerUser`), global
   `DAILY_BUDGET_USD`, translation caps, Nexconn rate limits respected by a send queue (20 msg/s).
7. **Secrets** never reach the browser (CI check). Tokens are encrypted at rest.
8. **Reporting:** any message or published game can be reported; reported games are hidden from the
   Arcade pending owner review.
9. **Transparency:** every agent message carries the AI-generated badge; the "How it was made" page
   shows the full ledger.

## 10. Feature list by phase

Each phase runs on its own branch and ends with a report and an updated `STATUS.md`.

| Phase | Theme                       | Scope                                                                                                                                                                                                                                                                                                                                            |
| ----- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **0** | Foundation                  | Monorepo, engine import + eval, docs, data model + migration + agent seed, design system, CI, deploy skeletons                                                                                                                                                                                                                                   |
| **1** | Identity, crews, chat       | Guest sign-in, token issuance, Nexconn client (init, custom types, connect), crews + invite links, group channels with agents as members, chat timeline (text, typing, read receipts, presence, mentions), webhooks (`message:send`, `user:connection_status`) → `messages_log`/`connections`, Nexconn server client with failover, first deploy |
| **2** | Pixel, cards, approval      | Pitch detection, Pixel plan cards, voting via metadata, approver Approve, ledger, agent states, handoffs, pre-messaging shield v1, game rooms                                                                                                                                                                                                    |
| **3** | Forge, builds, Live Theater | pg-boss queue, Forge build jobs with streamed progress, static-check retries, Storage, Live Build Theater (open channel, reactions, viewers)                                                                                                                                                                                                     |
| **4** | Glitch, playtest, publish   | Playtest worker, PASS/FAIL cards with GIFs, auto-fix loop, publish request + Allow/Block, sandboxed player, score hook, leaderboards                                                                                                                                                                                                             |
| **5** | Bugs, voice, languages      | Bug reports with screenshots (vision), repros, hotfix flow with side-by-side GIFs, voice pitches (Sarvam), built-in translation with usage caps                                                                                                                                                                                                  |
| **6** | Arcade and growth           | Public Arcade, game pages, share links + OG images, remixes, classroom mode, judge mode, `/stats` (MAU, builds, messages)                                                                                                                                                                                                                        |
| **7** | Polish and launch           | Desktop 3-column layout polish, accessibility pass, safety hardening, load test, demo crew, submission video and write-up                                                                                                                                                                                                                        |

## 11. Out of scope

Voice/video calls, native apps, multiplayer real-time games, payments, games with network access
or external assets, Nexconn Chat UI kit, Nexconn auto-moderation.
