# Design system

Poster-style arcade: black, one acid-lime accent, giant condensed type, hairlines. Flat and static
inside the app (no gradients or glows); the motion lives on the landing hero. **Desktop-first**
(judges and demos are on laptops); phones must work, not shine. Dark by default, light on request. The living
reference is the **`/dev/ui`** page (`apps/web/src/app/dev/ui/Gallery.tsx`); tokens live in
`apps/web/src/app/globals.css`.

## Brand

- **Name:** CrewArcade (one word, capital C and A). Tagline: _Your friends + 3 AI agents. One chat. A new game in minutes._
- **Logo:** a mark family (`components/brand/marks.tsx`), all flat brand + text colour on the background,
  so they follow the theme (lime site-wide, red on game pages):
  - **D-pad "+3"** (`DpadMark`): the main icon. A D-pad is a plus sign; three dots make it "+3" (your
    friends + 3 agents). Favicon (`app/icon.svg`), footer, `<LogoMark>`.
  - **Wordmark** "CREW▲RCADE" in Anton caps, the A of ARCADE a play triangle (`PlayA`). `<Logo>` = D-pad +
    wordmark, in every header; `public/logo.svg` is the same for use outside the app.
  - Signature marks, one idea each, placed where it lives: **Chat becomes play** (`ChatPlayMark`, How it
    works title), **Cursor party** (`CursorsMark`, the crew section), **Joystick A** (`JoystickMark`,
    Arcade header), **Insert crew** coin slot (`CoinMark`, the "Pitch your first game" panel).
    Files: `components/brand/Logo.tsx`, `components/brand/marks.tsx`, `app/icon.svg`, `public/logo.svg`.
- **Credit:** the landing shows "By Jatin · Nexconn Build Challenge 2026 · Built on the Nexconn Chat
  SDK" (hero bottom-left on desktop, under the header on phones) and the footer repeats it.
- **Voice:** short, warm, direct. Agents speak in first person and say what they will do next
  ("Plan's up. Vote, and an approver taps Approve."). No hype, no exclamation chains.

## Colour tokens

Components use Tailwind names generated from tokens (`bg-surface`, `text-dim`, `ring-pixel`…), never raw hex.

| Token        | Dark      | Light     | Use                           |
| ------------ | --------- | --------- | ----------------------------- |
| `bg`         | `#0a0a0a` | `#f5f5f0` | page                          |
| `surface`    | `#121212` | `#ffffff` | cards, sheets                 |
| `surface-2`  | `#1a1a1a` | `#ecece5` | inputs, secondary buttons     |
| `surface-3`  | `#242424` | `#e1e1d8` | hover                         |
| `border`     | `#2b2b2b` | `#d4d4ca` | hairlines                     |
| `text`       | `#f4f4ef` | `#0a0a0a` | body                          |
| `dim`        | `#a8a8a1` | `#4b4b46` | secondary text                |
| `faint`      | `#8f8f88` | `#5c5c56` | meta, placeholders (≥ 4.5:1)  |
| `brand`      | `#c5f82a` | `#4a7a0c` | primary actions, logo (lime)  |
| `brand-ink`  | `#0a0a0a` | `#ffffff` | text on `brand`               |
| `gold`       | `#ffd166` | `#865709` | owner, best score, highlights |
| **`pixel`**  | `#a78bfa` | `#6d28d9` | Pixel · Designer (violet)     |
| **`forge`**  | `#f5b83d` | `#9a4407` | Forge · Builder (amber)       |
| **`glitch`** | `#3dd6f5` | `#0b6377` | Glitch · Playtester (cyan)    |
| `success`    | `#34d399` | `#04694c` | PASS, Approve, Allow, online  |
| `danger`     | `#f87171` | `#b91c1c` | FAIL, Block, errors           |
| `warning`    | `#fbbf24` | `#9a4407` | away, budget                  |

Theme: **dark by default** whatever the OS says; the toggle stores `crewarcade:theme` and sets
`<html data-theme>` before paint. Any element with `data-theme` re-scopes the tokens for its subtree
(the landing sets `data-theme="dark"`, so it is always the black poster). Light values are darker
shades so text on surfaces keeps ≥ 4.5:1.

## Typography

- Poster (logo, page titles, landing headlines, big numbers): **Anton** caps (`font-poster`), via
  `next/font`; the WebGL headline loads the same font from `public/fonts/anton-latin-400.woff`.
  Latin only, so user content (game titles in Devanagari etc.) stays in `font-display`.
- Display (headings, card titles): **Space Grotesk** 500/700 (`font-display`), via `next/font`.
- Body: **Inter** (`font-sans`), system fallback. **16 px base on mobile** (inputs never below 16 px so
  iOS does not zoom). Scale: 12 meta · 14 card body · 16 body · 18 sheet title · 24/30 section · 36–60 hero.

