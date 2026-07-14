# YunoBall search result audit

## Existing request flow

```text
Home Search component
→ SearchSuggest submits a natural-language question
→ POST /api/search through lib/api.ts#ask
→ Express search controller validates the body
→ runQueryPipeline resolves entities, parses, audits, executes, and narrates
→ AnswerResult returns to the browser
→ AnswerCard renders narration, entities, player context, comparison/table,
  query audit, SQL disclosure, CSV export, and share action
```

The homepage currently owns request state (`loading`, `error`, retry, result,
recent questions) and renders the full `AnswerCard` directly below its search
field. That keeps submission simple but makes discovery and analysis compete in
one layout.

## Existing persistence and routing

- Every parsed answer receives a deterministic `share_id`: a 32-character
  SHA-256 prefix of the normalized question.
- Completed answers are cached in memory and persisted to Postgres in
  `answer_cache`.
- `GET /api/search/answer/:shareId` retrieves the persisted `AnswerResult`.
- `/a/[id]` is already the public sharing convention, but its current page is a
  thin server-rendered wrapper around `AnswerCard` with no dedicated loading,
  retry, or export composition.
- `AnswerCard` already copies `/a/<share_id>` as its share URL.

The stable ID and route mean no new result identifier, slug table, or API
contract is needed.

## Result contract and reusable UI

`AnswerResult` already contains everything needed by a dedicated page:

- question and narrated answer;
- SQL and display columns/rows;
- resolved player/team entities;
- deterministic `share_id` and cache state;
- query intent;
- up to two enriched player cards;
- audit status, warnings, and confidence.

Reusable result pieces:

- `AnswerCard`: result normalization, player/team links, comparison chart,
  sortable table, query interpretation, SQL disclosure, CSV and share actions.
- `SortTable`, `Headshot`, `TeamLogo`, `Badge`, and design-system surfaces.
- `fetchSharedAnswer` for persistent route hydration.
- Existing loading skeleton and friendly error copy.

## Current behavior to preserve

- Homepage request loading and retry when query generation fails.
- Honest empty/unsupported narration.
- Query interpretation and audit status.
- Sortable responsive tables with horizontal containment.
- CSV generation from the displayed columns.
- Share-link copy using the stable route.
- Player, team, and box-score links embedded in result rows.

## Target flow

```text
User input
→ POST /api/search
→ normalize, audit, execute, persist
→ receive stable share_id
→ navigate to /a/<share_id>
→ hydrate the persisted AnswerResult
→ render one dedicated result hierarchy
→ share, CSV, query audit, or clean PNG export
```

The homepage remains a discovery surface: compact search, nested supported
questions, autocomplete, scores, performers, standings, fantasy, and leaders.
The dedicated route owns detailed analysis and export.

## Focused refactor

1. Await durable answer persistence before returning a completed query so an
   immediate route transition cannot race the share lookup.
2. Change homepage success handling from inline result state to `/a/[id]`
   navigation; retain request loading, error, and retry there.
3. Turn `/a/[id]` into a client-hydrated result experience with loading,
   not-found/error, and retry states.
4. Keep `AnswerCard` as the single renderer. Add only the small hooks needed
   for a clean capture target and route-level action bar.
5. Add PNG export around the rendered result rather than duplicating its data
   or markup.
