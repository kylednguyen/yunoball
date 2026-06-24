"""Turn a raw SQL result into the answer-first presentation payload.

Hard rule: every displayed number comes from the SQL result or a follow-up query
against the warehouse — never from the LLM. The LLM only writes prose (narration).
Comparison cards are computed with real queries when the question resolves to a
single player + a known season stat; otherwise they're omitted (no fabrication).
"""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import text

from ..rag.store import read_engine
from ..schemas import (
    ComparisonCard,
    PrimaryStat,
    ResolvedEntity,
    SourceInfo,
    StatChip,
    Suggestion,
)

LOADED_SEASONS = (2022, 2023, 2024)

# Season-rollup stat columns we can build comparison cards for.
PSS_STAT_COLS = {
    "passing_yards", "passing_tds", "interceptions", "rushing_yards",
    "rushing_tds", "receptions", "receiving_yards", "receiving_tds",
    "fantasy_points_ppr",
}

_UNIT = {
    "passing_yards": "passing yards", "passing_tds": "passing touchdowns",
    "rushing_yards": "rushing yards", "rushing_tds": "rushing touchdowns",
    "receiving_yards": "receiving yards", "receiving_tds": "receiving touchdowns",
    "receptions": "receptions", "interceptions": "interceptions",
    "fantasy_points_ppr": "fantasy points", "points": "points",
    "points_for": "points", "wins": "wins", "games": "games",
    "total_epa": "total EPA", "epa": "EPA", "plays": "plays",
    "explosive_runs": "explosive runs", "passing_epa": "passing EPA",
}

_CHIP_ABBR = {
    "passing_yards": "YDS", "rushing_yards": "YDS", "receiving_yards": "YDS",
    "yards": "YDS", "total_yards": "YDS", "passing_tds": "TD", "rushing_tds": "TD",
    "receiving_tds": "TD", "interceptions": "INT", "receptions": "REC",
    "completions": "CMP", "attempts": "ATT", "carries": "CAR", "targets": "TGT",
    "points": "PTS", "points_for": "PF", "points_against": "PA",
    "fantasy_points_ppr": "FPTS", "wins": "W", "games": "G", "games_played": "GP",
    "sacks": "SCK", "plays": "PLAYS", "total_epa": "EPA", "passing_epa": "EPA",
    "explosive_runs": "RUN",
}


def classify(sql: str) -> str:
    s = sql.lower()
    if " plays" in s or "from plays" in s:
        return "play"
    if "team_game_stats" in s:
        return "team"
    if "player_game_stats" in s:
        return "player_game"
    if "player_season_stats" in s:
        return "player_season"
    if "games" in s:
        return "game"
    return "other"


def categorize(col: str) -> str:
    c = col.lower()
    if any(k in c for k in ("pass", "completion", "attempt", "interception")) or c == "sacks":
        return "passing"
    if "rush" in c or "carr" in c:
        return "rushing"
    if "receiv" in c or "recept" in c or "target" in c:
        return "receiving"
    if any(k in c for k in ("td", "touchdown", "point", "fantasy", "epa")):
        return "scoring"
    if any(k in c for k in ("win", "result", "record")):
        return "record"
    return "general"


def _is_number(v: Any) -> bool:
    if v is None or isinstance(v, bool):
        return False
    try:
        float(v)
        return True
    except (TypeError, ValueError):
        return False


def _fmt(v: Any) -> str:
    n = float(v)
    if n.is_integer():
        return f"{int(n):,}"
    return f"{n:,.2f}".rstrip("0").rstrip(".")


def _numeric_cols(rows: list[dict], columns: list[str]) -> list[str]:
    out = []
    for c in columns:
        vals = [r[c] for r in rows if r.get(c) is not None]
        if vals and all(_is_number(v) for v in vals):
            out.append(c)
    return out


def _primary_col(question: str, numeric: list[str], row: dict) -> str | None:
    if not numeric:
        return None
    q = question.lower()
    # Prefer the numeric column whose name (tokens) appears in the question.
    best, best_score = None, 0
    for c in numeric:
        score = sum(1 for tok in c.split("_") if tok in q and len(tok) > 2)
        if score > best_score:
            best, best_score = c, score
    if best:
        return best
    # else the largest value in the top row
    return max(numeric, key=lambda c: abs(float(row.get(c) or 0)))


def _label_col(columns: list[str], numeric: list[str], row: dict) -> str | None:
    for c in columns:
        if c not in numeric and isinstance(row.get(c), str):
            return c
    return None


