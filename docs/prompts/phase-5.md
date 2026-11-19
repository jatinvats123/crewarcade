You are continuing CrewArcade. This is Phase 5: players report bugs, Glitch reproduces them on camera, Forge ships a hotfix; plus voice pitches and tap-to-translate. Build only this phase. Stop with a short report.

## How to work

Same rules as Phase 4 (read CLAUDE.md + STATUS.md; only needed doc sections; plan max 15 lines and wait for OK; run only touched tests while building, full suite once at the end; 2–3 line STATUS note per section). Branch phase-5 from phase-4. Keep outputs short; don't rebuild the web app for e2e until the end. Reuse existing pieces (engine repro format + clip({kind:'fix'}), Phase 4 playtest worker, publish gate, voice notes in the composer).

## 1. Bug report → repro

- [Report a bug] in the player and `bug: …` in chat (router already detects it). Optional phone screenshot → private `uploads` bucket. CA:BugCard in the game room.
- Glitch reads the description (+ screenshot, vision, cheap model), writes a repro scenario (docs/ENGINE.md "Bug repro format"), runs it on the current version: FAIL = reproduced → BugCard updated with the repro GIF; PASS = not reproduced → Glitch asks one follow-up question. Ledger bug.reported / bug.reproduced.

## 2. Hotfix

- Reproduced bug → Forge builds a hotfix version (notes: "hotfix: <bug> (bug hunter: <name>)").
- Glitch replays this repro + all older repros (hard) + earlier versions' scenarios (advisory), then posts a hotfix card with the side-by-side GIF (old fails, new passes). Max 2 automatic rounds.
- Publishing the hotfix uses the Phase 4 Allow gate. The bug hunter is credited on /g/:slug.

## 3. Voice pitches

- A voice note to an agent (existing hold-to-record) → server transcribes with Sarvam (`saaras`, `mode=codemix`, ≤ 30 s) → routed exactly like the text message. If Sarvam fails or the key is missing: a friendly "type it instead" line.

## 4. Translation (tap only)

- [Translate] on a message → Nexconn built-in translation into the user's language. No auto-translate (it is billed per character). Per-user daily cap (`LIMITS.dailyTranslationChars`), tracked in `usage`; over the cap → a friendly message.

## 5. Quality (only these)

- Unit: repro result mapping (FAIL = reproduced / PASS = not), hotfix "all old repros must pass" rule, translation cap, voice-transcription failure fallback.
- Integration: one planted bug (reuse an eval mutant, no new Forge build for the original) → report → reproduced → hotfix → repro passes.
- e2e (FAKE): bug report → BugCard → hotfix card appears.
- No cost/accuracy measuring scripts, no multi-language e2e, no vision eval.

## Done when

- A bug report gets reproduced on camera (or a follow-up question), a hotfix passes every old repro and goes through Allow, voice pitches work in Hindi/Hinglish, tap-to-translate works within the cap; tests pass; STATUS.md updated; short report.
