/** nflverse -> warehouse load pipelines.
 *
 * Flow per pipeline: fetch (providers/nflverse) -> reshape -> normalize ->
 * validate -> upsert. Pipelines are idempotent (INSERT ... ON CONFLICT), so
 * partial or repeated runs never corrupt data; incremental season updates
 * just re-run the season.
 */

import {
  float, int, str, team, SEASON_TYPE, TEAM_MAP,
  draftPickRow, gameRow, playerGameStatsRow, playerRow, playerSeasonStatsRow,
  playerGameAdvancedRow, scoringPlayRow, seasonRow, teamGameStatsRow, teamRow,
  playerIdsRow, tradeRow, injuryRow, depthChartRow, snapCountRow,
  mapPlayerIds, mapTrade, mapInjury, mapDepthChart, mapSnapCount,
  type GsisByPfr,
} from "./normalize.js";
import { logger } from "../lib/logger.js";
import type { Ctx } from "./context.js";
import { upsert } from "./upsert.js";
import { allRows, assets, rows as streamRows } from "./providers/nflverse.js";
import type { CsvRow } from "./providers/nflverse.js";

/** Guard against upstream schema drift. A pipeline reads columns by name; if
 * nflverse renames one, the coercers silently return null and summed stats
 * fabricate zeros — corrupt data with exit code 0. So verify the columns are
 * still there before mapping: missing IDENTITY columns fail the run (the rows
 * would be structurally wrong); missing STAT columns warn loudly (the values
 * would be null/zero), so drift is never silent. */
export function checkColumns(
  sample: CsvRow | undefined,
  asset: string,
  identity: string[],
  stats: string[] = [],
): void {
  if (!sample) return; // empty asset is handled by the pipelines downstream
  const have = new Set(Object.keys(sample));
  const missingId = identity.filter((c) => !have.has(c));
  if (missingId.length > 0) {
    throw new Error(
      `${asset}: upstream schema drift — missing required columns ` +
        `[${missingId.join(", ")}]. Refusing to ingest (rows would be corrupt); ` +
        `update the pipeline mapping in ingest/pipelines.ts.`,
    );
  }
  const missingStats = stats.filter((c) => !have.has(c));
  if (missingStats.length > 0) {
    logger.warn(
      { asset, missing: missingStats },
      `${asset}: expected stat columns absent — those values will be null/zero. ` +
        "Likely upstream rename; check the pipeline mapping.",
    );
  }
}

export async function loadTeams(ctx: Ctx): Promise<number> {
  const raw = await allRows(assets.teams());
  let rows = raw.map((r) => ({
    team_id: r.team_abbr ?? "",
    name: r.team_name ?? "",
    nickname: str(r.team_nick),
    conference: str(r.team_conf),
    division: str(r.team_division),
    color: str(r.team_color),
    color2: str(r.team_color2),
  }));
  rows = ctx.drop(
    rows,
    (r) => !(r.team_id in TEAM_MAP),
    "teams",
    "historical abbr — franchise continues under its current id",
    (r) => r.team_id,
  );
  return upsert(ctx, "teams", rows, ["team_id"], teamRow);
}

export async function loadSeasons(ctx: Ctx, years: number[]): Promise<number> {
  return upsert(ctx, "seasons", years.map((season) => ({ season })), ["season"], seasonRow);
}

export async function loadPlayers(ctx: Ctx, years: number[]): Promise<number> {
  const raw: CsvRow[] = [];
  for (const year of years) raw.push(...(await allRows(assets.rosters(year))));

  checkColumns(raw[0], "rosters", ["gsis_id", "full_name", "season"],
    ["position", "birth_date", "height", "weight"]);

  let rows = raw.map((r) => ({
    player_id: r.gsis_id ?? "",
    full_name: r.full_name ?? "",
    first_name: str(r.first_name),
    last_name: str(r.last_name),
    position: str(r.position),
    birth_date: str(r.birth_date),
    height_inches: int(r.height),
    weight_lbs: int(r.weight),
    college: str(r.college),
    jersey_number: int(r.jersey_number),
    _season: int(r.season) ?? 0,
  }));
  rows = ctx.drop(rows, (r) => r.player_id !== "", "players",
    "roster row without a stable gsis id", (r) => r.full_name);
  rows = ctx.drop(rows, (r) => r.full_name !== "", "players",
    "roster row without a name", (r) => r.player_id);
  // One row per player per season: keep the newest (current team era wins).
  rows.sort((a, b) => a._season - b._season);
  const players = rows.map(({ _season, ...rest }) => rest);
  return upsert(ctx, "players", players, ["player_id"], playerRow);
}

