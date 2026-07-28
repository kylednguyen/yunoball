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
> Note: the older `frontend-spec.html` (light-theme, indigo) predates the
> dark-emerald redesign and is superseded by this spec.

## 1. Foundations

| Element | Spec |
|---|---|
| Surfaces | 5-step neutral ramp `--bg → --panel → --elevated → --bg-soft → --bg-hover`; depth = background contrast, borders rare (5%/10% white) |
| Ink | `--text #f5f5f5` · `--muted #a1a1aa` · `--faint #95959f`; all tiers clear 4.5:1 on every surface they can sit on |
| Accent | Emerald `#10b981` family (`-hover/-soft/-ink/-border/-contrast`); text uses `--accent-ink`, fills use `--accent` |
| Semantic | success `#4ade80` · warning `#facc15` · danger `#f87171` (+ soft/text/border) |
| Type | Geist Variable only (bundled, 100–900); scale 11/12/13/14/15/16; numerals `tabular-nums` in data contexts |
| Space | 4px base scale, `--s-1`…`--s-20` (4→80px) |
| Radii | 6 / 8 / 12 / 14 / pill |
| Elevation | Flat philosophy; `--shadow-sm/card/pop` only |
| Z-scale | sticky 1 < nav 10 < popover 40 < skip-link 100; no portals |
| Motion | `--ease cubic-bezier(0.2,0.8,0.2,1)`; 120/160/240ms; 700ms data draw-ins; `.yb-enter` fade+rise; reduced-motion respected |

## 2. Team theming

`teamTheme(teamId)` (lib/teamTheme.ts) returns scoped CSS-variable overrides:
accent family + chart marks re-tint to the team's primary; `--accent-contrast`
ink is contrast-checked (≥4.5:1, WCAG luminance) against the primary, falling
back to near-black/white. Neutrals and backgrounds never recolor. Applied on
team pages, player profiles, single-team answers, and winner rows.

## 3. Element inventory

### Primitives (`components/ui.tsx` unless noted)
| Element | Classes | Variants / states |
|---|---|---|
| Button | `.yb-btn` | solid accent (default), `.ghost`, `.sm`, `:disabled` |
| Badge | `.yb-badge` | `neutral` (default), `.accent`, `.success`, `.danger` |
| Chip (interactive) | `.yb-chip` | hover, `[aria-pressed="true"]` active |
| Chip (static tag) | `.yb-chip-static` | — |
| Link | `.yb-link` | button-reset link; hover underline |
| Kbd hint | `.yb-kbd-hint` | keyboard shortcut affordance in inputs |
| Skeleton | `.yb-skel` (Skeleton.tsx) | shimmer sweep; composed into `AnswerSkeleton`, `BoardSkeleton` |

### Chrome & navigation
| Element | Classes | Notes |
|---|---|---|
| Top nav | `.yb-nav`, `.yb-nav-bar`, `.yb-brand`, `.yb-nav-links` (Nav.tsx) | hide-on-scroll; mobile panel + scrim; offline badge |
| Breadcrumbs | `.yb-crumbs`, `.sep`, `[aria-current="page"]` (Crumbs.tsx) | drill-down pages only |
| Tabs | `.yb-tabs` > `.yb-tab` (tablist.ts) | roving `aria-selected` |
| Segmented control | `.yb-seg` > `button[aria-pressed]` | REG/POST, mode switches |
| Dropdown | `.yb-dd`, `.yb-dd-btn`, `.yb-dd-pop`, `.yb-dd-item` (Dropdown.tsx) | keyboard navigable; `SeasonSelect` wraps it |

### Search
| Element | Classes | Notes |
|---|---|---|
| Search field | `.yb-search-wrap` > `input.yb-search` + `.yb-search-icon` + `.yb-kbd-hint` | focus = inset accent ring, no border |
| Suggest popover | `.yb-suggest(.is-open)` > `.yb-suggest-pop` > `.yb-suggest-item` | item kinds: player (headshot), team, `question`; `.muted` footer row |
| Example chips | `.yb-chip` row | seeds discovery on home |

### Data display
| Element | Classes | Notes |
|---|---|---|
| Surface | `.yb-surface` (`-standard/-feature/-dense`, `.is-interactive`) | the card family; `.yb-card` legacy answer card shell |
| Sort table | `.yb-table-scroll` > `table.yb-table`, `th > button.yb-th-sort(.on)`, `.num`, `.is-metric` | click-to-sort headers, `aria-sort`; metric column tinted accent; horizontal containment |
| Leaderboard rows | `.yb-lb` > `.yb-lb-row` (rank/name/track/value) | proportional `.yb-lb-fill` bars in `--chart`, 700ms draw-in |
| Game card | `.yb-game-card` + `.yb-mini-boxscore`, `.yb-game-result-row(.winner)` | winner row gets `teamTheme`; status Badge (Scheduled/Live/Final) |
| Score ticker | `.yb-ticker` > `.yb-tick-label` + `.yb-tick-scroll` > `.yb-tick-game` | horizontal scroll, snap rows |
| Player mini card | `.yb-player-mini` (`.who/.nm/.sub/.go`) | identity card above player answers |
| Entity hero | `.yb-entity-hero` family (ui.tsx `EntityHero`) | player/team page headers |
| Info grid | `dl.yb-info-grid` | bio/definition pairs |
| Stat summary | `.yb-stat-summary` | headline metric group |

### Answer experience (`AnswerCard.tsx`)
| Element | Classes | Notes |
|---|---|---|
| Result frame | `.yb-query-result(.yb-enter)` + `-head`, `.yb-result-kicker`, `.yb-result-body` | |
| Narration | `.yb-answer` | the sentence answer; refusals render here honestly |
| Entities | `.yb-result-entities` chips | resolved players/teams with confidence |
| Interpretation | `.yb-query-interpretation` | "how we read your question" |
| SQL disclosure | `pre.yb-sql` | the exact query, mono, scrollable |
| Actions | `.yb-result-actions` (`.yb-btn`, `.yb-link`) | CSV export, share, methodology |
| Comparison | `.yb-cmp`, `.yb-cmp-row` (`.track/.bar/.val`) | head-to-head bars, leader tinted |
| Source note | `.yb-source-note` | provenance footer |

### States
| State | Treatment |
|---|---|
| Loading | `.yb-skel` shimmer compositions mirroring final layout |
| Refusal | honest narration in `.yb-answer` + example chips; never a guess |
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
