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
   (10–17px text scale) with strict contrast floors, not big type with thin
   data.
5. **Honest states.** Skeletons while loading, plain-language refusals,
   visible interpretations. The UI never pretends to know something.

## 2. Color system

### Neutral ramp (surfaces — depth = background contrast, not lines)
A cool-slate ramp with a touch of chroma, so the darks read rich, not flat grey.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0a0c11` | page background |
| `--panel` | `#13161e` | primary surface |
| `--elevated` | `#1b1f29` | raised surface (popovers, hovers) |
| `--bg-soft` | `#222835` | secondary surface (inset wells, chips) |
| `--bg-hover` | `#2b3240` | hover tier for soft surfaces |
| `--border` / `--border-strong` | 5% / 10% white | the few places that need a line |

Two derived surfaces hang off the ramp: `--bg-scrim` (85% `--bg`, for blurred
bars) and `--shimmer` (7% white, the skeleton sweep highlight).

### Ink
`--text #f5f5f5` · `--muted #f2f2f4` · `--faint #e7e7ec`. All three tiers are
near-whites: hierarchy is carried by **weight** and a slight step-down, never by
dimming to grey — which is also why every tier clears 4.5:1 on every surface
*including* the hover tier.

### Brand accent (lime, used sparingly)
`--accent #89f336` with a derived family: `--accent-hover #9ff955`,
`--accent-soft` (16% fill), `--accent-contrast #101c03` (ink on solid accent),
`--accent-ink #9df84f` (accent-colored *text* needs the lighter tone),
`--accent-border` (42%), `--accent-deep` (an alias of `--accent` at rest;
`teamTheme` re-points it).

`--chart` is declared alongside them (and `teamTheme` also emits
`--chart-strong`), but **no component reads either token today** — data marks
currently paint with `--accent` and `--border-strong`. Treat the chart tokens as
a reserved slot, not a rule the CSS enforces.

### Semantic
A deliberately small family: `--success #4ade80` / `--success-soft` ·
`--danger #f87171` / `--danger-soft` / `--danger-text #fca5a5`. There is **no
`--warning`** token and no semantic border tier — warnings and cautions have not
needed their own color yet.

## 3. Team theming (`teamTheme.ts`)

The signature move. `teamTheme(teamId)` returns CSS-variable overrides scoped
to a container — spreading it re-tints **only the accent family** to the
team's primary color:

- `--accent` and `--accent-deep` ← the team's primary, straight from the
  palette. No lightening, no muting.
- `--accent-hover` and `--accent-ink` ← the team's *readable ink*: the first
  of primary → secondary → accent that is vivid (chroma ≥ 0.25) and clears
  3.4:1 on the dark canvas, so the theme shows a real brand color instead of a
  washed-out primary. Failing that, the first candidate clearing 3.2:1.
- `--accent-soft` → `var(--elevated)` and `--accent-border` → `var(--border)`.
  Soft surfaces stay a clean neutral on purpose: a low-opacity team color over
  the dark canvas goes muddy. The brand shows in the text, not the tint.
- `--chart`/`--chart-strong` are emitted too, but nothing consumes them yet.
- `--accent-contrast` (ink on solid team surfaces) is **contrast-checked**:
  prefer the team's secondary, then accent color, requiring both a near-neutral
  hue (chroma ≤ 0.2 — a second strong hue reads badly on a colored card) and
  WCAG ≥ 4.5:1 against the primary; otherwise fall back to near-black
  `#0c0d0f` or white — so player cards render as solid team color with
  guaranteed-readable black/white ink.
- All 32 team palettes (primary/secondary/accent) live in `NFL_TEAM_COLORS`,
  which also backs `NFL_TEAM_NAMES`.

Rules: only accent-driven UI changes (buttons, active tabs, links, chart
marks, stat highlights). Never re-tint backgrounds, neutrals, or semantic
colors. Unknown team → no override (lime stays).

## 4. Typography

- **One face:** Geist Variable (bundled woff2, weights 100–900, no runtime
  font request). System-stack fallback. `--display` is an alias of `--font` —
  there is no second family, and no mono token is defined.
- **Text scale:** micro 10 / caption 12 / small 13 / body 14 / ui 15 /
  body-lg 16 / lead 17.