async function schedules(years: number[]): Promise<CsvRow[]> {
  const all = await allRows(assets.schedules());
  const wanted = new Set(years);
  return all.filter((r) => wanted.has(Number(r.season)));
}

export async function loadGames(ctx: Ctx, years: number[]): Promise<number> {
  const sched = await schedules(years);
  let rows = sched.map((r) => ({
    game_id: r.game_id ?? "",
    season: int(r.season) ?? 0,
    week: int(r.week) ?? 0,
    season_type: SEASON_TYPE[r.game_type ?? ""] ?? "",
    game_date: str(r.gameday),
    home_team: team(r.home_team ?? ""),
    away_team: team(r.away_team ?? ""),
    home_score: int(r.home_score),
    away_score: int(r.away_score),
    stadium: str(r.stadium),
    roof: str(r.roof),
    surface: str(r.surface),
    weekday: str(r.weekday),
    gametime: str(r.gametime),
    temp: int(r.temp),
    wind: int(r.wind),
    home_coach: str(r.home_coach),
    away_coach: str(r.away_coach),
  }));
  // The warehouse only models REG and POST; preseason ("PRE") and unrecognized
  // game types are excluded. Dropping PRE here also stops it from colliding
  // with regular-season week numbers in gameIdLookup.
  rows = ctx.drop(rows, (r) => r.season_type === "REG" || r.season_type === "POST", "games",
    `not a REG/POST game (preseason / unrecognized game_type; known: ${Object.keys(SEASON_TYPE).sort().join(", ")})`,
    (r) => r.game_id);
  const teams = await ctx.known("teams", "team_id");
  rows = ctx.drop(rows, (r) => teams.has(r.home_team) && teams.has(r.away_team),
    "games", "unknown team id", (r) => r.game_id);
  const unplayed = rows.filter((r) => r.home_score === null).length;
  if (unplayed) logger.info({ unplayed }, "games: unplayed/postponed games kept with null scores");
  if (ctx.seasonType) rows = rows.filter((r) => r.season_type === ctx.seasonType);
  return upsert(ctx, "games", rows, ["game_id"], gameRow);
}

/** Map (season|week|team) -> canonical game_id from the schedule; each game
 * contributes both sides, so away players resolve to the right game. Team ids
 * are normalized the same way as everywhere else. */
async function gameIdLookup(years: number[]): Promise<Map<string, string>> {
  const lookup = new Map<string, string>();
  for (const r of await schedules(years)) {
    // season_type is part of the key: preseason and regular-season share week
    // numbers (both start at week 1), so without it a PRE game would overwrite
    // the REG game for the same (season, week, team) and mis-attribute stats.
    const st = SEASON_TYPE[r.game_type ?? ""] ?? "";
    const key = (t: string) => `${Number(r.season)}|${Number(r.week)}|${team(t)}|${st}`;
    lookup.set(key(r.home_team ?? ""), r.game_id ?? "");
    lookup.set(key(r.away_team ?? ""), r.game_id ?? "");
  }
  return lookup;
}

