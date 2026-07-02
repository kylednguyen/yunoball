#!/usr/bin/env python3
"""Incremental data update — refresh the current NFL season into the warehouse.

The ingest pipelines upsert with ``INSERT ... ON CONFLICT``, so this is safe to
run repeatedly: existing rows are updated in place and nothing is ever
duplicated. Intended to run on a schedule during the season
(see ``.github/workflows/update-data.yml``), but usable by hand too:

    python scripts/update_data.py              # current season
    python scripts/update_data.py --season 2024
    python scripts/update_data.py --season 2024 2023   # backfill a couple

Requires the ingest package installed (``pip install -e packages/db -e
packages/ingest``) and ``DIRECT_DATABASE_URL`` (or ``DATABASE_URL``) set.
"""

from __future__ import annotations

import argparse
from datetime import date

from yunoball_ingest import pipelines
from yunoball_ingest.db import get_engine

# Box-score grained: no play-by-play. Order matters (dimensions before facts).
STEPS = [
    ("teams", lambda e, yrs: pipelines.load_teams(e)),
    ("seasons", lambda e, yrs: pipelines.load_seasons(e, yrs)),
    ("players", lambda e, yrs: pipelines.load_players(e, yrs)),
    ("games", lambda e, yrs: pipelines.load_games(e, yrs)),
    ("player_game_stats", lambda e, yrs: pipelines.load_player_game_stats(e, yrs)),
    ("player_season_stats", lambda e, yrs: pipelines.load_player_season_stats(e, yrs)),
    ("team_game_stats", lambda e, yrs: pipelines.load_team_game_stats(e, yrs)),
]


def current_season(today: date | None = None) -> int:
    """The NFL season currently in progress (a season is named for its September)."""
    today = today or date.today()
    return today.year if today.month >= 9 else today.year - 1


def main() -> None:
    ap = argparse.ArgumentParser(description="Refresh current-season NFL data (idempotent).")
    ap.add_argument(
        "--season", type=int, nargs="+", default=None,
        help="Season(s) to refresh (default: the current season).",
    )
    args = ap.parse_args()

    years = sorted(set(args.season)) if args.season else [current_season()]
    engine = get_engine()
    label = years[0] if len(years) == 1 else f"{years[0]}–{years[-1]}"
    print(f"[update] refreshing season {label}")

    for name, fn in STEPS:
        count = fn(engine, years)
        print(f"[update] {name}: {count} rows")

    print("[update] done")


if __name__ == "__main__":
    main()
