/** Templated narration — deterministic headlines from spec + rows, zero LLM.
 *
 * Narration legitimately reads across every intent's fields (the shared
 * postseason/qualifier tails), so it consumes the spec through the fields()
 * reader view rather than a narrowed node. All templates are runtime-guarded
 * by intent checks, byte-for-byte the behavior of the pre-split engine. */

import { fields, specLabel } from "./spec.js";
import type { FieldedSpec, QuerySpec } from "./spec.js";
import { compareOrderCol, statDef } from "./executors/shared.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** '2016-09-24' -> 'Sep 24, 2016' — string math, no timezone surprises. */
function fmtDate(v: unknown): string | null {
  const m = String(v ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** How a touchdown was scored, for narration. */
function tdHow(playType: unknown): string {
  const map: Record<string, string> = {
    pass: "receiving", run: "rushing", kickoff: "kick-return", punt: "punt-return",
  };
  return map[String(playType ?? "")] ?? "";
}

/** 1459 -> '1,459'; 112.3 stays '112.3'. */
function fmt(v: unknown): string {
  const n = Number(v ?? 0);
  return n % 1
    ? n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    : Math.trunc(n).toLocaleString("en-US");
}

/** Human phrasing for the game-level qualifiers on a spec. */
function qualifiers(spec: FieldedSpec): string {
  const parts: string[] = [];
  if (spec.sbOnly) parts.push("in the Super Bowl");
  if (spec.venue === "home") parts.push("at home");
  if (spec.venue === "away") parts.push("on the road");
  if (spec.weekMin != null && spec.weekMax != null && spec.weekMin === spec.weekMax) {
    parts.push(`in Week ${spec.weekMin}`);
  } else {
    if (spec.weekMin != null) parts.push(`from Week ${spec.weekMin} on`);
    if (spec.weekMax != null) parts.push(`through Week ${spec.weekMax}`);
  }
  if (spec.month != null && MONTHS_FULL[spec.month - 1]) {
    parts.push(`in ${MONTHS_FULL[spec.month - 1]}`);
  }
  if (spec.primetime) parts.push("in primetime");
  if (spec.tempMax != null) parts.push(`in ${spec.tempMax}°F or colder`);
  return parts.length ? ` ${parts.join(", ")}` : "";
}

type Row = Record<string, unknown>;

const ROMAN: [number, string][] = [
  [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"],
  [5, "V"], [4, "IV"], [1, "I"],
];
export function roman(n: number): string {
  let out = "";
  for (const [v, sym] of ROMAN) {
    while (n >= v) {
      out += sym;
      n -= v;
    }
  }
  return out;
}

/** "Super Bowl LIX" for the 2024 season; NFL kept "50" arabic. */
export function sbName(season: number): string {
  const num = season - 1965;
  return `Super Bowl ${num === 50 ? "50" : roman(num)}`;
}

/** Human phrase for a playoff round in a given season. */
function roundPhrase(round: string | null | undefined, season: unknown, conf?: string | null): string {
  const s = Number(season);
  if (round === "SB") return Number.isFinite(s) ? sbName(s) : "the Super Bowl";
  if (round === "CON") return `the ${conf ?? ""}${conf ? " " : ""}championship game`.replace("  ", " ");
  if (round === "DIV") return "the divisional round";
  if (round === "WC") return "the wild-card round";
  return "";
}

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th". */
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** 75 -> `6'3"`; null/0 -> null. */
function fmtHeight(inches: unknown): string | null {
  const n = Number(inches);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${Math.floor(n / 12)}'${n % 12}"`;
}

/** Bio narration: a player's card, or a bio-superlative headline. */
function narrateBio(spec: FieldedSpec, top: Row, name: string, rows: Row[] = [top]): string {
  if (spec.playerId && spec.bioField === "teams") {
    const span = (r: Row) =>
      r.first_season === r.last_season
        ? `${r.first_season}`
        : `${r.first_season}–${r.last_season}`;
    const list = rows
      .map((r) => `${r.team_name ?? r.team} (${span(r)})`)
      .join(", ");
    return rows.length === 1
      ? `${name} has played for one team in the warehouse: the ${list}.`
      : `${name} has played for ${rows.length} teams: ${list}.`;
  }
  if (spec.playerId && spec.bioField === "experience") {
    const n = Number(top.seasons ?? 0);
    return `${name} has ${n} season${n === 1 ? "" : "s"} in the warehouse, ${top.first_season}–${top.last_season}.`;
  }
  // Superlative board (no playerId): the top row is the answer.
  if (!spec.playerId) {
    const posText = spec.position ? ` ${spec.position}` : " player";
    if (spec.bioField === "height") {
      const which = spec.dir === "asc" ? "shortest" : "tallest";
      return `${top.full_name} is the ${which}${posText} at ${fmtHeight(top.height_inches)}${top.weight_lbs ? ` (${top.weight_lbs} lbs)` : ""}.`;
    }
    if (spec.bioField === "weight") {
      const which = spec.dir === "asc" ? "lightest" : "heaviest";
      return `${top.full_name} is the ${which}${posText} at ${top.weight_lbs} lbs${fmtHeight(top.height_inches) ? ` (${fmtHeight(top.height_inches)})` : ""}.`;
    }
    const which = spec.dir === "asc" ? "youngest" : "oldest";
    return `${top.full_name} is the ${which}${posText} at ${top.age} years old.`;
  }
  // Named player.
  const team = top.team_name ?? top.team;
  const h = fmtHeight(top.height_inches);
  switch (spec.bioField) {
    case "team":
      return team ? `${name} most recently played for the ${team}.` : `${name}'s team isn't in the warehouse.`;
    case "age": {
      const d = fmtDate(top.birth_date);
      return top.age != null ? `${name} is ${top.age} years old${d ? ` (born ${d})` : ""}.` : `${name}'s birth date isn't on file.`;
    }
    case "height":
      return h ? `${name} is ${h}${top.weight_lbs ? `, ${top.weight_lbs} lbs` : ""}.` : `${name}'s height isn't on file.`;
    case "weight":
      return top.weight_lbs ? `${name} weighs ${top.weight_lbs} lbs${h ? ` (${h})` : ""}.` : `${name}'s weight isn't on file.`;
    case "college":
      return top.college ? `${name} played college football at ${top.college}.` : `${name}'s college isn't on file.`;
    case "jersey":
      return top.jersey_number != null
        ? `${name} wears No. ${top.jersey_number}.`
        : `${name}'s jersey number isn't on file.`;
    default: {
      const bits: string[] = [];
      if (top.position) bits.push(String(top.position));
      if (h) bits.push(`${h}${top.weight_lbs ? `, ${top.weight_lbs} lbs` : ""}`);
      if (top.college) bits.push(String(top.college));
      if (top.age != null) bits.push(`${top.age} yrs`);
      return `${name}${team ? `, ${team}` : ""}${bits.length ? ` — ${bits.join(", ")}` : ""}.`;
    }
  }
}

/** W-L(-T) line over game rows that carry a `result` column. */
function recordOf(rows: Row[]): string {
  const w = rows.filter((r) => r.result === "W").length;
  const l = rows.filter((r) => r.result === "L").length;
  const ties = rows.filter((r) => r.result === "T").length;
  return `${w}-${l}${ties ? `-${ties}` : ""}`;
}

/** Templated headline — deterministic. Falls back gracefully on empty. */
export function narrate(spec0: QuerySpec, rows: Row[]): string {
  const spec = fields(spec0);
  if (rows.length === 0) {
    if (spec.intent === "game_result" || spec.intent === "team_game_log") {
      return "No completed games match that.";
    }
    if (spec.intent === "draft_pick") return "No draft pick matches that.";
    return "No matching results found.";
  }
  const top = rows[0]!;
  const label = specLabel(spec);
  const unit = statDef(spec).unit ?? "";
  const name = String(top.full_name ?? spec.player ?? "");

  if (spec.intent === "player_bio") return narrateBio(spec, top, name, rows);

  if (spec.intent === "team_bio") {
    const tn = String(top.name ?? spec.teamName ?? "That team");
    if (spec.teamField === "division") {
      // division already carries the conference prefix ("AFC West").
      return top.division
        ? `The ${tn} play in the ${top.division}.`
        : `The ${tn}'s division isn't on file.`;
    }
    if (spec.teamField === "conference") {
      return top.conference
        ? `The ${tn} play in the ${top.conference}.`
        : `The ${tn}'s conference isn't on file.`;
    }
    if (spec.teamField === "stadium") {
      return top.stadium
        ? `The ${tn} play their home games at ${top.stadium}.`
        : `The ${tn}'s stadium isn't on file.`;
    }
    if (spec.teamField === "coach") {
      // From the most recent home game — the warehouse's freshest signal.
      return top.coach
        ? `${top.coach} coached the ${tn} in their most recent home game on file.`
        : `The ${tn}'s coach isn't on file.`;
    }
    if (spec.teamField === "colors") {
      return top.color
        ? `The ${tn}'s colors are ${top.color}${top.color2 ? ` and ${top.color2}` : ""}.`
        : `The ${tn}'s colors aren't on file.`;
    }
    const bits: string[] = [];
    if (top.conference && top.division) bits.push(`${top.conference} ${top.division}`);
    if (top.stadium) bits.push(`home: ${top.stadium}`);
    return `The ${tn}${bits.length ? ` — ${bits.join(", ")}` : ""}.`;
  }

  if (spec.intent === "team_stat") {
    const tn = spec.teamName ?? "They";
    const what =
      spec.metric === "points_for" ? "points"
        : spec.metric === "points_against" ? "points allowed"
          : label;
    const post = spec.seasonType === "POST" ? " postseason" : "";
    const when =
      spec.seasonMin != null ? ` from ${spec.seasonMin} to ${spec.seasonMax}`
        : spec.season != null ? ` in ${spec.season}` : " since 1999";
    const games = Number(top.games ?? 0);
    if (spec.perGame) {
      return `The ${tn} averaged ${fmt(top.value)}${unit} ${what} per game${when}${post} (${games} games).`;
    }
    const verb = spec.metric === "points_against" ? "allowed" : "totaled";
    return `The ${tn} ${verb} ${fmt(top.value)}${unit}${post} ${spec.metric === "points_against" ? "points" : what}${when} (${games} games).`;
  }

  if (spec.intent === "team_roster") {
    const tn = spec.teamName ?? "That team";
    const size = Number(top.roster_size ?? rows.length);
    const posText = spec.position ? ` ${spec.position}s` : " players";
    const when = spec.season != null ? `${spec.season} ` : "";
    const names = rows.slice(0, 5).map((r) => r.full_name).join(", ");
    return `${size}${posText} appeared for the ${when}${tn}, led by ${names}.`;
  }

  if (spec.intent === "qualifying_count") {
    const n = Number(top.qualifying_players ?? 0);
    const opText = { ">": "over", ">=": "at least", "<": "under" }[spec.threshold!.op];
    const posText = spec.position ? ` ${spec.position}s` : " players";
    const when =
      spec.scope === "career" ? "in their career"
        : spec.season != null ? `in ${spec.season}` : "in a season";
    return `${fmt(n)}${posText} had ${opText} ${fmt(spec.threshold!.value)} ${label} ${when}.`;
  }

  if (spec.intent === "player_rank") {
    const rk = Number(top.rk);
    const tot = Number(top.total_players);
    const post = spec.seasonType === "POST" ? " postseason" : "";
    const scope =
      spec.seasonMin != null ? `from ${spec.seasonMin} to ${spec.seasonMax}`
        : spec.scope === "career" ? "all-time"
          : `in ${spec.season}`;
    return (
      `${name} ranks ${ordinal(rk)} ${scope}${post} in ${label} with ` +
      `${fmt(top.value)}${unit}${Number.isFinite(tot) && tot ? ` (of ${fmt(tot)} players)` : ""}.`
    );
  }

  if (spec.intent === "draft_pick") {
    const who = String(top.player_name);
    const where = `${top.position ? `${top.position}, ` : ""}${top.college ?? ""}`.replace(/, $/, "");
    if (spec.draftPick === 1) {
      return `${who} went first overall in the ${top.season} NFL draft, to the ${top.team_name ?? top.team}${where ? ` (${where})` : ""}.`;
    }
    if (spec.playerId || spec.player) {
      return `${who} was drafted by the ${top.team_name ?? top.team} at pick ${top.pick} overall (round ${top.round}) in ${top.season}${where ? ` (${where})` : ""}.`;
    }
    if (spec.teamId) {
      return `The ${top.team_name ?? top.team} made ${rows.length} pick${rows.length === 1 ? "" : "s"} in the ${top.season} draft, starting with ${who} at ${top.pick} overall.`;
    }
    return `${who} went ${top.pick} overall to the ${top.team_name ?? top.team} in ${top.season}.`;
  }

  if (spec.intent === "game_result") {
    // Neutral rows carry home/away names; team-perspective rows carry
    // opponent/result relative to the asked-about team.
    if (top.home_name !== undefined) {
      const hs = Number(top.home_score), as_ = Number(top.away_score);
      const [wn, ws, ln, ls] =
        hs >= as_
          ? [top.home_name, hs, top.away_name, as_]
          : [top.away_name, as_, top.home_name, hs];
      const where =
        roundPhrase(String(top.round), top.season, spec.conf) ||
        `Week ${top.week}, ${top.season}`;
      const when = fmtDate(top.game_date);
      const tail = rows.length > 1 ? ` Showing all ${rows.length} matching games.` : "";
      if (hs === as_) {
        return `The ${wn} and the ${ln} tied ${ws}-${ls} in ${where}${when ? ` (${when})` : ""}.${tail}`;
      }
      return `The ${wn} beat the ${ln} ${ws}-${ls} in ${where}${when ? ` (${when})` : ""}.${tail}`;
    }
    const teamName = spec.teamName ?? "They";
    const where =
      String(top.round) !== "REG"
        ? roundPhrase(String(top.round), top.season, spec.conf)
        : `Week ${top.week}, ${top.season}`;
    const when = fmtDate(top.game_date);
    const verb = top.result === "W" ? "beat" : top.result === "L" ? "lost to" : "tied";
    const line =
      `The ${teamName} ${verb} ${top.opponent} ${top.team_score}-${top.opp_score} ` +
      `in ${where}${when ? ` (${when})` : ""}.`;
    if (rows.length > 1) {
      return `${line} Showing the last ${rows.length} matchups (${recordOf(rows)} for the ${teamName}).`;
    }
    return line;
  }

  if (spec.intent === "team_game_log") {
    const teamName = spec.teamName ?? "They";
    let scope = spec.round
      ? spec.round === "SB"
        ? "in the Super Bowl"
        : `in ${roundPhrase(spec.round, null, spec.conf) || "the playoffs"}s`.replace("the ", "")
      : spec.seasonType === "POST"
        ? spec.season != null ? `in the ${spec.season} playoffs` : "in the playoffs"
        : spec.season != null
          ? `in the ${spec.season} regular season`
          : "since 1999";
    if (spec.marginMax != null) {
      scope = `in games decided by ${spec.marginMax} points or fewer ${spec.season != null ? `in ${spec.season}` : "since 1999"}`;
    }
    if (spec.lastN) scope = `over their last ${spec.lastN} games`;
    const latest = top;
    const verb = latest.result === "W" ? "beating" : latest.result === "L" ? "losing to" : "tying";
    const when = fmtDate(latest.game_date);
    return (
      `The ${teamName} are ${recordOf(rows)} ${scope}, most recently ` +
      `${verb} ${latest.opponent} ${latest.team_score}-${latest.opp_score}` +
      `${when ? ` (${when})` : ""}.`
    );
  }

  if (spec.intent === "player_seasons") {
    const poss = name.endsWith("s") ? `${name}'` : `${name}'s`;
    const first = Number(rows[rows.length - 1]!.season);
    const last = Number(top.season);
    return rows.length === 1
      ? `${poss} ${last} regular-season stats.`
      : `${poss} regular-season stats, season by season (${first}–${last}).`;
  }

  if (spec.intent === "game_log") {
    const post = spec.seasonType === "POST" && !spec.sbOnly && !spec.round ? " postseason" : "";
    const scope = spec.sbOnly || spec.round === "SB"
      ? " Super Bowl"
      : spec.round
        ? ` ${roundPhrase(spec.round, null, spec.conf).replace(/^the /, "")}`
        : post;
    const window = spec.lastN
      ? `last ${spec.lastN} games`
      : spec.firstN
        ? `first ${spec.firstN} games`
        : `${spec.season != null ? `${spec.season} ` : ""}game log`;
    const n = Number(top.games ?? rows.length);
    const poss = name.endsWith("s") ? `${name}'` : `${name}'s`;
    const quals = qualifiers({ ...spec, sbOnly: false }); // scope already says it
    const vsOpp = spec.opponentId ? ` against the ${spec.team2Name ?? spec.opponentId}` : "";
    return `${poss}${scope} ${window}${vsOpp}: ${n} game${n === 1 ? "" : "s"}${quals}.`;
  }
  // sbOnly already says "in the Super Bowl" via qualifiers.
  const post = spec.seasonType === "POST" && !spec.sbOnly ? " postseason" : "";
  const quals = qualifiers(spec);

  if (spec.intent === "compare") {
    const col = compareOrderCol(spec);
    const scope = spec.firstN
      ? `their first ${spec.firstN}${post} games`
      : spec.season
        ? `the ${spec.season}${post} season`
        : `their${post} careers`;
    const other = rows[1];
    if (!other || !other.games) {
      const missing = other ? other.full_name : spec.player2;
      return (
        `Over ${scope}, ${name} has ${fmt(top[col])} ${label} ` +
        `(${top.games} games); ${missing} has no${post} games in the warehouse.`
      );
    }
    if (Number(top[col] ?? 0) === Number(other[col] ?? 0)) {
      return `Dead even over ${scope}: both at ${fmt(top[col])} ${label}.`;
    }
    return (
      `Over ${scope}, ${name} leads ${other.full_name} in ${label}, ` +
      `${fmt(top[col])} to ${fmt(other[col])}.`
    );
  }

  if (spec.intent === "scoring") {
    const when = fmtDate(top.game_date);
    const at = when
      ? `on ${when} (Week ${top.week}, ${top.season})`
      : `in Week ${top.week}, ${top.season}`;
    const how = tdHow(top.play_type);
    const kind = `${how ? `${how} ` : ""}touchdown`;
    if (spec.edge === "first") {
      return `${name} scored his first${post} ${kind} ${at}, against ${top.opponent}.`;
    }
    if (spec.edge === "last") {
      return `${name}'s most recent${post} ${kind} came ${at}, against ${top.opponent}.`;
    }
    return (
      `${name}'s most recent${post} ${kind} came ${at}, against ${top.opponent}. ` +
      `Showing his last ${rows.length}.`
    );
  }

  if (spec.intent === "game_count") {
    const opText = { ">": "over", ">=": "at least", "<": "under" }[spec.threshold!.op];
    const n = Number(top.qualifying_games ?? rows.length);
    const scope = spec.season ? `${spec.season}${post}` : `career${post}`;
    return (
      `${name} has ${n} ${scope} game${n === 1 ? "" : "s"} with ${opText} ` +
      `${spec.threshold!.value} ${label}${quals}.`
    );
  }

  if (spec.intent === "player_total" && spec.perGame) {
    const v = top.total !== undefined ? top.total : top.value;
    const scope =
      spec.seasonMin != null ? `from ${spec.seasonMin} to ${spec.seasonMax}`
        : spec.scope === "career" ? "over his career"
          : `in ${top.season ?? spec.season}`;
    return `${name} averaged ${fmt(v)}${unit} ${label} per game ${scope}${post}${quals}.`;
  }
  if (spec.intent === "player_total" && spec.seasonMin != null) {
    return `${name} had ${fmt(top.total)}${unit}${post} ${label} from ${spec.seasonMin} to ${spec.seasonMax}${quals}.`;
  }
  if (spec.intent === "player_total" && (spec.firstN || spec.lastN)) {
    const window = spec.firstN ? `first ${spec.firstN}` : `last ${spec.lastN}`;
    return `${name} totaled ${fmt(top.total)}${unit} ${label} over his ${window}${post} games${quals}.`;
  }
  if (spec.intent === "player_total" && spec.rookie) {
    return `${name} had ${fmt(top.value)}${unit} ${label} as a rookie in ${top.season}.`;
  }
  if (spec.intent === "player_total" && top.total !== undefined && spec.season != null) {
    return `${name} had ${fmt(top.total)}${unit}${post} ${label} in ${spec.season}${quals}.`;
  }
  if (spec.intent === "player_total" && (spec.scope === "career" || top.total !== undefined)) {
    return `${name} has ${fmt(top.total)}${unit} career${post} ${label}${quals}.`;
  }
  if (spec.intent === "player_total") {
    return `${name} had ${fmt(top.value)}${unit}${post} ${label} in ${top.season}${quals}.`;
  }
  if (spec.intent === "single_game") {
    return (
      `${name} has the top single-game${post} mark with ${top.value} ` +
      `${label}, against ${top.opponent} in Week ${top.week}, ${top.season}.`
    );
  }
  // leaders
  const forTeam = spec.teamName ? ` the ${spec.teamName}` : "";
  const posText = spec.position ? ` among ${spec.position}s` : "";
  const rate = spec.perGame ? " per game" : "";
  const verb = spec.dir === "asc" ? "has the fewest" : "leads";
  if (spec.scope === "career" && spec.seasonMin != null) {
    return `${name} ${verb === "leads" ? "leads" : "has the fewest"}${forTeam} with ${fmt(top.value)}${unit}${post} ${label}${rate}${posText} from ${spec.seasonMin} to ${spec.seasonMax}.`;
  }
  if (spec.scope === "career") {
    return `${name} ${verb === "leads" ? `leads${forTeam} all time` : "has the fewest all time"} with ${fmt(top.value)}${unit} career${post} ${label}${rate}${posText}.`;
  }
  const season = top.season ?? spec.season;
  const where = season && post ? ` in the ${season} postseason` : season ? ` in ${season}` : "";
  if (spec.dir === "asc") {
    return `${name} has the fewest ${label}${rate}${posText}${forTeam ? ` for${forTeam}` : ""}${where}${quals} (min. 8 games) at ${fmt(top.value)}${unit}.`;
  }
  return `${name} leads${forTeam}${posText} with ${fmt(top.value)}${unit} ${label}${rate}${where}${quals}${spec.rookie ? " among rookies" : ""}.`;
}