export async function loadPlayerGameStats(ctx: Ctx, years: number[]): Promise<number> {
  const lookup = await gameIdLookup(years);
  const raw: CsvRow[] = [];
  for (const year of years) raw.push(...(await allRows(assets.weeklyStats(year))));

  checkColumns(
    raw[0],
    "stats_player_week",
    ["player_id", "season", "week", "team", "season_type"],
    [
      "completions", "attempts", "passing_yards", "passing_tds", "passing_interceptions",
      "carries", "rushing_yards", "rushing_tds", "targets", "receptions",
      "receiving_yards", "receiving_tds", "fantasy_points_ppr",
      "def_tackles_solo", "def_sacks", "def_interceptions",
    ],
  );

  const sum3 = (a: string | undefined, b: string | undefined, c: string | undefined) =>
    (int(a) ?? 0) + (int(b) ?? 0) + (int(c) ?? 0);

  let rows = raw
    .filter((r) => {
      // REG/POST only (drop preseason even when no --season-type is given, or
      // it leaks into player_game_stats and inflates totals against games).
      const st = SEASON_TYPE[r.season_type ?? ""] ?? "";
      return ctx.seasonType ? st === ctx.seasonType : st === "REG" || st === "POST";
    })
    .map((r) => {
      const tid = team(r.team ?? "");
      const st = SEASON_TYPE[r.season_type ?? ""] ?? "";
      return {
        player_id: r.player_id ?? "",
        game_id: lookup.get(`${Number(r.season)}|${Number(r.week)}|${tid}|${st}`) ?? "",
        team_id: tid,
        completions: int(r.completions),
        attempts: int(r.attempts),
        passing_yards: int(r.passing_yards),
        passing_tds: int(r.passing_tds),
        interceptions: int(r.passing_interceptions),
        sacks: float(r.sacks_suffered),
        carries: int(r.carries),
        rushing_yards: int(r.rushing_yards),
        rushing_tds: int(r.rushing_tds),
        targets: int(r.targets),
        receptions: int(r.receptions),
        receiving_yards: int(r.receiving_yards),
        receiving_tds: int(r.receiving_tds),
        fumbles: sum3(r.sack_fumbles, r.rushing_fumbles, r.receiving_fumbles),
        fumbles_lost: sum3(r.sack_fumbles_lost, r.rushing_fumbles_lost, r.receiving_fumbles_lost),
        fantasy_points_ppr: float(r.fantasy_points_ppr),
        sack_yards: int(r.sack_yards_lost),
        tackles: (int(r.def_tackles_solo) ?? 0) + (int(r.def_tackle_assists) ?? 0),
        def_sacks: float(r.def_sacks),
        def_interceptions: int(r.def_interceptions),
        forced_fumbles: int(r.def_fumbles_forced),
        passes_defended: int(r.def_pass_defended),
        passing_air_yards: int(r.passing_air_yards),
        receiving_air_yards: int(r.receiving_air_yards),
      };
    });

  rows = ctx.drop(rows, (r) => r.player_id !== "", "player_game_stats",
    "missing player id", (r) => r.game_id);
  rows = ctx.drop(rows, (r) => r.game_id !== "", "player_game_stats",
    "no schedule game for (season, week, team)", (r) => r.player_id);
  const players = await ctx.known("players", "player_id");
  rows = ctx.drop(rows, (r) => players.has(r.player_id), "player_game_stats",
    "player not in players dimension", (r) => r.player_id);
  const teams = await ctx.known("teams", "team_id");
  rows = ctx.drop(rows, (r) => teams.has(r.team_id), "player_game_stats",
    "unknown team id", (r) => r.player_id);
  const games = await ctx.known("games", "game_id");
  rows = ctx.drop(rows, (r) => games.has(r.game_id), "player_game_stats",
    "game not ingested (run games first)", (r) => r.game_id);
  return upsert(ctx, "player_game_stats", rows, ["player_id", "game_id"], playerGameStatsRow);
}

export async function loadPlayerSeasonStats(ctx: Ctx, years: number[]): Promise<number> {
  const levels = (["reg", "post"] as const).filter(
    (lvl) => !ctx.seasonType || ctx.seasonType === (lvl === "reg" ? "REG" : "POST"),
  );
  let rows: Record<string, unknown>[] = [];
  for (const year of years) {
    for (const level of levels) {
      const raw = await allRows(assets.seasonStats(year, level));
      rows.push(
        ...raw.map((r) => ({
          player_id: r.player_id ?? "",
          season: year,
          season_type: level === "reg" ? "REG" : "POST",
          team_id: r.recent_team ? team(r.recent_team) : null,
          games_played: int(r.games),
          passing_yards: int(r.passing_yards),
          passing_tds: int(r.passing_tds),
          interceptions: int(r.passing_interceptions),
          rushing_yards: int(r.rushing_yards),
          rushing_tds: int(r.rushing_tds),
          receptions: int(r.receptions),
          receiving_yards: int(r.receiving_yards),
          receiving_tds: int(r.receiving_tds),
          fantasy_points_ppr: float(r.fantasy_points_ppr),
          completions: int(r.completions),
          attempts: int(r.attempts),
          sacks: float(r.sacks_suffered),
          sack_yards: int(r.sack_yards_lost),
          fumbles:
            (int(r.sack_fumbles) ?? 0) + (int(r.rushing_fumbles) ?? 0) + (int(r.receiving_fumbles) ?? 0),
          fumbles_lost:
            (int(r.sack_fumbles_lost) ?? 0) +
            (int(r.rushing_fumbles_lost) ?? 0) +
            (int(r.receiving_fumbles_lost) ?? 0),
          tackles: (int(r.def_tackles_solo) ?? 0) + (int(r.def_tackle_assists) ?? 0),
          def_sacks: float(r.def_sacks),
          def_interceptions: int(r.def_interceptions),
          forced_fumbles: int(r.def_fumbles_forced),
          passes_defended: int(r.def_pass_defended),
        })),
      );
    }
  }
  rows = ctx.drop(rows, (r) => r.player_id !== "", "player_season_stats",
    "missing player id", (r) => String(r.season));
  const players = await ctx.known("players", "player_id");
  rows = ctx.drop(rows, (r) => players.has(r.player_id as string), "player_season_stats",
    "player not in players dimension", (r) => String(r.player_id));
  return upsert(
    ctx, "player_season_stats", rows, ["player_id", "season", "season_type"],
    playerSeasonStatsRow,
  );
}

