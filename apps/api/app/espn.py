"""ESPN media integration — headshots via ESPN's public CDN.

The warehouse stays the system of record for every number; ESPN supplies
media only. Headshot URLs are keyed by ESPN player id, and the id mapping
lives in ``espn_ids.py`` — a generated module produced by
``scripts/fetch_espn_ids.py``, which pulls the 32 team rosters from ESPN's
public API and name-matches them against the seeded players. Regenerate it
whenever the player pool changes:

    python scripts/fetch_espn_ids.py

Until the mapping covers a player, the frontend renders an initials avatar,
so nothing breaks when an id is missing.
"""

from __future__ import annotations

try:
    from .espn_ids import ESPN_IDS
except ImportError:  # pragma: no cover — generated file not present yet
    ESPN_IDS: dict[str, int] = {}

_HEADSHOT = "https://a.espncdn.com/i/headshots/nfl/players/full/{espn_id}.png"


def headshot_url(player_id: str) -> str | None:
    espn_id = ESPN_IDS.get(player_id)
    return _HEADSHOT.format(espn_id=espn_id) if espn_id else None