## Layout

- **Primary target 360–430 px wide.** No horizontal scroll (an e2e test checks it). 16 px side gutter
  (`px-safe` adds safe-area insets), `pt-safe` / `pb-safe` for notches and home bars.
- **Touch targets ≥ 44 px** (`min-h-11`, `size-11`) for every button, chip and icon button.
- **Sticky composer** at the bottom of chat (`<Composer>`), with backdrop blur.
- **Bottom sheets** for actions and card details on phones (`<Sheet>`); the same component becomes a
  centred dialog from `sm` (640 px) up.
- **Desktop (≥ 1024 px):** three columns: crew list (280 px) | chat (fluid, max 760 px) | context
  panel (360 px: current game, ledger, leaderboard). Tablet: two columns, context panel as a sheet.
- Cards: radius 20 px (`rounded-card`), 1 px border, soft shadow; action rows stack full-width on phones.

## Avatars and identity

- **Agents:** image avatars (`/agents/pixel.svg`, `forge.svg`, `glitch.svg`) with a 2 px ring in their
  accent colour; the ring pulses while the agent is busy. Every agent message shows the agent name
  in its accent colour and an **AI-generated** badge.
- **Humans:** an emoji on a soft colour ring (violet, amber, cyan, pink, green, gold). Sign-up picks the
  ring at random; Settings changes it.
- **Sign-up (`/start`):** one calm screen, no steps. "What should your crew call you?" over a big Anton
  name field on a single underline (lime when focused), one row of 8 players (one preselected,
  "+16" shows the rest), "They reply in [language ▾]" picked from the browser (`detectLanguage`,
  `hi-IN` → Hindi, else English), one lime **Start playing →** button; Enter submits. No cards, glows
  or blur. Goal: a judge is inside in about 5 seconds.
- **Invite (`/i/<code>`):** same calm screen. "You're invited to" over the crew name as a giant Anton
  headline, an overlapping face pile (6 faces, "+N" for the rest) and the member line, then the
  same form (`QuickProfileForm`, smaller name) with **Join crew →**. Signed in: one "Join crew as 🐼
  Riya →" button; already a member: "Open the chat →". Dead or full invites show a plain poster
  title and one sentence.
- Presence dot: green online, amber away, grey offline.

## Components (apps/web/src/components/ui)

| Component       | Notes                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| `Button`        | `primary`, `approve`, `secondary`, `ghost`, `danger`; `sm/md/lg` all ≥ 44 px; `loading`, `icon`, `block` |
| `IconButton`    | requires `label` (accessible name + tooltip); `ghost`, `filled`, `brand`                                 |
| `Avatar`        | `kind="agent"` (agent, state, presence) or `kind="human"` (emoji, colour, name, presence)                |
| `Badge`         | tones; `RoleBadge` (Owner/Approver), `AiBadge`, `TranslatedBadge`                                        |
| `StateChip`     | agent state (idle, thinking, designing, building, checking, testing, fixing, waiting_approval, blocked)  |
| `Chip`          | selectable filter chip (`aria-pressed`)                                                                  |
| `CardShell`     | header (agent avatar, name, title, meta, badges), body, action row                                       |
| `Sheet`         | bottom sheet / dialog, Esc + backdrop close, focus in and back                                           |
| `ToastProvider` | `useToast()(text, 'info' \| 'success' \| 'danger')`, top of screen, `role=status`                        |
| `Skeleton`      | plus `MessageSkeleton` for timelines                                                                     |
| `EmptyState`    | emoji, title, text, action                                                                               |
| `ErrorState`    | `role=alert`, optional retry                                                                             |
| `Composer`      | attach, auto-growing textarea (Enter sends, Shift+Enter newline), mic ↔ send swap                        |

Chat pieces (Phase 2, `components/cards`, `components/agents`, `components/story`, `components/chat/Markdown`):

| Component          | Notes                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `CardMessage`      | one renderer per card type on `CardShell` (agent avatar + name + AI badge, status badge, action row)                                    |
| `PlanCard`         | plan at a glance, "Full plan" expander, checklist, 👍/👎 with optimistic counts (`animate-pop`), Approve (approvers only), Change sheet |
| `AgentStatusStrip` | top of every room: Pixel/Forge/Glitch chips ("thinking 4s", "testing 12/18"); tap → sheet with the last 5 ledger actions                |
| `StoryTimeline`    | the game's ledger as a vertical timeline, tokens/cost per agent step, Details expander, Export JSON                                     |
| `Markdown`         | safe subset (bold, italic, code, lists, headings, http links) as React elements; soft caret while streaming                             |