export async function loadTeamGameStats(ctx: Ctx, years: number[]): Promise<number> {
  let sched = await schedules(years);
  if (ctx.seasonType) {
    sched = sched.filter((r) => SEASON_TYPE[r.game_type ?? ""] === ctx.seasonType);
  }
  const unplayed = sched.filter((r) => int(r.home_score) === null || int(r.away_score) === null);
  if (unplayed.length) {
    logger.info(
      { count: unplayed.length },
      "team_game_stats: unplayed/postponed games skipped (no score yet)",
    );
  }
  const finals = sched.filter((r) => int(r.home_score) !== null && int(r.away_score) !== null);

  const side = (r: CsvRow, home: boolean) => {
    const pf = int(home ? r.home_score : r.away_score)!;
    const pa = int(home ? r.away_score : r.home_score)!;
    return {
      team_id: team((home ? r.home_team : r.away_team) ?? ""),
      game_id: r.game_id ?? "",
      is_home: home,
      points_for: pf,
      points_against: pa,
      result: (pf > pa ? "W" : pf < pa ? "L" : "T") as "W" | "L" | "T",
    };
  };
  let rows = finals.flatMap((r) => [side(r, true), side(r, false)]);

  const teams = await ctx.known("teams", "team_id");
  rows = ctx.drop(rows, (r) => teams.has(r.team_id), "team_game_stats",
    "unknown team id", (r) => r.game_id);
  const games = await ctx.known("games", "game_id");
  rows = ctx.drop(rows, (r) => games.has(r.game_id), "team_game_stats",
    "game not ingested (run games first)", (r) => r.game_id);
  return upsert(ctx, "team_game_stats", rows, ["team_id", "game_id"], teamGameStatsRow);
}

const SCORING_BATCH = 5_000;

/** Touchdown events distilled from play-by-play (~50k plays/season stream to
 * ~1.5k scoring rows). Streamed per year; each batch commits independently. */
