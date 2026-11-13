# Status

Updated at the end of every phase. Branch per phase (`phase-<n>`); the owner merges.

## Phase checklist

| Phase | Theme                       | Status                                                        |
| ----- | --------------------------- | ------------------------------------------------------------- |
| 0     | Foundation                  | **Done** (branch `phase-0`)                                   |
| 1     | Identity, crews, chat       | **Built** (branch `phase-1`); live Nexconn check pending keys |
| 2     | Pixel, cards, approval      | —                                                             |
| 3     | Forge, builds, Live Theater | —                                                             |
| 4     | Glitch, playtest, publish   | —                                                             |
| 5     | Bugs, voice, languages      | —                                                             |
| 6     | Arcade and growth           | —                                                             |
| 7     | Polish and launch           | —                                                             |

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

## Next: Phase 2

Pitch detection, Pixel plan cards (`CA:Card` renderers), voting via message metadata, approver
Approve, ledger, agent states (`CA:AgentState` → chips and the crew-list dot), handoffs, the first
pre-messaging shield rules, game rooms.

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
