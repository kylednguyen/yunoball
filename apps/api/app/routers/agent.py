"""POST /api/agent — the YunoBall AI assistant.

A conversational agent over the same trusted tools the rest of the platform
uses: stats search (QuerySpec pipeline), standings, scores and the fantasy
pool. Two modes, same tools:

  - demo (no OpenAI key): deterministic intent routing picks a tool and the
    reply is templated from real query results — still zero hallucination.
  - production: an OpenAI tool-calling loop chooses tools itself; every number
    in the reply comes from a tool result.
"""

from __future__ import annotations

import json
import logging
import re

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from .. import ratelimit
from ..config import settings
from ..pipeline import run_query_pipeline
from ..schemas import HistoryTurn, SearchRequest
from .fantasy import fantasy_players
from .games import games as games_endpoint
from .games import performers as performers_endpoint
from .standings import standings as standings_endpoint

log = logging.getLogger("yunoball.agent")
router = APIRouter(prefix="/api/agent", tags=["agent"])

MAX_TURNS = 20
MAX_TOOL_STEPS = 4


class AgentRequest(BaseModel):
    messages: list[HistoryTurn] = Field(min_length=1, max_length=MAX_TURNS)


class AgentStep(BaseModel):
    tool: str
    summary: str


class AgentResponse(BaseModel):
    reply: str
    steps: list[AgentStep]
    mode: str  # "demo" | "llm"


# ------------------------------- Tools ------------------------------------ #
# Each tool returns (summary-for-the-model, human-readable fallback lines).


async def _tool_standings(season: int | None = None) -> tuple[str, str]:
    data = await standings_endpoint(season=season)
    lines: list[str] = [f"{data.season} standings"]
    for conf in data.conferences:
        for div in conf.divisions:
            lines.append(f"\n{div.division}")
            for t in div.teams:
                lines.append(
                    f"  {t.name}: {t.wins}-{t.losses}"
                    + (f"-{t.ties}" if t.ties else "")
                    + f" ({t.points_for} PF / {t.points_against} PA, {t.streak})"
                )
    text = "\n".join(lines)
    return text, text


async def _tool_scores(season: int | None = None, week: int | None = None) -> tuple[str, str]:
    data = await games_endpoint(season=season, week=week)
    lines = [f"Week {data.week}, {data.season} — final scores"]
    for g in data.games:
        lines.append(
            f"  {g.away.nickname or g.away.name} {g.away.score} @ "
            f"{g.home.nickname or g.home.name} {g.home.score}"
        )
    text = "\n".join(lines)
    return text, text


async def _tool_performers(season: int | None = None, week: int | None = None) -> tuple[str, str]:
    data = await performers_endpoint(season=season, week=week, limit=8)
    lines = [f"Performers of week {data.week}, {data.season} — top PPR fantasy lines"]
    for p in data.performers:
        lines.append(
            f"  {p.rank}. {p.name} ({p.position} vs {p.opponent}) — "
            f"{p.fantasy_points_ppr} PPR · {p.stat_line}"
        )
    text = "\n".join(lines)
    return text, text


async def _tool_fantasy(position: str | None = None, season: int | None = None) -> tuple[str, str]:
    data = await fantasy_players(season=season, position=position, q=None, limit=12)
    label = f"{position} " if position else ""
    lines = [f"Top {label}fantasy scorers (PPR), {data.season}"]
    for i, p in enumerate(data.players, start=1):
        lines.append(
            f"  {i}. {p.name} ({p.position}, {p.team}) — "
            f"{p.fantasy_points_ppr} pts, {p.points_per_game}/gm"
        )
    text = "\n".join(lines)
    return text, text


async def _tool_search(question: str) -> tuple[str, str]:
    resp = await run_query_pipeline(SearchRequest(question=question))
    detail = resp.narration
    if resp.rows:
        cols = resp.columns[:6]
        sample = [
            ", ".join(f"{c}={row.get(c)}" for c in cols) for row in resp.rows[:8]
        ]
        detail += "\n" + "\n".join(f"  {s}" for s in sample)
    return detail, resp.narration


# --------------------------- Fantasy judgment ----------------------------- #


async def _team_scoring(season: int | None) -> dict[str, float]:
    """Points-for per game by team — the 'offense environment' factor."""
    try:
        data = await standings_endpoint(season=season)
    except HTTPException:
        return {}
    out: dict[str, float] = {}
    for conf in data.conferences:
        for div in conf.divisions:
            for t in div.teams:
                games = t.wins + t.losses + t.ties
                if games:
                    out[t.team_id] = t.points_for / games
    return out


def _td_share(p) -> float:
    """Share of fantasy points that came from touchdowns — a volatility proxy."""
    if p.fantasy_points_ppr <= 0:
        return 0.0
    td_pts = p.passing_tds * 4 + (p.rushing_tds + p.receiving_tds) * 6
    return td_pts / p.fantasy_points_ppr


