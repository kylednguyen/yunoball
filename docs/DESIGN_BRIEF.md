# YunoBall — Design Brief

> The design language: principles, tokens, and component rules.
> Runtime source of truth: `apps/web/app/globals.css` (tokens) and
> `apps/web/app/lib/teamTheme.ts` (team theming).

## 1. Personality & principles

**Quiet, dense, authoritative.** A dark, StatMuse-inspired stats surface that
feels like a professional tool, not a fan site — until a team enters the
frame, at which point the interface takes on that team's colors.

1. **Content over chrome.** Hierarchy comes from spacing, background
   contrast, and typography — not borders. Borders are rare by design
   (`--border` is a 5% white whisper).
2. **Neutral dominates; accent is earned.** The lime brand accent appears
   only where it means something: search, selection, CTAs, links, positive
   metrics. Everything else stays neutral.
3. **Team color is context, not decoration.** When the active context is one
   team (team page, player profile, single-team answer), the accent family
   re-tints to that team's branding. Backgrounds and neutrals never recolor.
4. **Dense but legible.** Stat tables are the product. Small type sizes
   (a 12–17px text ramp) with strict contrast floors, not big type with thin
   data.
5. **Honest states.** Skeletons while loading, plain-language refusals,
   coverage stated beside every mined claim. The UI never pretends to know
   something.

## 2. Color system

### Neutral ramp (surfaces — depth = background contrast, not lines)
A cool-slate ramp carrying a touch of chroma, so the darks read rich rather
than flat grey.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0a0c11` | page background |
| `--panel` | `#13161e` | primary surface |
| `--elevated` | `#1b1f29` | raised surface (popovers, hovers) |
| `--bg-soft` | `#222835` | inset wells, chips, buttons |
| `--bg-hover` | `#2b3240` | hover tier for soft surfaces |
| `--bg-scrim` | `rgba(10,12,17,0.85)` | translucent bg behind the blurred nav/search bars |
| `--border` / `--border-strong` | 5% / 10% white | the few places that need a line |

### Ink
`--text #f5f5f5` · `--muted #f2f2f4` · `--faint #e7e7ec`. The ramp is
deliberately near-white top to bottom: hierarchy is carried by weight and a
slight step-down, not by dimming secondary text to grey — which also means
every tier clears 4.5:1 on every surface *including* the hover tier.

### Brand accent (lime, used sparingly)
`--accent #89f336` with a full derived family: `--accent-hover #9ff955`,
`--accent-soft` (16% fill), `--accent-contrast #101c03` (near-black ink on
solid accent), `--accent-ink #9df84f` (accent-colored *text* on dark needs the
lighter tone; solid accent *fills* use `--accent` itself), `--accent-border`
(42%). `--accent-deep` aliases `--accent` at brand level and exists so team
themes have a handle to override. `--chart` mirrors `--accent`.

### Semantic
`--success #4ade80` (+ `--success-soft`) · `--danger #f87171` (+
`--danger-soft`, `--danger-text #fca5a5` for ink on the soft fill). There is no
warning tier.

## 3. Team theming (`teamTheme.ts`)

The signature move. `teamTheme(teamId)` returns CSS-variable overrides scoped
to a container — spreading it re-tints **only the accent family** to the
team's primary color:

- `--accent`, `--accent-deep` and `--chart` ← the team primary, **unmodified**
  — no lightening, darkening or muting. The primary drives solid surfaces.
- `--accent-hover`, `--accent-ink` and `--chart-strong` ← the team's *brand
  ink*: `readableInk()` picks the most vivid palette color (chroma ≥ 0.25)
  that clears 3.4:1 on the dark canvas, else the first that clears 3.2:1, else
  the primary. Picking a real palette color rather than a lightened primary is
  what makes the theme show Seahawks green and Commanders gold instead of a
  washed-out tint.
- `--accent-soft` → `var(--elevated)` and `--accent-border` → `var(--border)`:
  deliberately **not** tinted. A low-opacity team color over the dark canvas
  goes muddy, so soft surfaces stay a clean neutral and the brand shows in the
  text and the solid fills.
- `--accent-contrast` (ink on solid team surfaces) is **contrast-checked**:
  the first of the team's secondary then accent color that is near-neutral
  (chroma ≤ 0.2) *and* clears WCAG 4.5:1 against the primary; otherwise fall
  back to near-black `#0c0d0f` or white, whichever the primary carries. Strong
  second hues (navy + gold) are excluded on purpose — colored ink on a colored
  card reads badly — so player cards render as solid team color with
  guaranteed-readable ink.
- All 32 team palettes (primary/secondary/accent) live in `NFL_TEAM_COLORS`,
  which also backs `NFL_TEAM_NAMES` so names and colors can't drift apart.

Rules: only accent-driven UI changes (buttons, active tabs, links, chart
marks, stat highlights). Never re-tint backgrounds, neutrals, or semantic
colors. Unknown team → `teamTheme()` returns `undefined`, no override (the
lime brand accent stays).

## 4. Typography

- **One face:** Geist Variable (one bundled woff2 at
  `public/fonts/Geist-Variable.woff2`, weights 100–900, `font-display: swap`,
  no runtime font request). System-stack fallback. `--display` aliases
  `--font` — the same face carries everything from navigation copy through
  display metrics.
