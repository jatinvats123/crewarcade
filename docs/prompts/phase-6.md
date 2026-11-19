You are continuing CrewArcade. Phase 6: polish, harden and prepare the launch. Nothing new unless it fixes a real problem or is needed for launch. Stop with a short report.

## How to work

- Read CLAUDE.md and docs/STATUS.md (Phase 5 + "Live deploy" + "Deploy fixes"). From SPEC/NEXCONN/DESIGN read only the sections a task needs (grep by heading).
- Branch `phase-6` from `phase-5`. Production (Vercel + Render) deploys from `phase-5`: don't change that; the owner merges.
- Live setup is free hosting: Render free (512 MB, sleeps, `PLAYTESTS=false`), Gemini free tier, Supabase Tokyo. Don't redo deploy work; build for it.
- Already built and tested, don't re-verify: Nexconn token refresh/reconnect/failover/retries, idempotent webhooks, AI timeouts/refusals/busy retries + model fallback, budget guard, waking-server retry, request ids (Fastify `reqId`). Just list them in the report.
- Post a plan (max 12 lines: order, biggest risks) and wait for my OK.
- While fixing, run only the touched tests (failures only); the full suite once at the end, run package by package (engine FPS checks flake when suites run in parallel). No new tests unless they guard a fix or a security rule. Summarize numbers, never paste raw output.
- One STATUS.md line after each section.

## 0. Arcade

- A public `/arcade` page: published games, newest and top (by plays/best score), linking to `/g/:slug`. Never show fixture games.

## 1. UX polish (phone first, 360px + desktop)

- Walk: start → crew → pitch → approve → build → play → /g → arcade. Fix spacing, overflow, long names/titles, emoji, Devanagari/Tamil.
- Where missing: empty state with an action, loading skeleton, error with retry.
- Copy: fix agent messages that read badly (short, friendly, Hinglish where natural). Include the free-plan lines ("playtests are switched off").
- Respect `prefers-reduced-motion` (card entrances, votes, player open/close).
- Accessibility: keyboard navigation, visible focus, labels on cards/buttons, AA contrast in both themes.
- First run: 3-step "how it works" (pitch → approve → play) with Skip, plus a sample pitch chip ("Try: a mango dodging crows on a rooftop").

## 2. Performance

- Load test, server only, locally (FAKE agents, fake Nexconn): 30 users, 10 crews, 6 builds at once. One script, one run; report p50/p95 API latency, queue wait, DB pool use, errors. Fix only real bottlenecks.
- Lighthouse mobile on `/arcade` and `/g/:slug` (production build): ≥ 90 performance, ≥ 95 accessibility. Code-split the Player only if a target is missed. Report the scores.

## 3. Security (short docs/SECURITY.md)

- List keys to rotate (pasted in chat: Supabase DB password, Supabase `service_role`, Sarvam key) and confirm the CI client-secret check; no secrets in logs or the repo.
- Document existing webhook signatures + replay window, auth/role checks, zod validation, rate limits, CORS. Fix only real gaps.
- Game sandbox: one malicious test game (fetch, top navigation, cookies/storage, parent DOM) must fail every attempt, as an automated test.
- Prompt injection: 10 attempts (chat, bug report, pitch) against the live cheap model; record the results.
- Privacy page (what we store, 30-day message log retention) and a working "Delete my account".

## 4. Admin

- Owner-only `/admin` (user ids from an `ADMIN_USER_IDS` env): failures by stage, p50/p95 per stage (plan, build, test) from the ledger, cost per day, queue depth, signups by referrer.

## 5. Launch kit

- Referrer codes on invite and share links (counted in /admin).
- After publishing: a "Share your game" sheet (WhatsApp, Instagram, copy) with English + Hinglish text, extending the existing Share button. After a high score: "Challenge a friend".
- docs/LAUNCH.md: day-by-day plan (10 friends → fix → college/hackathon groups → LinkedIn + Instagram reel), exact post texts (English + Hinglish), traction screenshots to take (Nexconn Console usage, /admin, user quotes). Note the free-plan limits and when to switch Render to Standard (publishing needs playtests).
- docs/QA.md: a 20-item phone checklist for me.
- I seed the Arcade with 5–8 real games made through the app. Never import fixture games.

## Done when

- Main flows have no rough screens on phone or desktop; Lighthouse met or explained.
- Load test numbers reported; SECURITY.md done with real gaps fixed; delete-account works.
- Launch kit ready; STATUS.md updated; short report with the numbers.
