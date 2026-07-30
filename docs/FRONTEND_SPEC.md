# YunoBall — Frontend Spec

> Element-by-element specification of the shipping UI. The live, rendered
> version of this document is **[FRONTEND_SPEC.html](FRONTEND_SPEC.html)** —
> it embeds the app's actual `globals.css`, so every demo there is
> pixel-identical to production. This file is the written inventory.
>
> Sources of truth: `apps/web/app/globals.css` (tokens + component CSS),
> `apps/web/app/lib/teamTheme.ts` (team theming),
> `apps/web/app/components/` (markup). Principles: [DESIGN_BRIEF.md](DESIGN_BRIEF.md).
>
> Note: an older standalone `frontend-spec.html` (light-theme, indigo)
> predated the dark redesign. It has been deleted — this spec and
> `FRONTEND_SPEC.html` replace it.

## 1. Foundations

| Element | Spec |
|---|---|
| Surfaces | 5-step cool-slate ramp `--bg #0a0c11 → --panel #13161e → --elevated #1b1f29 → --bg-soft #222835 → --bg-hover #2b3240`; depth = background contrast, borders rare (5%/10% white); `--bg-scrim` + `--shimmer` derived |
| Ink | `--text #f5f5f5` · `--muted #f2f2f4` · `--faint #e7e7ec` — all near-whites; hierarchy is carried by weight, not by dimming to grey |
| Accent | Lime `#89f336` family (`-hover #9ff955` / `-soft` 16% / `-ink #9df84f` / `-border` 42% / `-contrast #101c03` / `-deep`, an alias of `--accent`); text uses `--accent-ink`, fills use `--accent` |
| Semantic | success `#4ade80` (+`-soft`) · danger `#f87171` (+`-soft`, `-text #fca5a5`). No `--warning` token exists |
| Type | Geist Variable only (bundled, 100–900); text scale 10/12/13/14/15/16/17, heading tiers 18/20/22 + clamped h2/h1/hero; numerals `tabular-nums` in data contexts |
| Space | 4px base scale, `--s-1`…`--s-10` (4→40px; 1–6, then 8 and 10) |
| Radii | `--r-sm` 6 / `--r-md` 8 / `--r-lg` 12 / `--r-xl` 14 / `--r-2xl` 16 (hero search only) / `--r-pill` |
| Elevation | Flat philosophy; `--shadow-card` and `--shadow-pop` only |
| Z-scale | sticky 1 < nav 10 < popover 40 < skip-link 100; no portals |
| Motion | `--ease cubic-bezier(0.2,0.8,0.2,1)`; `--dur` 160ms / `--dur-slow` 240ms (no fast tier); comparison bars ease width over `--dur`; `.yb-enter` fade+rise; reduced-motion respected |
| Chart tokens | `--chart` (and `--chart-strong`, emitted by `teamTheme`) are declared but **consumed by nothing** — marks currently paint with `--accent` / `--border-strong` |

## 2. Team theming

`teamTheme(teamId)` (lib/teamTheme.ts) returns scoped CSS-variable overrides:
`--accent`/`--accent-deep` take the team's primary and `--accent-hover`/
`--accent-ink` take its most vivid readable brand color, while `--accent-soft`
and `--accent-border` fall back to plain `--elevated`/`--border` (a low-opacity
team tint over the dark canvas goes muddy). `--accent-contrast` ink is
contrast-checked (near-neutral hue, ≥4.5:1 WCAG luminance) against the primary,
falling back to near-black/white. Neutrals and backgrounds never recolor.
Applied on team pages, player profiles, single-team answers, leader and
standings rows, performer cards and winner rows. See
[DESIGN_BRIEF.md](DESIGN_BRIEF.md) §3.

## 3. Element inventory

### Primitives (`components/ui.tsx` unless noted)
| Element | Classes | Variants / states |
|---|---|---|
| Button | `.yb-btn` | solid accent (default), `.sm`, `:disabled`; 1px press translate. No `.ghost` variant today |
| Badge | `.yb-badge` | `neutral` (default), `.accent`, `.success`, `.danger` |
| Chip (interactive) | `.yb-chip` | hover, `[aria-pressed="true"]` active |
| Chip (static tag) | `.yb-chip-static` | — |
| Link | `.yb-link` | button-reset link; hover underline |
| Kbd hint | `.yb-kbd-hint` | keyboard shortcut affordance in inputs |
| Skeleton | `.yb-skel` (Skeleton.tsx) | shimmer sweep; composed into `BoardSkeleton`, and inline `.yb-skel` blocks on the answer and teams routes |

### Chrome & navigation
| Element | Classes | Notes |
|---|---|---|
| Top nav | `.yb-nav`, `.yb-nav-bar`, `.yb-brand`, `.yb-nav-links` (Nav.tsx) | hide-on-scroll; mobile panel + scrim; offline badge |
| Breadcrumbs | `.yb-crumbs`, `.sep`, `[aria-current="page"]` (Crumbs.tsx) | drill-down pages only |
| Tabs | `.yb-player-tabs` > `button[role="tab"]`, keyboard via `tablistKeys` (tablist.ts) | roving `aria-selected`; arrows wrap, Home/End jump, activation follows focus |
| Segmented control | `.yb-pill-seg` > `button[aria-pressed]` | REG/POST, value-mode and position switches |
| Dropdown | `.yb-dd`, `.yb-dd-btn`, `.yb-dd-pop`, `.yb-dd-item` (Dropdown.tsx) | keyboard navigable; season/team/position pickers use it directly (there is no `SeasonSelect` wrapper — planned) |