- **Text scale:** caption 12 / small 13 / body 14 / ui 15 / body-lg 16 /
  lead 17, plus `--fs-micro` 10 for status glyphs and sort arrows.
- **Heading tiers,** consolidated from the old 18–32px strays: h5 18 / h4 20 /
  h3 22 / h2 `clamp(24px, 4.2vw, 28px)` / h1 `clamp(26px, 5vw, 32px)` /
  `--fs-hero` `clamp(38px, 4.6vw, 48px)`. A few page-defining headlines
  (the answer line, entity titles, focused result heads) still clamp
  per-context.
- Numbers-first design: stat cells carry `font-variant-numeric: tabular-nums`
  so columns don't jitter between rows; narration reads at body sizes.

## 5. Space, shape, elevation, motion

- **Spacing:** 4px base scale, `--s-1: 4px` … `--s-10: 40px` — steps 1–6, then
  8 and 10. The scale stops at 40px; larger gaps are page-level padding, set
  per-layout.
- **Radii:** `--r-sm` 6 / `--r-md` 8 / `--r-lg` 12 / `--r-xl` 14 / `--r-2xl`
  16 / `--r-pill` 999px. There is no single default: shared surfaces take
  `--r-lg`, cards `--r-xl`, and `--r-2xl` is reserved for the hero search
  family (input + suggest popover) so nothing else drifts that large.
- **Elevation:** flat by philosophy — two shadows only, `--shadow-card` (a 1px
  hairline lift) and `--shadow-pop` (two-layer, for the mobile drawer and
  popovers); borders and background steps do the rest.
- **Z-scale:** one documented ladder — sticky(1) < nav(10) < popover(40) <
  skip-link(100). Overlays render in-flow; no portals — each popover's parent
  stacks above table headers. On mobile the nav outranks `--z-pop` so its
  drawer and scrim clear any open dropdown behind them.
- **Motion:** `--ease: cubic-bezier(0.2, 0.8, 0.2, 1)`; `--dur` 160ms base and
  `--dur-slow` 240ms slow — no separate fast tier. Comparison bars animate
  their width at `--dur`; the shimmer sweep runs 1.3s. Motion supports
  comprehension, never decoration, and `prefers-reduced-motion` collapses all
  of it (infinite loops *stop* rather than spinning at 0.001ms).

## 6. Component inventory (`apps/web/app/components/`)

| Component | Role |
|---|---|
| `AnswerCard` | The flagship: narration, entity chips, player card(s), mirrored-bar comparison chart, sortable table, drill-down |
| `SinglePlayerResult` / `PlayerComparisonResult` | Answer layouts per intent shape (`player_total`, `compare`) |
| `ResultDrilldown` | Leaderboard answers: the leader (or tied leaders) as a team-colored card, then the ranked table |
| `SortTable` | Dense sortable stat table; horizontal containment on mobile |
| `SearchSuggest` | Debounced ARIA combobox: questions, teams, players — teams and players jump straight to their pages, anything else runs as a question |
| `FactOfTheDay` | The day's mined fact plus its provenance (occurrence count, coverage floor); archive at `/facts` |
| `ScoreTicker` / `GameCard` / `Performers` / `HomeDashboard` | Home/dashboard surfaces |
| `Surface` / `PageHeader` / `SectionHeader` / `EntityHero` / `InfoGrid` / `StatSummary` (ui.tsx) | The shared page-scaffolding primitives every route builds from |
| `Headshot` / `TeamLogo` / `Badge` (ui.tsx) | Identity primitives |
| `Nav` / `Crumbs` / `Dropdown` / `tablist` | Chrome & controls |
| `Skeleton` | Shimmer loading states |

The share affordance lives on the result-page shell
(`app/a/[id]/ResultExperience.tsx`), not inside `AnswerCard` — the card
renders an answer wherever it's mounted and owns no routing.

## 7. Data-visualization rules

- The mirrored-bar comparison chart is currently the *only* chart. The
  leading bar takes `--accent` (team-tinted in team context), the trailing bar
  `--border-strong`; widths animate at `--dur`.
- `--chart` / `--chart-strong` are declared and team-tinted but nothing
  consumes them yet — they are the reserved handle for real chart marks, so
  future viz doesn't reach for raw `--accent`.
- Tables are the primary viz: every bar has its number beside it (each row is
  value | bar | label | bar | value). The chart sizes off a container query,
  not the viewport, so it renders the same in the main column and on the
  share page; under 560px the label takes its own line and the bars keep
  their length.

## 8. Accessibility bars

- Text contrast ≥ 4.5:1 on **every** surface tier it can sit on. The near-white
  ink ramp is what buys this: because no tier dims to grey, `--faint` clears
  the bar even on `--bg-hover`, the brightest surface.
- Team-tinted ink is programmatically contrast-checked (WCAG relative
  luminance) before use; falls back to black/white.
- Links inside running text are underlined — color alone is not a cue
  (WCAG 1.4.1). Standalone links (nav, cards, rows) identify themselves by
  position instead, so they stay clean.
- Visible 2px accent `:focus-visible` outlines at 2px offset, never removed
  without replacement; skip-link at the top of the z-scale; the mobile nav
  toggle keeps a full 44px hit area; `color-scheme: dark` declared for native
  form rendering.
