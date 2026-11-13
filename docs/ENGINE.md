# Game engine contract

`packages/engine` is the single source of truth for what a CrewArcade game is and how it is tested.
Forge writes games against this contract, Glitch tests them with it, and the web player embeds them.

## Game rules

1. **One self-contained `index.html`.** No network requests and no external assets: no CDN scripts,
   web fonts, images, `fetch`, XHR, WebSocket, EventSource, workers, `sendBeacon`, `<link>` resources,
   iframes or CSS `url()`s to other origins. Art is canvas shapes, gradients and emoji; sound is WebAudio.
   The **only** message that leaves the page is the score hook (`window.parent.postMessage`), which is
   not network access.
2. **Under 150 KB.**
3. **60 fps.** The playtester measures frame rate with the CPU throttled 4× (a mid-range phone) and
   fails below 30 fps.
4. **Title screen, game over and restart** (Space, Enter or tap).
5. **Keyboard and touch.** The starter draws on-screen buttons from `Game.touch`.
6. **Original games only.** No existing game names, characters, art, music or level designs.
   "Like Flappy Bird" becomes an original twist with its own name and theme.
7. Start from the starter (or the previous version) and change **only** the region between
   `// === GAME START ===` and `// === GAME END ===`. Keep the engine working: loop, input, scenes,
   HUD, juice, `window.__crew`, the score hook. Use particles, shake, tweens and beeps so it feels good.

`checkHtml()` enforces rules 1, 2 and 7 statically (plus a `<canvas>`, inline scripts only, valid
JavaScript); `playtest()` enforces the rest by playing.

## The starter (`packages/engine/starter/index.html`)

A fixed-timestep (60 Hz) canvas engine. Globals available to the GAME region:
`view {w,h}`, `PAL`, `rand()`, `randRange(a,b)`, `randInt(a,b)`, `pick(arr)` (seeded: use these for
gameplay; cosmetics may use `Math.random()`), `clamp`, `lerp`, `keyDown(code)`, `keyPressed(code)`,
`addScore(n)`, `gameOver()`, `runTime`, `burst(x,y,opts)`, `shake(px)`, `tween(obj,props,sec,ease,done)`,
`popText(str,x,y,color)`, `beep(freq,ms,type,vol,slideTo)`, `roundRect(ctx,x,y,w,h,r)`,
`text(str,x,y,size,color,align,weight)`. Key names are `KeyboardEvent.code` values (`ArrowLeft`,
`Space`, `KeyA`, `Enter`); `Tap` is a screen tap. `M` toggles mute.

The GAME region defines:

```js
const Game = {
  title, pitch, help,            // shown on the title screen
  controls: ['ArrowLeft', 'ArrowRight'],   // keys the game uses (the playtester presses each)
  touch: [{ key: 'ArrowLeft', label: '◀', side: 'left' }, …],
  init() {},        // reset all run state (boot, start, reset)
  update(dt) {},    // only while playing, dt = 1/60; call addScore(n) and gameOver()
  draw(ctx) {},     // world in CSS pixels; the engine draws HUD and overlays
  state() { return { playerX, enemies, speed }; },   // game-specific test fields
  resize() {},      // optional
};
```

## `window.__crew` test hook

The starter wires it; games extend it through `Game.state()` and never remove it.