def _parse_context(sql: str) -> tuple[list[int], str | None]:
    seasons = [int(y) for y in re.findall(r"season\s*(?:=|in)\s*\(?\s*(\d{4})", sql.lower())]
    seasons += [int(y) for y in re.findall(r"(\d{4})", sql) if y.startswith("20") and 2009 <= int(y) <= 2030]
    seasons = sorted(set(s for s in seasons if 2000 <= s <= 2030))
    stype = None
    m = re.search(r"season_type\s*=\s*'(\w+)'", sql.lower())
    if m:
        stype = m.group(1).upper()
    return seasons, stype


def _context_label(seasons: list[int], stype: str | None) -> str:
    if seasons:
        span = str(seasons[0]) if len(seasons) == 1 else f"{seasons[0]}–{seasons[-1]}"
        default_phase = "season" if len(seasons) == 1 else "seasons"
    else:
        span = "2022–2024"
        default_phase = "seasons"
    phase = {"REG": "regular season", "POST": "playoffs"}.get(stype or "", default_phase)
    return f"{span} {phase}".strip()


def humanize(col: str) -> str:
    return _UNIT.get(col, col.replace("_", " "))


def build_chips(row: dict, numeric: list[str]) -> list[StatChip]:
    chips: list[StatChip] = []
    for c in numeric:
        v = row.get(c)
        if v is None:
            continue
        abbr = _CHIP_ABBR.get(c) or "".join(w[0] for w in c.split("_"))[:4].upper()
        chips.append(StatChip(label=f"{_fmt(v)} {abbr}", category=categorize(c)))
        if len(chips) >= 6:
            break
    return chips


def build_source(question: str, query_type: str, n_rows: int) -> SourceInfo:
    warnings: list[str] = []
    years = [int(y) for y in re.findall(r"\b(19\d{2}|20\d{2})\b", question)]
    if any(y not in LOADED_SEASONS for y in years):
        warnings.append("Only the 2022–2024 seasons are loaded; other years aren't available yet.")
    if re.search(r"\b(live|today|tonight|projected|projection|fantasy projection)\b", question.lower()):
        warnings.append("This warehouse is historical (final stats only) — no live or projected data.")
    coverage = "2022–2024 · regular & postseason"
    if query_type == "play":
        coverage += " · play-by-play"
    return SourceInfo(
        coverage=coverage,
        freshness="Final",
        updated=_data_through(),
        warnings=warnings,
    )


_DATA_THROUGH: str | None = None


def _data_through() -> str | None:
    global _DATA_THROUGH
    if _DATA_THROUGH is None:
        try:
            with read_engine().connect() as conn:
                d = conn.execute(text("SELECT MAX(game_date) FROM games")).scalar()
            _DATA_THROUGH = d.isoformat() if d else ""
        except Exception:
            _DATA_THROUGH = ""
    return _DATA_THROUGH or None


def build_interpretation(question: str, primary: PrimaryStat | None) -> str:
    if primary and primary.subject and primary.unit:
        ctx = f" in the {primary.context}" if primary.context else ""
        return f"I interpreted this as: {primary.subject}'s {primary.unit}{ctx}."
    return f"I interpreted this as: {question.rstrip('?')}."


def build_alternatives(seasons: list[int], stype: str | None, primary, question: str) -> list[Suggestion]:
    if not primary or not primary.subject or not primary.unit:
        return []
    subj, unit = primary.subject, primary.unit
    alts: list[Suggestion] = []
    if stype != "POST":
        alts.append(Suggestion(label="Playoffs only", query=f"{subj} {unit} in the playoffs"))
    if len(seasons) == 1:
        alts.append(Suggestion(label="Career (2022–24)", query=f"{subj} total {unit} from 2022 to 2024"))
        alts.append(Suggestion(label="Per game", query=f"{subj} {unit} per game in {seasons[0]}"))
    return alts[:4]


def build_followups(primary, query_type: str, seasons: list[int]) -> list[str]:
    season = seasons[0] if len(seasons) == 1 else 2023
    if primary and primary.subject_type == "player" and primary.subject:
        s = primary.subject
        return [
            f"How many touchdowns did {s} score in {season}?",
            f"{s} stats by game in {season}",
            f"Top 5 players by {primary.unit or 'passing yards'} in {season}",
            f"{s} total passing, rushing and receiving yards from 2022 to 2024",
        ]
    if primary and primary.subject_type == "team" and primary.subject:
        s = primary.subject
        return [
            f"What was {s}'s record in {season}?",
            f"How many points did {s} score in {season}?",
            f"{s} biggest win in {season}",
        ]
    return [
        "Who led the NFL in rushing yards in 2023?",
        "Most passing touchdowns in the 2023 season",
        "Which team scored the most points in 2023?",
    ]