export async function loadScoringPlays(ctx: Ctx, years: number[]): Promise<number> {
  let total = 0;
  const games = await ctx.known("games", "game_id");
  const players = await ctx.known("players", "player_id");
  const teams = await ctx.known("teams", "team_id");

  for (const year of years) {
    let batch: Record<string, unknown>[] = [];

    const flush = async () => {
      let rows = batch;
      batch = [];
      rows = ctx.drop(rows, (r) => games.has(r.game_id as string), "scoring_plays",
        "game not ingested (run games first)", (r) => String(r.game_id));
      rows = ctx.drop(rows, (r) => players.has(r.player_id as string), "scoring_plays",
        "scorer not in players dimension", (r) => String(r.player_id));
      total += await upsert(ctx, "scoring_plays", rows, ["play_id"], scoringPlayRow);
    };

    // Advanced aggregates accumulated over the same stream: per-player-game
    // EPA / success / CPOE by role, and per-team-game drive counts.
    type Adv = Record<string, number>;
    const adv = new Map<string, Adv>();
    const drives = new Map<string, Set<string>>();
    const bump = (pid: string | undefined, gid: string, tid: string | null, role: "pass" | "rush" | "recv", r: CsvRow) => {
      if (!pid || !players.has(pid)) return;
      const epa = float(r.epa);
      if (epa == null) return;
      const key = `${pid}|${gid}`;
      const a = adv.get(key) ?? { _t: 0 };
      (a as Record<string, unknown>).player_id = pid;
      (a as Record<string, unknown>).game_id = gid;
      (a as Record<string, unknown>).team_id = tid;
      a[`${role}_plays`] = (a[`${role}_plays`] ?? 0) + 1;
      a[`${role}_epa`] = (a[`${role}_epa`] ?? 0) + epa;
      a[`${role}_success`] = (a[`${role}_success`] ?? 0) + (r.success === "1" ? 1 : 0);
      if (role === "pass") {
        const cpoe = float(r.cpoe);
        if (cpoe != null) {
          a.cpoe_sum = (a.cpoe_sum ?? 0) + cpoe;
          a.cpoe_n = (a.cpoe_n ?? 0) + 1;
        }
      }
      adv.set(key, a);
    };

    for await (const r of streamRows(assets.pbp(year))) {
      if (ctx.seasonType && SEASON_TYPE[r.season_type ?? ""] !== ctx.seasonType) continue;
      const gid = r.game_id ?? "";
      if (games.has(gid)) {
        const posteam = r.posteam ? team(r.posteam) : null;
        const tid = posteam && teams.has(posteam) ? posteam : null;
        bump(r.passer_player_id, gid, tid, "pass", r);
        bump(r.rusher_player_id, gid, tid, "rush", r);
        bump(r.receiver_player_id, gid, tid, "recv", r);
        if (tid && r.drive) {
          const dkey = `${tid}|${gid}`;
          const set = drives.get(dkey) ?? new Set<string>();
          set.add(r.drive);
          drives.set(dkey, set);
        }
      }
      if (r.touchdown !== "1" || !r.td_player_id) continue;
      const tdTeam = r.td_team ? team(r.td_team) : null;
      batch.push({
        play_id: `${r.game_id}_${int(r.play_id)}`,
        game_id: gid,
        player_id: r.td_player_id,
        team_id: tdTeam && teams.has(tdTeam) ? tdTeam : null,
        qtr: int(r.qtr),
        play_type: str(r.play_type),
        description: str(r.desc),
        yards: int(r.yards_gained),
      });
      if (batch.length >= SCORING_BATCH) await flush();
    }
    await flush();

    // Round EPA/CPOE sums and fill the full column set for the row schema.
    const advRows = [...adv.values()].map((a) => {
      const o = a as Record<string, unknown>;
      const num = (k: string) => (a[k] != null ? Math.round((a[k] as number) * 1000) / 1000 : null);
      return {
        player_id: o.player_id, game_id: o.game_id, team_id: o.team_id ?? null,
        pass_plays: a.pass_plays ?? null, pass_epa: num("pass_epa"),
        pass_success: a.pass_success ?? null,
        cpoe_sum: num("cpoe_sum"), cpoe_n: a.cpoe_n ?? null,
        rush_plays: a.rush_plays ?? null, rush_epa: num("rush_epa"),
        rush_success: a.rush_success ?? null,
        recv_plays: a.recv_plays ?? null, recv_epa: num("recv_epa"),
        recv_success: a.recv_success ?? null,
      };
    });
    total += await upsert(
      ctx, "player_game_advanced", advRows, ["player_id", "game_id"], playerGameAdvancedRow,
    );

    // Drive counts land as an UPDATE — the team_game_stats rows already exist.
    if (!ctx.dryRun && drives.size > 0) {
      const entries = [...drives.entries()];
      const params: unknown[] = [];
      const values = entries
        .map(([k, set]) => {
          const [tid, gid] = k.split("|");
          params.push(tid, gid, set.size);
          return `($${params.length - 2}, $${params.length - 1}, $${params.length}::int)`;
        })
        .join(", ");
      await ctx.pool.query(
        `UPDATE team_game_stats t SET drives = v.drives
         FROM (VALUES ${values}) AS v(team_id, game_id, drives)
         WHERE t.team_id = v.team_id AND t.game_id = v.game_id`,
        params,
      );
    }
    logger.info({ year, advanced: advRows.length }, "scoring_plays + advanced: season complete");
  }
  return total;
}

/** Full draft history in one small file — always loaded whole, regardless of
 * the requested seasons (the draft runs ahead of the stats warehouse). */