| Member     | Meaning                                                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state()`  | Plain JSON: `scene` (`'title'` \| `'playing'` \| `'over'`), `score`, `best`, `time` (seconds in this run), `frame`, plus every `Game.state()` field. |
| `start()`  | Go from title (or over) straight to playing. Returns `state()`.                                                                                      |
| `reset()`  | Back to the title screen with run state cleared. Returns `state()`.                                                                                  |
| `seed(n)`  | Makes `rand()` deterministic. Call before `start()`.                                                                                                 |
| `controls` | Array of the key names the game uses.                                                                                                                |

## Score hook (host messages)

The engine tells the page that embeds it (the CrewArcade player iframe) about runs:

```js
window.parent.postMessage({ type: 'crewarcade:start' }, '*'); // startRun()
window.parent.postMessage({ type: 'crewarcade:score', score, best, time }, '*'); // gameOver(); time in seconds
```

Outside an iframe the parent is the page itself, which is harmless. The player must accept these
only from the game iframe's `contentWindow`, validate the shape with zod, and treat the score as a
claim (the server applies plausibility limits before it reaches a leaderboard). `checkHtml()`
requires both messages in the file; `playtest()` checks that `crewarcade:start` fires after
`start()` and that `crewarcade:score` carries the final `state().score` after game over.

## GAME_SPEC (the plan)

Pixel writes a `GameSpec` (`GameSpecSchema` in `src/spec.ts`), humans approve it, and it is stored as
JSON in `game_versions.spec`. `specToMarkdown()` renders it for cards and prompts.

```json
{
  "title": "Moon Mango Mayhem",
  "slug": "moon-mango-mayhem",
  "pitch": "A jetpack monkey dodges falling mangoes on the moon.",
  "credits": ["Asha", "Ravi"],
  "remixOf": "other-game-slug",
  "approvedBy": ["Asha"],
  "controls": { "keyboard": "Space to boost", "touch": "Tap to boost" },
  "coreLoop": "…",
  "winLose": "…",
  "scoring": "…",
  "lookAndFeel": "…",
  "sound": "…",
  "acceptance": [{ "id": "A1", "text": "Score increases while playing (state().score)." }],
  "changes": [{ "version": 2, "askedBy": ["Ravi"], "hotfix": false, "summary": "…", "acceptance": [{ "id": "A7", "text": "…" }] }]
}
```

- `slug`: kebab-case, 3–30 chars of `a-z 0-9 -` (`SLUG_RE`, `slugify()`).
- `acceptance`: **4–8 items**, each one checkable through `window.__crew` and naming the field it reads.
- Each later version adds a `changes` block with its own new acceptance items;
  `acceptanceFor(spec, n)` is everything version `n` must meet.

## Scenario format (the playtest steps)

Glitch writes one scenario per version (`ScenarioSchema`, stored in `game_versions.scenario`): an
array of steps run in order on a **fresh page** with seed 42 and a **paused fake clock**, so the same
steps always give the same result and a 60 s game plays in a few seconds.

| Step                                                       | Effect                                                                |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| `{"seed": 7}`                                              | `__crew.seed(7)`                                                      |
| `{"call": "start"}` / `{"call": "reset"}`                  | `__crew.start()` / `__crew.reset()`                                   |
| `{"press": "ArrowLeft", "ms": 500}`                        | hold a key for that much game time (default 100 ms)                   |
| `{"wait": 2000}`                                           | advance game time                                                     |
| `{"mark": "a"}`                                            | save `state()` as `marks.a`                                           |
| `{"log": "t1"}`                                            | print the state (exploring only, never a check)                       |
| `{"expect": "<JS expression>", "label": "A1 score rises"}` | a check; sees `state` (now), `start` (state at page load) and `marks` |

Write **one labelled expect per acceptance item**, e.g.
`[{"call":"start"},{"mark":"a"},{"wait":3000},{"expect":"state.score > marks.a.score","label":"A1 score rises"}]`.
Probe a game's numbers with `log` steps in a throwaway scenario run in `only` mode; never ship probes.

## Bug repro format

A player's bug report becomes a repro: steps that recreate the bug, then **one expect for the correct
behaviour** labelled `BUG <k>: …` (stored in `bugs.repro_scenario`; on disk `v<N>/repro-<k>.json`).

```json
[
  { "seed": 42 },
  { "call": "start" },
  { "press": "ArrowRight", "ms": 30000 },
  { "expect": "state.scene === 'over'", "label": "BUG 1: hugging the right wall should not dodge every snowman" }
]
```

Run it alone (`only` mode): **FAIL = reproduced**. The clipper films the BUG check (red banner = bug on
camera). A hotfix version's notes start with `- hotfix: <bug> (bug hunter: <name>)` (`readHotfix()`).

## Regression rules

Every full playtest of version N also runs:

- **every saved repro of versions 1..N: hard** (must pass: a fixed bug stays fixed);
- **earlier versions' scenarios: advisory** (reported, never failing: a changes block may alter old
  behaviour on purpose). For a **hotfix** the server passes them as hard checks instead.

## What `playtest()` checks

Static check · `__crew` hook complete · loads without console errors, exceptions or off-origin
requests · starts on the title screen · FPS ≥ 30 at 4× CPU throttle · `start()` → playing · score hook
`crewarcade:start` · canvas changes within 1 s · every control key changes state or picture · the
acceptance scenario · every repro · mid-game screenshot · 20 s of seeded random input without
exceptions (5 s in the `fast` profile) · game over reachable within 60 s with no input (or covered by
the scenario) · score hook `crewarcade:score` matches the final score · restart from game over ·
`reset()` → title · advisory replays. Real-time budget 85 s; a page that freezes the fake clock fails
instead of hanging.

## Library API (`@crewarcade/engine`)

```ts
checkHtml(html) → { pass, problems[], sizeBytes }
playtest({ html, scenario, scenarioError?, repros?, previous?, only?, profile?, budgetMs?, browser? })
  → { pass, checks[{name, pass, detail, kind, advisory?}], failed[], expects[{label, pass, scenario}],
      fps, controls, seconds, logs[], screenshot: Buffer|null (PNG), summary }
clip({ kind: 'clip', title, game }) | ({ kind: 'repro', title, game, repro }) | ({ kind: 'fix', title, before, after, repro })
  → { gif: Buffer, width, height, frames, seconds, speed, sides[{version, ok}], checkLabel?, summary }
GameSpecSchema, acceptanceFor, specToMarkdown, parseScenario, ScenarioSchema, bugStepIndex,
starterHtml, replaceGameRegion, gameRegion, nextVersion, readHotfix, slugify, isSlug,
loadVersion / readScenarioFile / findRepro / createVersion (on-disk layout, CLIs and fixtures)
```

GIFs: canvas only, 480×270 per side (fix clips are two sides), one frame per 80 ms of game time,
time-lapsed to stay ≤ 10 s, ≤ 5 MB, `Math.random` seeded so the same run gives the same bytes.

## CLIs and eval

```bash
pnpm --filter @crewarcade/engine check <file.html> | <slug> <N>
pnpm --filter @crewarcade/engine playtest <slug> <N> [--only repro-1.json] [--fast] [--out <dir>]
pnpm --filter @crewarcade/engine clip <slug> <N> [--repro repro-1.json [--vs <M>]] [--title <t>] [--out <file.gif>]
pnpm --filter @crewarcade/engine new-version <slug> [--from <other-slug>]
pnpm --filter @crewarcade/engine eval [--fast] [--only <slug>] [--kind <kind>] [--jobs N] [--strict] [--doc]
```

CLIs default to `--games packages/engine/fixtures/games`. The **eval** plants one bug of each kind
(`collision-disabled`, `score-frozen`, `gameover-unreachable`, `control-ignored`, `console-error`,
`fps-killer`, `restart-broken`) into each fixture's latest version (`eval/mutants/<slug>.ts`) and
counts how many the playtester catches; clean fixtures must pass. `--doc` writes `eval/RESULTS.md`.

Fixtures (`fixtures/games/`) are **test fixtures only**: never shown in the Arcade, never presented as
games made in CrewArcade.
