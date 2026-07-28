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
2. **Neutral dominates; accent is earned.** The emerald brand accent appears
   only where it means something: search, selection, CTAs, links, positive
   metrics. Everything else stays neutral.
3. **Team color is context, not decoration.** When the active context is one
   team (team page, player profile, single-team answer), the accent family
   re-tints to that team's branding. Backgrounds and neutrals never recolor.
4. **Dense but legible.** Stat tables are the product. Small type sizes
   (11–16px scale) with strict contrast floors, not big type with thin data.
5. **Honest states.** Skeletons while loading, plain-language refusals,
   visible interpretations. The UI never pretends to know something.

## 2. Color system

### Neutral ramp (surfaces — depth = background contrast, not lines)
| Token | Value | Use |
|---|---|---|
| `--bg` | `#0c0d0f` | page background |
| `--panel` | `#121417` | primary surface |
| `--elevated` | `#181b20` | raised surface (popovers, hovers) |
| `--bg-soft` | `#1f2328` | inset wells, chips |
| `--bg-hover` | `#262b31` | hover tier for soft surfaces |
| `--border` / `--border-strong` | 5% / 10% white | the few places that need a line |

### Ink
`--text #f5f5f5` · `--muted #a1a1aa` · `--faint #95959f` (tertiary — chosen to
clear 4.5:1 on every surface *including* the hover tier).

### Brand accent (emerald, used sparingly)
`--accent #10b981` with a full derived family: `--accent-hover`,
`--accent-soft` (12% fill), `--accent-contrast` (ink on solid accent),
`--accent-ink #34d399` (accent-colored *text* needs the lighter tone),
`--accent-border` (40%). Data marks use `--chart`/`--chart-strong` — never raw
accent.

### Semantic
`--success #4ade80` · `--warning #facc15` · `--danger #f87171` (+ soft/text/
border variants).

## 3. Team theming (`teamTheme.ts`)

The signature move. `teamTheme(teamId)` returns CSS-variable overrides scoped
to a container — spreading it re-tints **only the accent family** to the
team's primary color:

- `--accent` ← team primary; `--accent-deep` (−22%), `--accent-hover`
  (+12%), `--accent-ink` (+28% toward white), `--accent-soft` (14% alpha),
  `--accent-border` (40% alpha), `--chart`/`--chart-strong`.
- `--accent-contrast` (ink on solid team surfaces) is **contrast-checked**:
  prefer the team's secondary, then accent color, requiring WCAG ≥ 4.5:1
  against the primary; otherwise fall back to near-black or white — so player
  cards render as solid team color with guaranteed-readable black/white ink.
- All 32 team palettes (primary/secondary/accent) live in `NFL_TEAM_COLORS`.

Rules: only accent-driven UI changes (buttons, active tabs, links, chart
marks, stat highlights). Never re-tint backgrounds, neutrals, or semantic
colors. Unknown team → no override (emerald stays).

## 4. Typography

- **One face:** Geist Variable (bundled woff2, weights 100–900, no runtime
  font request). System-stack fallback. Mono for SQL: `ui-monospace` stack.
- **Text scale:** caption 11 / small 12 / body 13 / ui 14 / body-lg 15 /
  lead 16. Display sizes are per-context in the same face (`--display`).
- Numbers-first design: tabular data uses tight, consistent sizing;
  narration reads at body sizes.

## 5. Space, shape, elevation, motion

- **Spacing:** 4px base scale (`--s-1: 4px` … `--s-20: 80px`).
- **Radii:** 6 / 8 / 12 / 14px + pill. Default `--radius: 12px`.
- **Elevation:** flat by philosophy — shadows are subtle dark-on-dark
  (`--shadow-sm/card/pop`); borders and background steps do the work.
- **Z-scale:** one documented ladder — sticky(1) < nav(10) < popover(40) <
  skip-link(100). Overlays render in-flow; no portals.
- **Motion:** `--ease: cubic-bezier(0.2, 0.8, 0.2, 1)`; fast 120ms / base
  160ms / slow 240ms; data draw-ins (bars) 700ms. Motion supports
  comprehension (draw-ins, shimmer), never decoration.

## 6. Component inventory (`apps/web/app/components/`)

| Component | Role |
|---|---|
| `AnswerCard` | The flagship: narration, entities, player card(s), comparison chart, sortable table, query interpretation, SQL disclosure, CSV, share |
| `SinglePlayerResult` / `PlayerComparisonResult` | Answer layouts per intent shape |
| `ResultDrilldown` / `ResultMethodology` | Row drill-downs and "how was this computed" |
| `SortTable` | Dense sortable stat table; horizontal containment on mobile |
| `SearchSuggest` | Debounced autocomplete: players (headshots), teams, questions |
| `ScoreTicker` / `GameCard` / `Performers` / `Leaders` / `HomeDashboard` | Home/dashboard surfaces |
| `Headshot` / `TeamLogo` / `Badge` (ui.tsx) | Identity primitives |
| `Nav` / `Crumbs` / `Dropdown` / `SeasonSelect` / `tablist` | Chrome & controls |
| `Skeleton` | Shimmer loading states |

## 7. Data-visualization rules

- Marks use `--chart` tokens (team-tinted in team context), validated for the
  dark surface.
- Comparison charts accompany head-to-head answers; bars draw in over 700ms.
- Tables are the primary viz: every chart has its numbers adjacent; CSV
  export always available.

## 8. Accessibility bars

- Text contrast ≥ 4.5:1 on **every** surface tier it can sit on (tokens are
  chosen and documented against the brightest tier).
- Team-tinted ink is programmatically contrast-checked (WCAG relative
  luminance) before use; falls back to black/white.
- Visible 2px accent focus outlines; skip-link at the top of the z-scale;
  color-scheme: dark declared for native form rendering.
