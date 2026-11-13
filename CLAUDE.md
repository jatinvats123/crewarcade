# CrewArcade

CrewArcade: **your friends + 3 AI agents, one chat, a new game in minutes.** A crew is a Nexconn
group chat where Pixel (Designer), Forge (Builder) and Glitch (Playtester) are real members: they turn
pitches into a plan, build the game as one HTML file, and playtest it headlessly with a GIF. Humans
pitch, vote, approve, play, report bugs and publish; nothing goes public until an approver taps Allow.
Built for the Nexconn Build Challenge 2026 (deadline 2026-11-22 23:59 AoE) on the Nexconn Chat SDK.

**Read first, every phase:** `docs/SPEC.md` (product), `docs/STATUS.md` (where we are),
`docs/NEXCONN.md` (chat integration), `docs/ENGINE.md` (game contract), `docs/DESIGN.md` (UI).

## Repo map

```
apps/web          Next.js App Router + Tailwind v4 (Vercel). Mobile-first UI, Nexconn Web SDK client.
  src/app           routes (/ landing, /dev/ui component gallery)
  src/components    ui/ (design-system components), brand/ (logo, theme toggle)
  src/env.ts        public env schema (NEXT_PUBLIC_* only)
  e2e/              Playwright e2e (phone + desktop)
apps/server       Fastify API + Nexconn webhooks + pg-boss jobs + AI agents + playtest worker (Render, Docker)
  src/config.ts     zod env loader (fails fast; service keys required in production)
  src/app.ts        buildApp() with injected deps (/health)
  src/db/           Drizzle schema, client, migrate, seed (agent users)
  drizzle/          generated SQL migrations (never hand-edit; `pnpm db:generate`)
  Dockerfile        on mcr.microsoft.com/playwright (tag = engine's playwright version)
packages/engine   starter template, static checker, headless playtester, GIF clipper, versioning, eval
packages/shared   browser-safe constants, IDs, zod schemas for cards/messages/webhooks
scripts/          repo scripts (client secret check)
docs/             source-of-truth docs
.claude/skills/nexconn-chat   Nexconn's official coding-agent skill (use it for all Nexconn code)
render.yaml       Render blueprint (one web service, ≥ 2 GB)
```

## Commands

```bash
pnpm install                 # Node 22 LTS, pnpm 10 (corepack)
pnpm browsers                # Playwright Chromium (engine tests, eval, e2e)
pnpm dev                     # web :3000 + server :8080 (server needs apps/server/.env with DATABASE_URL)
pnpm test                    # all unit/integration tests (engine tests launch Chromium)
pnpm lint                    # ESLint + Prettier check + client secret check
pnpm format                  # Prettier write
pnpm typecheck               # tsc in every package
pnpm e2e                     # web e2e (builds and starts the web app)
pnpm eval                    # engine eval: planted bugs caught (full, ~5 min)
pnpm eval:fast               # CI profile
pnpm build                   # web (next build) + server (esbuild → apps/server/dist)
pnpm db:generate             # SQL migration from the Drizzle schema
pnpm db:migrate              # apply migrations (DATABASE_URL)
pnpm db:seed                 # upsert the three agent users
docker build -f apps/server/Dockerfile -t crewarcade-server .   # server image (repo root context)
```

Deploy: **web → Vercel** (root `apps/web`, `vercel.json`, env from `apps/web/.env.example`);
**server → Render** via `render.yaml` (Docker, `/health`, `preDeployCommand: node dist/migrate.js`,
secrets in the dashboard). The web app builds with Next's webpack mode (`next dev/build --webpack`) and the server
with esbuild, because Windows Smart App Control on the dev machine blocks the native Turbopack and
Rollup binaries; the same commands run in CI and on Vercel.

## Coding rules

- **Strict TypeScript everywhere** (`tsconfig.base.json`: strict, noUncheckedIndexedAccess). No `any`.
- **zod at every boundary:** env, HTTP bodies, webhook payloads, Nexconn message content, AI outputs,
  game specs and scenarios, postMessages from games. Parse, don't trust.
- **No secrets client-side.** Browser code reads only `NEXT_PUBLIC_*` (ESLint rule + `scripts/check-client-secrets.mjs`
  in CI). App Secret, signing, token issuance and every Platform Chat API call stay on the server.
- **Small pure functions**, dependencies injected (see `buildApp`), side effects at the edges.
- **Tests for every rule:** each validation, permission, safety rule and limit gets a test. Fix bugs
  with a failing test first.
- IDs: `newId(kind)` from `@crewarcade/shared` (alphanumeric, Nexconn-safe); talk to Nexconn with
  `nexconnUserId()`.
- Games: only via the engine contract (`docs/ENGINE.md`); fixtures in `packages/engine/fixtures` are
  test data, never shown as CrewArcade games.
- AI: `claude-opus-5-5` via `@anthropic-ai/sdk`; structured outputs, explicit effort, prompt caching,
  server-side refusal fallbacks, check `stop_reason` before reading content, no assistant prefill.
  Use the claude-api skill for exact SDK syntax.
- Commits: small and logical, imperative subject. Never commit `.env` files or real keys.

## Phase discipline

- Phases 0–7 (see `docs/SPEC.md` §10), **each on its own branch** (`phase-<n>`). **Only build the
  current phase.** Don't merge; the owner does.
- At the end of each phase: run lint, typecheck, tests, eval; **update `docs/STATUS.md`** (done, next,
  known issues); report what to verify and what is needed from the owner.
- **When the Nexconn docs and `docs/NEXCONN.md` disagree, the live docs win; fix NEXCONN.md** in the
  same change. Fetch docs with the `nexconn-chat` skill (`.claude/skills/nexconn-chat/scripts/fetch-docs.sh`)
  and verify SDK names in `node_modules/@nexconn/**/*.d.ts` before using them.