async def _judge_start_sit(picks: list, season: int) -> str:
    """Rank named players with a multi-factor verdict, not raw points alone.

    Production rate leads; a reception-per-game bonus rewards the PPR floor;
    team scoring rate captures the offense a player lives in. TD reliance is
    surfaced as a caution rather than scored — TDs are the noisiest stat.
    """
    pf_pg = await _team_scoring(season)
    league_avg_pf = sum(pf_pg.values()) / len(pf_pg) if pf_pg else 0.0

    def score(p) -> float:
        s = p.points_per_game
        if p.games_played:
            s += 0.4 * (p.receptions / p.games_played)
        if pf_pg and p.team in pf_pg:
            s += 0.15 * (pf_pg[p.team] - league_avg_pf)
        return s

    ranked = sorted(picks, key=score, reverse=True)
    best, rest = ranked[0], ranked[1:]

    lines = [
        f"Start {best.name} ({best.position}, {best.team}) — "
        f"{best.points_per_game} PPR points per game in {season}."
    ]
    for p in rest:
        lines.append(f"Sit {p.name} ({p.position}, {p.team}) — {p.points_per_game}/gm.")

    lines.append("\nThe case:")
    lines.append(
        "• Production: "
        + " vs ".join(f"{p.points_per_game:.1f}" for p in ranked)
        + " PPR/gm"
    )
    rec_rates = [p.receptions / p.games_played if p.games_played else 0.0 for p in ranked]
    if any(r >= 1 for r in rec_rates):
        lines.append(
            "• PPR floor: "
            + " vs ".join(f"{r:.1f}" for r in rec_rates)
            + " receptions/gm"
        )
    if pf_pg and all(p.team in pf_pg for p in ranked):
        lines.append(
            "• Offense environment: "
            + ", ".join(f"{p.team} {pf_pg[p.team]:.1f} PF/gm" for p in ranked)
        )
    for p in ranked:
        share = _td_share(p)
        if share >= 0.35:
            lines.append(
                f"• TD reliance: {p.name} gets {share:.0%} of his points from"
                " touchdowns — more boom/bust"
            )
    return "\n".join(lines)


# ------------------------------ Demo agent -------------------------------- #

_WEEK_RE = re.compile(r"\bweek\s*(\d{1,2})\b", re.I)
_SEASON_RE = re.compile(r"\b(20\d{2})\b")
_STANDINGS_RE = re.compile(r"\b(standings?|division|divisions|record|records|conference)\b", re.I)
_SCORES_RE = re.compile(r"\b(scores?|results?|schedule|games?|final|beat|won|lost)\b", re.I)
_FANTASY_RE = re.compile(r"\b(fantasy|start|sit|lineup|draft|ppr|waiver)\b", re.I)
_POSITION_RE = re.compile(r"\b(QB|RB|WR|TE)s?\b", re.I)
_PERFORMERS_RE = re.compile(r"\b(performers?|top players?|best (players?|games?)|stud|studs|blew up|went off|player of the week)\b", re.I)


async def _demo_agent(question: str) -> tuple[str, list[AgentStep]]:
    season_m = _SEASON_RE.search(question)
    season = int(season_m.group(1)) if season_m else None
    week_m = _WEEK_RE.search(question)

    # "Top performers in week 7" — a weekly leaderboard, distinct from the
    # season-long fantasy pool and from start/sit judgment.
    if _PERFORMERS_RE.search(question) or (week_m and _FANTASY_RE.search(question)):
        try:
            _, text = await _tool_performers(
                season=season, week=int(week_m.group(1)) if week_m else None
            )
            return text, [AgentStep(tool="performers", summary="Top weekly PPR fantasy lines")]
        except HTTPException:
            pass

    if _FANTASY_RE.search(question):
        # Start/sit: find every seeded player named in the question and judge
        # them schematically. (resolve_entities returns one best match only.)
        pool = await fantasy_players(season=season, position=None, q=None, limit=500)
        lowered = question.lower()
        picks = []
        for p in pool.players:
            last = p.name.lower().split()[-1]
            if p.name.lower() in lowered or re.search(rf"\b{re.escape(last)}\b", lowered):
                picks.append(p)
        if len(picks) >= 2:
            reply = await _judge_start_sit(picks, pool.season)
            return reply, [
                AgentStep(
                    tool="fantasy_judge",
                    summary="Weighed production, PPR floor, offense environment and TD reliance",
                )
            ]
        pos_m = _POSITION_RE.search(question)
        _, text = await _tool_fantasy(
            position=pos_m.group(1).upper() if pos_m else None, season=season
        )
        return text, [AgentStep(tool="fantasy_pool", summary="Top PPR scorers")]

    if _STANDINGS_RE.search(question):
        _, text = await _tool_standings(season=season)
        return text, [AgentStep(tool="standings", summary="Computed from game results")]

    if week_m or _SCORES_RE.search(question):
        try:
            _, text = await _tool_scores(
                season=season, week=int(week_m.group(1)) if week_m else None
            )
            return text, [AgentStep(tool="scores", summary="Final scores from the warehouse")]
        except HTTPException:
            pass  # e.g. week out of range — fall through to stats search

    _, narration = await _tool_search(question)
    return narration, [AgentStep(tool="stats_search", summary="QuerySpec pipeline")]