- **Heading tiers** (consolidated from the old 18–32px strays): h5 18 /
  h4 20 / h3 22 / h2 `clamp(24, 4.2vw, 28)` / h1 `clamp(26, 5vw, 32)` /
  hero `clamp(38, 4.6vw, 48)`.
- Numbers-first design: tabular data uses tight, consistent sizing;
  narration reads at body sizes.

## 5. Space, shape, elevation, motion

- **Spacing:** 4px base scale, `--s-1: 4px` … `--s-10: 40px` (1–6, then 8 and
  10 — the scale stops at 40px; anything larger is a per-context value).
- **Radii:** `--r-sm 6` / `--r-md 8` / `--r-lg 12` / `--r-xl 14` /
  `--r-2xl 16` (hero search family only) / `--r-pill`. There is no `--radius`
  default token — components pick a tier explicitly.
- **Elevation:** flat by philosophy — two shadows only, `--shadow-card` and
  `--shadow-pop`; borders and background steps do the work.
- **Z-scale:** one documented ladder — sticky(1) < nav(10) < popover(40) <
  skip-link(100). Overlays render in-flow; no portals.
- **Motion:** `--ease: cubic-bezier(0.2, 0.8, 0.2, 1)`; base `--dur 160ms` and
  `--dur-slow 240ms` — there is no fast tier. Comparison bars ease their width
  over `--dur`; skeletons shimmer at 1.3s behind a 150ms anti-flash delay.
  Motion supports comprehension, never decoration, and collapses under
  `prefers-reduced-motion`.

## 6. Component inventory (`apps/web/app/components/`)

| Component | Role |
|---|---|
| `AnswerCard` | The flagship: narration, entity chips, player card(s), comparison chart, sortable table |
| `SinglePlayerResult` / `PlayerComparisonResult` | Answer layouts per intent shape |
| `ResultDrilldown` | Row drill-downs on player leaderboards |
| `SortTable` | Dense sortable stat table; horizontal containment on mobile |
| `SearchSuggest` | Debounced autocomplete: players (headshots), teams, questions |
| `ScoreTicker` / `GameCard` / `Performers` / `HomeDashboard` | Home/dashboard surfaces |
| `Headshot` / `TeamLogo` / `Badge` (ui.tsx) | Identity primitives |
| `Nav` / `Crumbs` / `Dropdown` / `tablist` | Chrome & controls |
| `Skeleton` | Shimmer loading states |

Share lives on the route, not the card: `app/a/[id]/ResultExperience.tsx` owns
the title, "New search" / "Share" actions and the loading, error and
not-found states around `AnswerCard`.

**Planned, not yet built.** Keep these on the roadmap, but do not describe them
as shipping: a `ResultMethodology` component ("how was this computed"), a
standalone `Leaders` component (league-leader tiles currently live inline in
`HomeDashboard` and `app/leaders/page.tsx`), a `SeasonSelect` wrapper around
`Dropdown`, and the answer-card affordances listed in
[FRONTEND_SPEC.md](FRONTEND_SPEC.md) §3 — query interpretation, SQL
disclosure, CSV export and the source note. See `search-results-audit.md`.

## 7. Data-visualization rules

- Comparison charts accompany head-to-head answers: the track sits on `--bg`,
  bars fill with `--border-strong`, the leader's bar takes `--accent`, and
  width eases over `--dur`. The chart is a container query — it adapts to its
  own width, not the viewport.
- Tables are the primary viz: every chart has its numbers adjacent.
- **Honest note:** the `--chart`/`--chart-strong` tokens exist and re-tint per
  team, but nothing consumes them — the "marks use chart tokens, never raw
  accent" rule is an intention, not something the CSS enforces today. Routing
  marks through the chart tokens, and CSV export beside every table, are
  planned (§6).

## 8. Accessibility bars

- Text contrast ≥ 4.5:1 on **every** surface tier it can sit on (tokens are
  chosen and documented against the brightest tier).
- Team-tinted ink is programmatically contrast-checked (WCAG relative
  luminance) before use; falls back to black/white.
- Visible 2px accent focus outlines; skip-link at the top of the z-scale;
  color-scheme: dark declared for native form rendering.