export async function loadDraftPicks(ctx: Ctx): Promise<number> {
  const raw = await allRows(assets.draftPicks());
  let rows = raw.map((r) => ({
    season: int(r.season) ?? 0,
    round: int(r.round) ?? 0,
    pick: int(r.pick) ?? 0,
    team_id: team(r.team ?? ""),
    player_id: str(r.gsis_id),
    player_name: str(r.pfr_player_name) ?? "",
    position: str(r.position),
    college: str(r.college),
  }));
  rows = ctx.drop(rows, (r) => r.player_name !== "", "draft_picks",
    "pick without a player name (forfeited/unassigned)", (r) => `${r.season} #${r.pick}`);
  rows = ctx.drop(rows, (r) => r.round >= 1 && r.pick >= 1, "draft_picks",
    "missing round/pick number", (r) => r.player_name);
  return upsert(ctx, "draft_picks", rows, ["season", "pick"], draftPickRow);
}

// ===========================================================================
// P0 datasets: cross-source ID crosswalk + trades / injuries / depth / snaps.
// ===========================================================================

/** Fetch a per-season asset across many years, tolerating seasons the dataset
 * doesn't publish (a 404 below its floor is expected — the worker clamps to
 * the floor, but this stays defensive). Non-404 errors still fail the run so a
 * network outage is never silently swallowed. */
async function allRowsForYears(
  asset: (year: number) => string,
  years: number[],
  dataset: string,
): Promise<CsvRow[]> {
  const out: CsvRow[] = [];
  for (const year of years) {
    try {
      out.push(...(await allRows(asset(year))));
    } catch (err) {
      if (String(err).includes("404")) {
        logger.warn({ dataset, year }, `${dataset}: season file not published — skipping`);
        continue;
      }
      throw err;
    }
  }
  return out;
}

/** pfr_id -> gsis player_id, read from the already-loaded player_ids crosswalk.
 * Used to resolve datasets that key players by PFR id (trades, snap counts)
 * onto the warehouse's gsis id. Empty if player_ids hasn't been loaded yet
 * (then those player_id columns stay null — they are nullable by design). */
async function pfrToGsis(ctx: Ctx): Promise<GsisByPfr> {
  const map: GsisByPfr = new Map();
  try {
    const res = await ctx.pool.query(
      "SELECT pfr_id, player_id FROM player_ids WHERE pfr_id IS NOT NULL",
    );
    for (const row of res.rows) map.set(String(row.pfr_id), String(row.player_id));
  } catch (err) {
    if ((err as { code?: string }).code !== "42P01") throw err; // table not migrated yet
  }
  return map;
}

/** The nflverse players master — the cross-source id crosswalk (gsis <-> pfr,
 * espn, pff, otc, esb, smart, nfl). One all-history file. Only players present
 * in the loaded `players` dimension are kept (player_ids FK -> players), so run
 * `players` for the seasons you care about first. */
export async function loadPlayerIds(ctx: Ctx): Promise<number> {
  const raw = await allRows(assets.players());
  checkColumns(raw[0], "players", ["gsis_id"],
    ["pfr_id", "espn_id", "pff_id", "otc_id", "esb_id", "smart_id"]);
  let rows = raw.map(mapPlayerIds);
  rows = ctx.drop(rows, (r) => r.player_id !== "", "player_ids",
    "players master row without a gsis id", (r) => String(r.pfr_id ?? r.esb_id));
  const players = await ctx.known("players", "player_id");
  rows = ctx.drop(rows, (r) => players.has(r.player_id), "player_ids",
    "player not in players dimension (load rosters for the season first)",
    (r) => r.player_id);
  return upsert(ctx, "player_ids", rows, ["player_id"], playerIdsRow);
}

/** All NFL trades (nflverse, 2002+). One row per asset moved; asset_id is a
 * deterministic surrogate so re-runs are idempotent. player_id (gsis) is
 * resolved from pfr_id via the id crosswalk when available. */
export async function loadTrades(ctx: Ctx): Promise<number> {
  const raw = await allRows(assets.trades());
  checkColumns(raw[0], "trades", ["trade_id", "gave", "received"],
    ["pfr_id", "pick_round", "pick_number"]);
  const gsisByPfr = await pfrToGsis(ctx);
  let rows = raw.map((r) => mapTrade(r, gsisByPfr));
  rows = ctx.drop(rows, (r) => r.trade_id !== 0, "trades",
    "row without a trade id", (r) => r.asset_id);
  return upsert(ctx, "trades", rows, ["asset_id"], tradeRow);
}