# ------------------------------- LLM agent -------------------------------- #

_OPENAI_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_standings",
            "description": "NFL standings (W-L, points for/against, streak) by division for a season.",
            "parameters": {
                "type": "object",
                "properties": {"season": {"type": "integer"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_scores",
            "description": "Final scores for a given NFL season and week.",
            "parameters": {
                "type": "object",
                "properties": {"season": {"type": "integer"}, "week": {"type": "integer"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_fantasy_leaders",
            "description": "Top season-long fantasy (PPR) scorers, optionally filtered by position (QB/RB/WR/TE).",
            "parameters": {
                "type": "object",
                "properties": {"season": {"type": "integer"}, "position": {"type": "string"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_weekly_performers",
            "description": "Top fantasy performers for a SPECIFIC week, with each player's full stat line (the best single-game fantasy lines that week).",
            "parameters": {
                "type": "object",
                "properties": {"season": {"type": "integer"}, "week": {"type": "integer"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_stats",
            "description": "Answer any NFL stats question (player/team totals, leaders, single-game records) from the warehouse.",
            "parameters": {
                "type": "object",
                "properties": {"question": {"type": "string"}},
                "required": ["question"],
            },
        },
    },
]

_SYSTEM = (
    "You are YunoBall's fantasy football co-pilot. Your specialty is judgment "
    "calls — start/sit, lineup construction, player comparisons — where a plain "
    "stat lookup isn't enough. Weigh production rate (points per game) first, "
    "then volume and the PPR reception floor, the player's offense environment "
    "(team scoring), and flag touchdown-dependent profiles as boom/bust. You can "
    "also answer stats, scores and standings questions via tools. Every number "
    "you state must come from a tool result — never invent statistics. Be "
    "concise and conversational; use short lines, not markdown tables."
)


async def _call_tool(name: str, args: dict) -> str:
    if name == "get_standings":
        return (await _tool_standings(season=args.get("season")))[0]
    if name == "get_scores":
        return (await _tool_scores(season=args.get("season"), week=args.get("week")))[0]
    if name == "get_weekly_performers":
        return (await _tool_performers(season=args.get("season"), week=args.get("week")))[0]
    if name == "get_fantasy_leaders":
        pos = args.get("position")
        return (await _tool_fantasy(position=pos.upper() if pos else None, season=args.get("season")))[0]
    if name == "search_stats":
        return (await _tool_search(str(args.get("question", ""))))[0]
    return f"Unknown tool: {name}"


async def _llm_agent(messages: list[HistoryTurn]) -> tuple[str, list[AgentStep]]:
    from ..llm import get_client

    convo: list[dict] = [{"role": "system", "content": _SYSTEM}] + [
        {"role": m.role, "content": m.content} for m in messages
    ]
    steps: list[AgentStep] = []

    for _ in range(MAX_TOOL_STEPS):
        resp = await get_client().chat.completions.create(
            model=settings.sql_model,
            max_tokens=700,
            messages=convo,
            tools=_OPENAI_TOOLS,
        )
        choice = resp.choices[0].message
        if not choice.tool_calls:
            return (choice.content or "").strip(), steps

        convo.append(
            {
                "role": "assistant",
                "content": choice.content,
                "tool_calls": [tc.model_dump() for tc in choice.tool_calls],
            }
        )
        for tc in choice.tool_calls:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            try:
                result = await _call_tool(tc.function.name, args)
            except HTTPException as err:
                result = f"Tool error: {err.detail}"
            steps.append(AgentStep(tool=tc.function.name, summary=str(args) if args else "no args"))
            convo.append({"role": "tool", "tool_call_id": tc.id, "content": result[:6000]})

    return "I couldn't finish that one — try narrowing the question.", steps


# ------------------------------- Endpoint --------------------------------- #


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.post("", response_model=AgentResponse)
async def agent(req: AgentRequest, request: Request) -> AgentResponse:
    wait = await ratelimit.retry_after(_client_ip(request))
    if wait is not None:
        raise HTTPException(
            status_code=429,
            detail="Too many requests. Please slow down.",
            headers={"Retry-After": str(wait)},
        )

    last_user = next((m for m in reversed(req.messages) if m.role == "user"), None)
    if last_user is None:
        raise HTTPException(status_code=400, detail="No user message provided.")

    try:
        if settings.use_mock_llm:
            reply, steps = await _demo_agent(last_user.content)
            return AgentResponse(reply=reply, steps=steps, mode="demo")
        reply, steps = await _llm_agent(req.messages)
        return AgentResponse(reply=reply, steps=steps, mode="llm")
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001
        log.exception("agent error")
        raise HTTPException(status_code=500, detail="The assistant hit an error.")
