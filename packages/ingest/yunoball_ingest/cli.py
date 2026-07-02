"""CLI entrypoint.

    yunoball-ingest --years 2022 2023 2024     # specific seasons
    yunoball-ingest --all                       # every season since 1999

Loads dimensions then facts, in dependency order. The warehouse is box-score
grained (no play-by-play), so a full 1999→present backfill stays small.
"""

from __future__ import annotations

import argparse
from datetime import date

from .db import get_engine
from . import pipelines

# nflverse weekly/seasonal coverage starts in 1999.
FIRST_SEASON = 1999

STEPS = ["teams", "seasons", "players", "games", "player_game_stats",
         "player_season_stats", "team_game_stats"]


def _all_seasons() -> list[int]:
    # Through the season that has started by today (NFL season year = its Sept).
    today = date.today()
    last = today.year if today.month >= 9 else today.year - 1
    return list(range(FIRST_SEASON, last + 1))


def main() -> None:
    parser = argparse.ArgumentParser(description="Load nflverse data into YunoBall.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--years", type=int, nargs="+", help="Seasons, e.g. 2022 2023")
    group.add_argument("--all", action="store_true", help="Every season since 1999")
    parser.add_argument(
        "--only", choices=STEPS, nargs="*",
        help="Run only these pipelines (default: all, in order).",
    )
    parser.add_argument(
        "--skip", choices=STEPS, nargs="*", default=[],
        help="Skip these pipelines (e.g. --skip team_game_stats).",
    )
    args = parser.parse_args()

    engine = get_engine()
    years = _all_seasons() if args.all else sorted(set(args.years))
    print(f"[ingest] seasons: {years[0]}–{years[-1]} ({len(years)} total)")

    registry = {
        "teams": lambda: pipelines.load_teams(engine),
        "seasons": lambda: pipelines.load_seasons(engine, years),
        "players": lambda: pipelines.load_players(engine, years),
        "games": lambda: pipelines.load_games(engine, years),
        "player_game_stats": lambda: pipelines.load_player_game_stats(engine, years),
        "player_season_stats": lambda: pipelines.load_player_season_stats(engine, years),
        "team_game_stats": lambda: pipelines.load_team_game_stats(engine, years),
    }

    selected = set(args.only) if args.only else set(STEPS)
    selected -= set(args.skip)
    for name in STEPS:  # dependency order
        if name not in selected:
            continue
        count = registry[name]()
        print(f"[ingest] {name}: {count} rows")


if __name__ == "__main__":
    main()
