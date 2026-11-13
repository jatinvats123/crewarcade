# Status

Updated at the end of every phase. Branch per phase (`phase-<n>`); the owner merges.

## Phase checklist

| Phase | Theme                       | Status                      |
| ----- | --------------------------- | --------------------------- |
| 0     | Foundation                  | **Done** (branch `phase-0`) |
| 1     | Identity, crews, chat       | Next                        |
| 2     | Pixel, cards, approval      | —                           |
| 3     | Forge, builds, Live Theater | —                           |
| 4     | Glitch, playtest, publish   | —                           |
| 5     | Bugs, voice, languages      | —                           |
| 6     | Arcade and growth           | —                           |
| 7     | Polish and launch           | —                           |

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

## Next: Phase 1

Guest sign-in and sessions, Nexconn token issuance (server client with signing + failover), web
Nexconn client (initialize once, register custom types, connect), crews + invite links, group channels
with the agents as members, chat timeline (text, typing, read receipts, presence, mentions),
webhooks (`message:send`, `user:connection_status`) with signature check and dedupe, first deploy to
Render + Vercel.

## Known issues / open questions

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
- CI has not run yet: the repo has no GitHub remote. Push `phase-0` to see it go green.
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
