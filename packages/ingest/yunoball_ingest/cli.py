"""CLI entrypoint:  yunoball-ingest --years 2022 2023 2024

Loads dimensions then facts, in dependency order.
"""

from __future__ import annotations

import argparse

from .db import get_engine
from . import pipelines


def main() -> None:
    parser = argparse.ArgumentParser(description="Load nflverse data into YunoBall.")
    parser.add_argument(
        "--years",
        type=int,
        nargs="+",
        required=True,
        help="Seasons to load, e.g. --years 2022 2023 2024",
    )
    parser.add_argument(
        "--only",
        choices=["teams", "seasons", "players", "games", "player_game_stats"],
        nargs="*",
        help="Run only specific pipelines (default: all, in order).",
    )
    args = parser.parse_args()

    engine = get_engine()
    years = sorted(set(args.years))

    steps = [
        ("teams", lambda: pipelines.load_teams(engine)),
        ("seasons", lambda: pipelines.load_seasons(engine, years)),
        ("players", lambda: pipelines.load_players(engine, years)),
        ("games", lambda: pipelines.load_games(engine, years)),
        ("player_game_stats", lambda: pipelines.load_player_game_stats(engine, years)),
    ]

    selected = set(args.only) if args.only else None
    for name, fn in steps:
        if selected and name not in selected:
            continue
        count = fn()
        print(f"[ingest] {name}: {count} rows")


if __name__ == "__main__":
    main()