/** Weekly injury reports (nflverse, 2009+). Keyed by (player, season,
 * game_type, week, team). Rows for players missing from the dimension or
 * outside REG/POST are dropped and logged. */
export async function loadInjuries(ctx: Ctx, years: number[]): Promise<number> {
  const raw = await allRowsForYears(assets.injuries, years, "injuries");
  checkColumns(raw[0], "injuries", ["gsis_id", "season", "week", "team", "game_type"],
    ["report_status", "practice_status", "report_primary_injury"]);
  let rows = raw.map(mapInjury);
  rows = ctx.drop(rows, (r) => r.player_id !== "", "injuries",
    "injury row without a gsis id", (r) => String(r.team));
  rows = ctx.drop(rows, (r) => r.game_type === "REG" || r.game_type === "POST", "injuries",
    "not a REG/POST report", (r) => String(r.player_id));
  const players = await ctx.known("players", "player_id");
  rows = ctx.drop(rows, (r) => players.has(r.player_id as string), "injuries",
    "player not in players dimension", (r) => String(r.player_id));
  return upsert(ctx, "injuries", rows,
    ["player_id", "season", "game_type", "week", "team"], injuryRow);
}

/** Weekly depth charts (nflverse, 2001+). Keyed by (player, season, game_type,
 * week, team, position). depth_team 1 = starter, 2 = backup, ... */
export async function loadDepthCharts(ctx: Ctx, years: number[]): Promise<number> {
  const raw = await allRowsForYears(assets.depthCharts, years, "depth_charts");
  checkColumns(raw[0], "depth_charts",
    ["gsis_id", "season", "week", "club_code", "game_type", "position"],
    ["depth_team", "formation", "depth_position"]);
  let rows = raw.map(mapDepthChart);
  rows = ctx.drop(rows, (r) => r.player_id !== "", "depth_charts",
    "depth chart row without a gsis id", (r) => String(r.team));
  rows = ctx.drop(rows, (r) => r.position !== "", "depth_charts",
    "depth chart row without a position", (r) => String(r.player_id));
  rows = ctx.drop(rows, (r) => r.game_type === "REG" || r.game_type === "POST", "depth_charts",
    "not a REG/POST depth chart", (r) => String(r.player_id));
  const players = await ctx.known("players", "player_id");
  rows = ctx.drop(rows, (r) => players.has(r.player_id as string), "depth_charts",
    "player not in players dimension", (r) => String(r.player_id));
  return upsert(ctx, "depth_charts", rows,
    ["player_id", "season", "game_type", "week", "team", "position"], depthChartRow);
}

/** Per-game snap counts (nflverse, 2012+). Keyed by (pfr_player_id, game_id);
 * game_id matches the schedule (FK -> games). player_id (gsis) is resolved
 * from pfr_player_id via the id crosswalk when available. */
export async function loadSnapCounts(ctx: Ctx, years: number[]): Promise<number> {
  const raw = await allRowsForYears(assets.snapCounts, years, "snap_counts");
  checkColumns(raw[0], "snap_counts",
    ["pfr_player_id", "game_id", "season", "week", "team", "game_type"],
    ["offense_snaps", "defense_snaps", "st_snaps"]);
  const gsisByPfr = await pfrToGsis(ctx);
  let rows = raw.map((r) => mapSnapCount(r, gsisByPfr));
  rows = ctx.drop(rows, (r) => r.pfr_player_id !== "", "snap_counts",
    "row without a pfr player id", (r) => String(r.game_id));
  rows = ctx.drop(rows, (r) => r.game_id !== "", "snap_counts",
    "row without a game id", (r) => String(r.pfr_player_id));
  rows = ctx.drop(rows, (r) => r.game_type === "REG" || r.game_type === "POST", "snap_counts",
    "not a REG/POST game", (r) => String(r.pfr_player_id));
  const games = await ctx.known("games", "game_id");
  rows = ctx.drop(rows, (r) => games.has(r.game_id as string), "snap_counts",
    "game not ingested (run games first)", (r) => String(r.game_id));
  return upsert(ctx, "snap_counts", rows, ["pfr_player_id", "game_id"], snapCountRow);
}