### Search
| Element | Classes | Notes |
|---|---|---|
| Search field | `.yb-search-wrap` > `input.yb-search` + `.yb-search-icon` + `.yb-kbd-hint` | focus = inset accent ring, no border |
| Suggest popover | `.yb-suggest(.is-open)` > `.yb-suggest-pop` > `.yb-suggest-item` | item kinds: player (headshot), team, `question`; `.muted` footer row |
| Example questions | `.yb-trend-groups` > `.yb-trend-group` > `ul.yb-trending` > `.yb-trending-q` (HomeDashboard) | the Trending Questions card seeds discovery on home; the same examples feed the suggest list. `.yb-chip` rows are used by the assistant, not here |

### Data display
| Element | Classes | Notes |
|---|---|---|
| Surface | `.yb-surface` (+ `.is-interactive`), via `Surface` (`as`, `interactive`) | the card family; `.yb-card` is the older dashboard/section shell still in use |
| Sort table | `.yb-table-scroll` > `table.yb-table`, `th > button.yb-th-sort(.on)`, `.num`, `.is-metric` | click-to-sort headers, `aria-sort`; metric column tinted accent; horizontal containment |
| Leaderboard rows | `.yb-board` > `.yb-board-top` + `.yb-board-row` (rank/headshot/name/value), `.yb-lb-unit` suffix | the #1 row is a team-themed hero card; ranks 2–10 are dense rows. No proportional fill bars today |
| Game card | `.yb-game-card` + `.yb-mini-boxscore`, `.yb-game-result-row(.winner)` | winner row gets `teamTheme`; status Badge (Scheduled/Live/Final) |
| Score ticker | `.yb-ticker` > `.yb-tick-label` + `.yb-tick-scroll` > `.yb-tick-game` | horizontal scroll, snap rows |
| Player mini card | `.yb-player-mini` (`.who/.nm/.sub/.go`) | identity card above player answers |
| Entity hero | `.yb-entity-hero` family (ui.tsx `EntityHero`) | player/team page headers |
| Info grid | `dl.yb-info-grid` | bio/definition pairs |
| Stat summary | `.yb-stat-summary` | headline metric group |

### Answer experience (`AnswerCard.tsx`)
| Element | Classes | Notes |
|---|---|---|
| Result frame | `.yb-query-result(.yb-enter)` + `.yb-query-result-head`, `.yb-result-body` | team-themed off the first player card |
| Narration | `.yb-answer` | the sentence answer; refusals render here honestly |
| Player card | `.yb-player-mini` (`.who/.nm/.sub/.go`) | links to the player page |
| Entities | `.yb-result-entities` > `.yb-chip-static` | resolved players/teams, each linking to its page |
| Comparison | `.yb-cmp`, `.yb-cmp-row` (`.track/.bar/.val`) | head-to-head bars, leader tinted |

The route, not the card, owns the frame around an answer: `app/a/[id]/`
(`ResultExperience.tsx`) renders `.yb-result-canvas`, `.yb-result-page-head`
and `.yb-result-page-actions` — "New search" plus a "Share" button that copies
the URL — along with the loading skeleton, retry and not-found states.

**Planned, not yet shipped.** None of the following exist in `apps/web` today;
they stay on the roadmap (see `search-results-audit.md` and
[PRD_MOBILE.md](PRD_MOBILE.md)), but nothing renders them yet:

| Element | Intended classes | Intent |
|---|---|---|
| Interpretation | `.yb-query-interpretation` | "how we read your question" |
| SQL disclosure | `pre.yb-sql` | the exact query, mono, scrollable (no mono token is defined yet either) |
| Actions | `.yb-result-actions` (`.yb-btn`, `.yb-link`) | CSV export and a methodology link beside the route-level share |
| Source note | `.yb-source-note` | provenance footer |
| Methodology | `ResultMethodology` component | "how was this computed" drawer |

### States
| State | Treatment |
|---|---|
| Loading | `.yb-skel` shimmer compositions mirroring final layout |
| Refusal | honest narration in `.yb-answer` on the answer route; never a guess |
| Inline error | `.yb-search-inline-error` + retry `.yb-btn` |
| Empty | plain-language empty copy, `.yb-muted` |
| Offline | `.yb-offline` badge in nav |

## 4. Rules that keep it coherent

1. Accent is earned: solid accent only on primary actions and selection;
   text-level accent uses `--accent-ink`.
2. Numbers right-align with `tabular-nums`; the queried metric column gets
   `.is-metric`.
3. One popover pattern (`--z-pop`, in-flow, no portals).
4. Every interactive element has a visible focus ring (2px accent outline).
5. Team tinting is scoped to the component that owns the team context —
   never the page shell.
6. `.yb-enter` for content arrival; all motion collapses under
   `prefers-reduced-motion`.
