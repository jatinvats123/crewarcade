# Design system

Playful arcade energy, clean and readable. Mobile-first, dark-first, with a light mode. The living
reference is the **`/dev/ui`** page (`apps/web/src/app/dev/ui/Gallery.tsx`); tokens live in
`apps/web/src/app/globals.css`.

## Brand

- **Name:** CrewArcade (one word, capital C and A). Tagline: _Your friends + 3 AI agents. One chat. A new game in minutes._
- **Logo:** an arcade-button mark (rounded magenta square with three dots in the agent colours:
  violet, amber, cyan) and the wordmark "Crew**Arcade**" with "Arcade" in brand magenta.
  Files: `apps/web/public/logo.svg` (wordmark), `apps/web/src/app/icon.svg` (favicon),
  `components/brand/Logo.tsx` (`<Logo>`, `<LogoMark>`, theme-aware).
- **Voice:** short, warm, direct. Agents speak in first person and say what they will do next
  ("Plan's up. Vote, and an approver taps Approve."). No hype, no exclamation chains.

## Colour tokens

Components use Tailwind names generated from tokens (`bg-surface`, `text-dim`, `ring-pixel`…), never raw hex.

| Token        | Dark      | Light     | Use                           |
| ------------ | --------- | --------- | ----------------------------- |
| `bg`         | `#0b0a16` | `#faf8ff` | page                          |
| `surface`    | `#15132a` | `#ffffff` | cards, sheets                 |
| `surface-2`  | `#1e1b3a` | `#f1eefb` | inputs, secondary buttons     |
| `surface-3`  | `#28244b` | `#e6e1f7` | hover                         |
| `border`     | `#2e2a55` | `#ddd7f0` | hairlines                     |
| `text`       | `#f4f1ff` | `#17142b` | body                          |
| `dim`        | `#a39dcc` | `#5e5880` | secondary text                |
| `faint`      | `#6f6a99` | `#8f89ad` | meta, placeholders            |
| `brand`      | `#ff4d8d` | `#e11d74` | primary actions, logo         |
| `gold`       | `#ffd166` | `#b7791f` | owner, best score, highlights |
| **`pixel`**  | `#a78bfa` | `#7c3aed` | Pixel · Designer (violet)     |
| **`forge`**  | `#f5b83d` | `#b45309` | Forge · Builder (amber)       |
| **`glitch`** | `#3dd6f5` | `#0e7490` | Glitch · Playtester (cyan)    |
| `success`    | `#34d399` | `#059669` | PASS, Approve, Allow, online  |
| `danger`     | `#f87171` | `#dc2626` | FAIL, Block, errors           |
| `warning`    | `#fbbf24` | `#b45309` | away, budget                  |

Theme: follows `prefers-color-scheme`; the toggle stores `crewarcade:theme` and sets
`<html data-theme>` before paint. Light values are darker accent shades so text on surfaces keeps ≥ 4.5:1.

## Typography

- Display (headings, logo, card titles): **Space Grotesk** 500/700 (`font-display`), via `next/font`.
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
- **Humans:** an emoji on a soft colour ring (violet, amber, cyan, pink, green, gold) picked at signup.
- Presence dot: green online, amber away, grey offline.

## Components (apps/web/src/components/ui)

| Component       | Notes                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| `Button`        | `primary`, `approve`, `secondary`, `ghost`, `danger`; `sm/md/lg` all ≥ 44 px; `loading`, `icon`, `block` |
| `IconButton`    | requires `label` (accessible name + tooltip); `ghost`, `filled`, `brand`                                 |
| `Avatar`        | `kind="agent"` (agent, state, presence) or `kind="human"` (emoji, colour, name, presence)                |
| `Badge`         | tones; `RoleBadge` (Owner/Approver), `AiBadge`, `TranslatedBadge`                                        |
| `StateChip`     | agent state (idle, thinking, planning, building, testing, reproducing, waiting, blocked, error)          |
| `Chip`          | selectable filter chip (`aria-pressed`)                                                                  |
| `CardShell`     | header (agent avatar, name, title, meta, badges), body, action row                                       |
| `Sheet`         | bottom sheet / dialog, Esc + backdrop close, focus in and back                                           |
| `ToastProvider` | `useToast()(text, 'info' \| 'success' \| 'danger')`, top of screen, `role=status`                        |
| `Skeleton`      | plus `MessageSkeleton` for timelines                                                                     |
| `EmptyState`    | emoji, title, text, action                                                                               |
| `ErrorState`    | `role=alert`, optional retry                                                                             |
| `Composer`      | attach, auto-growing textarea (Enter sends, Shift+Enter newline), mic ↔ send swap                        |

## Motion

Quick (150–250 ms) and purposeful, defined as Tailwind animations in `globals.css`:
`animate-slide-up` (cards and sheets arrive), `animate-fade-in` (backdrops), `animate-pop` (vote
counts), `animate-float-up` (Live Theater reactions); buttons scale to 0.97 on press. Play opens the
game full screen. **`prefers-reduced-motion`** collapses every animation and transition to 1 ms.

## Accessibility

Semantic headings and landmarks, visible focus ring (brand colour), icon buttons always labelled,
live regions for agent state and toasts, colour is never the only signal (PASS/FAIL also in text),
contrast ≥ 4.5:1 for text in both themes.