def _comparisons(player_id: str, col: str, season: int, season_value: float) -> list[ComparisonCard]:
    cards: list[ComparisonCard] = []
    try:
        with read_engine().connect() as conn:
            games_played = conn.execute(
                text(
                    "SELECT games_played FROM player_season_stats "
                    "WHERE player_id=:p AND season=:s AND season_type='REG'"
                ),
                {"p": player_id, "s": season},
            ).scalar()
            rank = conn.execute(
                text(
                    f"SELECT COUNT(*)+1 FROM player_season_stats "
                    f"WHERE season=:s AND season_type='REG' AND {col} > :v"
                ),
                {"s": season, "v": season_value},
            ).scalar()
            total = conn.execute(
                text(
                    f"SELECT COUNT(*) FROM player_season_stats "
                    f"WHERE season=:s AND season_type='REG' AND {col} IS NOT NULL"
                ),
                {"s": season},
            ).scalar()
            last5 = conn.execute(
                text(
                    f"SELECT AVG(v) FROM (SELECT pgs.{col} AS v FROM player_game_stats pgs "
                    f"JOIN games g USING (game_id) WHERE pgs.player_id=:p AND g.season=:s "
                    f"ORDER BY g.game_date DESC LIMIT 5) t"
                ),
                {"p": player_id, "s": season},
            ).scalar()
            career = conn.execute(
                text(
                    f"SELECT SUM({col}) FROM player_season_stats "
                    f"WHERE player_id=:p AND season_type='REG'"
                ),
                {"p": player_id},
            ).scalar()

        cards.append(ComparisonCard(label=f"{season} total", value=_fmt(season_value)))
        if games_played:
            cards.append(
                ComparisonCard(label="Per game", value=_fmt(round(season_value / games_played, 1)),
                               note=f"{games_played} games")
            )
        if last5 is not None:
            cards.append(ComparisonCard(label="Last 5 games", value=_fmt(round(float(last5), 1)), note="per game"))
        if rank and total:
            cards.append(ComparisonCard(label="League rank", value=f"#{int(rank)}", note=f"of {int(total)}"))
        if career is not None:
            cards.append(ComparisonCard(label="2022–24 total", value=_fmt(career), note="loaded seasons"))
    except Exception:
        return []
    return cards


def enrich(
    *,
    question: str,
    sql: str,
    rows: list[dict[str, Any]],
    columns: list[str],
    entities: list[ResolvedEntity],
) -> dict[str, Any]:
    """Best-effort; never raises (returns partial payload on any failure)."""
    query_type = classify(sql)
    seasons, stype = _parse_context(sql)
    source = build_source(question, query_type, len(rows))

    if not rows:
        return {
            "query_type": query_type,
            "interpretation": build_interpretation(question, None),
            "primary": None,
            "chips": [],
            "comparisons": [],
            "alternatives": [],
            "followups": build_followups(None, query_type, seasons),
            "source": source,
        }

    row0 = rows[0]
    numeric = _numeric_cols(rows, columns)
    pcol = _primary_col(question, numeric, row0)
    lcol = _label_col(columns, numeric, row0)

    player_ent = next((e for e in entities if e.entity_type == "player"), None)
    team_ent = next((e for e in entities if e.entity_type == "team"), None)
    subject = (
        (player_ent or team_ent).display_name
        if (player_ent or team_ent)
        else (str(row0.get(lcol)) if lcol else None)
    )
    subject_type = "player" if player_ent else ("team" if team_ent else None)

    primary = PrimaryStat(
        subject=subject,
        subject_type=subject_type,
        value=_fmt(row0[pcol]) if pcol and row0.get(pcol) is not None else None,
        unit=humanize(pcol) if pcol else None,
        context=_context_label(seasons, stype),
    )

    comparisons: list[ComparisonCard] = []
    if (
        query_type == "player_season"
        and player_ent
        and pcol in PSS_STAT_COLS
        and len(seasons) == 1
        and row0.get(pcol) is not None
    ):
        comparisons = _comparisons(player_ent.canonical_id, pcol, seasons[0], float(row0[pcol]))

    return {
        "query_type": query_type,
        "interpretation": build_interpretation(question, primary),
        "primary": primary,
        "chips": build_chips(row0, numeric),
        "comparisons": comparisons,
        "alternatives": build_alternatives(seasons, stype, primary, question),
        "followups": build_followups(primary, query_type, seasons),
        "source": source,
    }