Game rooms open at `/crews/<id>/rooms/<channelId>`; room chips under the header switch between the
crew chat and each game room. Desktop shows the Story in the context panel; phones open it from 📜.

## Motion

Quick (150–250 ms) and purposeful, defined as Tailwind animations in `globals.css`:
`animate-slide-up` (cards and sheets arrive), `animate-fade-in` (backdrops), `animate-pop` (vote
counts), `animate-float-up` (Live Theater reactions); buttons scale to 0.97 on press. Play opens the
game full screen. **`prefers-reduced-motion`** collapses every animation and transition to 1 ms.

**Agents section** (`components/landing/AgentCards.tsx`): three liquid-glass cards (Apple Liquid Glass
feel) spanning almost the full width (section is full-bleed, cards up to 1720px, clipped only at the
screen edge) over a living backdrop: a giant lime "AGENTS" and drifting violet/amber/cyan glows,
edge-faded with a mask, so the glass has something to blur and bend. Layers per card: clear glass body
(light `backdrop-filter` blur + saturate), a masked 1.5px bright gradient rim, a top sheen, a specular
light and 3D tilt that follow the mouse. Tilt and moving light are mouse-only and off with reduced motion.

**How it works** (`components/landing/HowItWorks.tsx`): a camera tour, modelled on car/bike launch pages
(e.g. the Ducati Superleggera V4 Centenario site). Desktop (>= 1024 px): a 700vh runway with a sticky
stage; one hero object (a map of five glass cards, one per moment, laid out in a zig-zag and threaded by
a lime line) stays on screen while the camera moves and zooms into each moment (pitch, Pixel's plan, Forge's build, Glitch's PASS, Publish), resting on each one
before gliding on. Step text (number, who, giant Anton word, one line) drifts in with fade + un-blur on
the side away from the phone, alternating sides. The chat reacts as the camera arrives (Approved, build
bar fills, PASS stamps in, Published). A chapter ruler on the right (click to jump), a scroll cue, a
spotlight floor, no colour blobs. The intro shows the whole map tilted back like a table; each link of the thread (routed edge to edge
from the cards' measured boxes, never through a card, with handoff labels such as "Pixel → Forge") draws
while the camera travels it. Camera keyframes are measured from the real card positions; frames
are written straight to the DOM (no React render per scroll). Below 1024 px: the steps as a list and the
cards stacked, no camera.

**Built on Nexconn** (`components/landing/BuiltOnNexconn.tsx`, after How it works): the sponsor's five
pillars from SPEC §2 (agent identities, agent-to-agent handoffs, streamed + structured messages, human in
the loop, audit trail) as full-width editorial rows: number, Anton pillar name, how CrewArcade shows it,
and the Nexconn features as hairline tags; then "Also on Nexconn" (DMs, HQ voice, translation, webhooks,
metadata) and the challenge credit. Rows drift in (fade + un-blur) on scroll. Each How it works step
also carries "Nexconn · <pillar>" and its feature tags. **Only live features are listed** (no Live Build
Theater, no pre-messaging gate: not built / Pro plan only).

**Arcade** (`app/arcade/page.tsx`, `components/arcade/ArcadeGrid.tsx`): poster header (giant "THE ARCADE",
glass Newest/Top pill), a tilted lime tape marquee, then poster game cards: a cover in the game's two
colours (its screenshot, or its `GameScene`, which scrolls on hover), Anton title, plays / best /
crew tags. The first game is a full-row featured card; Top shows #ranks. Cards drift in on scroll, lift on
hover and reveal a lime Play pill. Error ("The Arcade is waking up") and empty states use the same poster
style. `useReveal` (`components/landing/useReveal.ts`) is shared with the landing. For local checks with
data, run the in-memory API: `pnpm --filter @crewarcade/server exec tsx scripts/local-stack.ts`.

**Game pages** (`/g/<slug>`, `components/game/GamePage.tsx`): the game's own world. Always dark, and the
accent (`--brand`, so buttons, logo, focus rings) is **the game's own colour** (`accentFor`: its first colour,
or the second if the first is too dark; ink black or white by luminance). Hero: a badge (emoji, version), the
giant Anton title, pitch, crew credit, Play now / Remix; then **the game's screen** in an arcade bezel: its
screenshot, or its `GameScene` in attract mode (wide 21:9 on desktop, 4:3 on phones) with a big play button
and a blinking "PRESS ▶ TO PLAY"; clicking the screen plays. Then the poster Leaderboard beside Versions,
Bug hunters, "How it was made" and Remixed as, and a closing panel in the game's colour. Test ids
(`game-page-play`, `draft-teaser`, `bug-hunters`) unchanged.

**Game thumbnails** (`components/arcade/GameScene.tsx`): when a game has no screenshot, its thumbnail is a
little game world in its two colours, seeded by its slug (skyline, tiled ground, obstacles, coins, the emoji
hero hopping, an arcade HUD with score / hi score / lives, CRT scanlines). Arcade cards scroll it on hover;
the game page runs it always. Reduced motion stops it.

**Main app screen** (`/crews`, three columns, liquid glass; design: the "CrewArcade main screen" canvas):

- **Launch pad** (`components/crews/LaunchPad.tsx`, the middle column on `/crews`): the three agent orbs
  bobbing, "START YOUR FIRST CREW" (or "PITCH YOUR NEXT GAME"), one-tap pitch ideas (each makes a solo crew
  and opens it with `@pixel <idea>` already in the composer via `?pitch=`; the user taps Send), Start a solo
  crew / Invite friends, and "See how it works". **How it works** (`components/crews/HowItWorks.tsx`) is a
  3-step dialog opened once per browser on the launch pad (`crewarcade:howto-done`), not a sidebar card.
- **Crew cards** (`components/crews/CrewList.tsx`): a `GameScene` header in the crew's palette
  (`lib/palette.ts`; scrolls while an agent works), Anton name, "Forge is building…" or the last message,
  unread badge; the active crew has a lime ring. On phones the empty state keeps its buttons; wider
  screens show a quiet hint (the launch pad has the buttons).
- **Chat cards** (`CardShell`): solid `surface`, 1 px border, no glow or blur; a 3 px bar in the
  agent's colour on top (or a `GameScene` cover in the game's palette: plan, game room, live publish),
  agent name in small caps + AI badge, big Anton title. Up to 36rem wide in chat. Plan: the pitch as
  the lead line, Controls / Play as two `CardFact` tiles, Glitch's checks in a `CheckList` (code font,
  square marks that become ✓ / ✕ on the Test card). Build: a Forge progress bar of steps over the step
  list. Handoff is a slim baton row (Pixel ▸ Forge, task, status), not a full card. No emoji in titles
  (score cards keep 🏆 / 🔥). **Composer**: quick-start chips (`@pixel`, `remix`, `bug:`, `make it
harder`) while the box is empty and no starter pitch is offered.
- **New crew chat:** while a crew has no games, the top of its history is `CrewWelcome` (`components/chat/`):
  the crew name as a poster, an invite card (link, Copy link, Share on WhatsApp) and three pitch cards that
  put `@pixel <idea>` in the composer. The header shows the crew name in Anton and an "Invite friends"
  button; the agent strip is hidden on desktop (Crew HQ shows the agents). Agent messages get a soft edge
  and tint in the agent's colour. The starter suggestion and quick chips share one row.
