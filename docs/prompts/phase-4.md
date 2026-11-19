You are continuing CrewArcade. This is Phase 4: Glitch (Playtester) tests every build, and nothing goes public until an approver taps Allow. Build only this phase. Stop with a report.

## How to work

Same rules as Phase 3 (read CLAUDE.md + STATUS.md; only needed doc sections; plan max 15 lines and wait for OK; run only touched tests while building, full suite once at the end; 2–3 line STATUS note per section). Branch phase-4 from phase-3. Keep outputs short; don't rebuild the web app for e2e until the end.

## 0. Carry-over

- Run the Phase 3 E2E_CHAT=1 e2e live once (needs Docker/Postgres) and fix what it finds.

## 1. Glitch playtest worker

- Run queued glitch-playtest jobs (one per room at a time). Glitch writes a scenario from the acceptance list (cheap model, structured JSON, one labelled expect per item), then runs playtest() with the game inside a sandboxed iframe (allow-scripts only), plus saved repros (hard).
- CA:AgentState progress (testing 5/8) only; no extra progress stream.
- Store scenario, report, fps, GIF (clips bucket) and a screenshot in game_versions; ledger test.passed / test.failed.

## 2. Test card

- CA:TestCard: PASS/FAIL, passed/total, fps, one row per acceptance item, GIF, [▶ Play], [Ask for fix] (members).

## 3. Auto-fix loop

- FAIL → Glitch hands failed checks to Forge → next version → retest. Max 2 automatic rounds, then ask the crew (status failed, [Try again]).

## 4. Publish gate

- PASS → CA:PublishCard with Play, GIF, Allow / Block. Only owner/approver (server-checked); agents never publish.
- Allow → published_version + status published + published card with the /g link; Block → blocked. Ledger publish.requested / approved / blocked.
- Published games: public play on /g/:slug, public leaderboard, Remix works, OG image uses the screenshot.

## 5. Quality

- Unit: scenario validation, auto-fix round limit, publish permissions (owner/approver/member/agent).
- Integration: playtest the 3 saved Phase 3 games (apps/server/.data/real-builds), no new builds → PASS or auto-fix → publish.
- e2e (FAKE): Test card PASS → Allow → /g/:slug plays the published version.
- Report: playtest time, first-try pass rate, auto-fix rounds.

## Done when

- Every build gets a sandboxed playtest with a GIF; failures auto-fix (max 2); only an approver's Allow publishes; the published game plays on /g/:slug with a screenshot preview; tests pass; STATUS.md updated; short report.