- **Crew HQ** (`components/shell/ContextPanel.tsx`, right column): the three agents, the working one lit
  in its colour; in a game room "Now making" (a `GameScene` of the game, title, status) and Story /
  Scores / Agents tabs. Outside a game room it adds **Your crew**: the humans with online dots, empty seats
  while the crew is small, and the invite code with an Invite button.

**Agent avatars** (`public/agents/*.svg`, used app-wide and as the Nexconn avatars): glossy orbs in the
agent colour with a dark visor and glowing lime eyes; Pixel has a pixel sparkle, Forge a hard-hat band,
Glitch a magnifier eye and bug antennae.

**Landing hero** (`components/landing/GlassHero.tsx` + `HeroScene.tsx`): React Three Fiber scene
with the headline as WebGL text and a glass game controller in front, refracting it. The controller
is modelled in code (`GlassController.tsx`: extruded bevelled body, sticks, D-pad, bumpers; no brand
marks, no downloaded model); every part in `MeshTransmissionMaterial` sharing ONE refraction buffer
(separate passes drew black streaks), face buttons faintly tinted lime, Pixel violet, Glitch cyan and
Forge amber; light-panel studio with thin lime strips, no HDR download. Pose and size follow the
reference shot: ~46% of the width, seen slightly from above, over the headline's second line. It floats, tilts toward the pointer, and turns and zooms
over a 170vh sticky scroll runway; a lime tape (`animate-marquee`) slides across the corner. three.js
loads on demand wherever WebGL2 works (lower glass quality under 768 px); without WebGL2 the HTML
headline stays. Reduced motion renders one still frame. Rendering pauses while the hero is off screen.

## Accessibility

Semantic headings and landmarks, visible focus ring (brand colour), icon buttons always labelled,
live regions for agent state and toasts, colour is never the only signal (PASS/FAIL also in text),
contrast ≥ 4.5:1 for text in both themes.
