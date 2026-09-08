"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import type { GamePlay, GamePlaysResponse } from "../lib/api";
import { teamTheme } from "../lib/teamTheme";
import { TeamLogo } from "./TeamLogo";

/* ----------------------------------------------------------------------------
 * Field geometry. The SVG is 120 × 53.3 yards at 10 units per yard: end zones
 * at 0–100 and 1100–1200, the playing field between. Every play is drawn in
 * the possession team's frame, driving left → right, which is the frame
 * nflverse reports yardline_100 in (yards to the goal line being attacked).
 * -------------------------------------------------------------------------- */

const YARD = 10;
const W = 120 * YARD;
const H = Math.round(53.3 * YARD);
const GOAL_L = 10 * YARD; // left goal line
const GOAL_R = 110 * YARD; // right goal line
const MID_Y = H / 2;
// NFL hash marks sit 70'9" from each sideline.
const HASH_Y = [Math.round(23.58 * YARD), H - Math.round(23.58 * YARD)];

/** x of a field position given yards from the offense's own goal line. */
const fieldX = (yardsFromOwnGoal: number): number =>
  GOAL_L + Math.max(-10, Math.min(110, yardsFromOwnGoal)) * YARD;

/** Lateral lane for a pass or run direction. Gap refines a run: "end" is the
 * outside lane, "guard" nearly the middle. */
function laneY(
  side: "left" | "middle" | "right" | null,
  gap: "end" | "tackle" | "guard" | null,
): number {
  if (!side || side === "middle") return MID_Y;
  const spread = gap === "end" ? 0.42 : gap === "tackle" ? 0.3 : gap === "guard" ? 0.16 : 0.26;
  return side === "left" ? MID_Y - H * spread : MID_Y + H * spread;
}

type Shape =
  | { kind: "pass"; los: number; catch: number; end: number; y: number; arc: number; complete: boolean; picked: boolean }
  | { kind: "run"; los: number; end: number; y: number; loss: boolean }
  | { kind: "kick"; los: number; end: number; good: boolean | null }
  | { kind: "spot"; los: number };

/** What to draw for a play, or null when it has no field position. */
function shapeOf(p: GamePlay): Shape | null {
  if (p.yardline_100 == null) return null;
  const losYards = 100 - p.yardline_100;
  const los = fieldX(losYards);
  const gained = p.yards_gained ?? 0;

  if (p.play_type === "pass" && !p.sack) {
    if (p.air_yards == null) {
      // A pass with no measured air yards (older seasons): draw to the result.
      return { kind: "pass", los, catch: fieldX(losYards + gained), end: fieldX(losYards + gained), y: laneY(p.pass_location, null), arc: 30, complete: p.complete_pass, picked: p.interception };
    }
    const catchX = fieldX(losYards + p.air_yards);
    const endX = p.complete_pass ? fieldX(losYards + gained) : catchX;
    const arc = Math.min(120, 24 + Math.abs(p.air_yards) * 3);
    return { kind: "pass", los, catch: catchX, end: endX, y: laneY(p.pass_location, null), arc, complete: p.complete_pass, picked: p.interception };
  }
  if (p.play_type === "run" || p.sack || p.play_type === "qb_kneel") {
    const y = p.sack ? MID_Y : laneY(p.run_location, p.run_gap);
    return { kind: "run", los, end: fieldX(losYards + gained), y, loss: gained < 0 };
  }
  if (p.play_type === "punt" || p.play_type === "field_goal" || p.play_type === "extra_point") {
    const dist = p.kick_distance ?? (p.play_type === "field_goal" ? p.yardline_100 + 17 : 0);
    const good = p.field_goal_result == null ? null : p.field_goal_result === "made";
    return { kind: "kick", los, end: fieldX(losYards + dist), good };
  }
  // Kickoffs are reported from the receiving team's frame and have no yardage
  // of their own; timeouts and penalties have only a spot.
  return { kind: "spot", los };
}

/** "KC 24", "PHI 35", or "50". */
function spot(p: GamePlay): string {
  if (p.yardline_100 == null) return "";
  if (p.yardline_100 === 50) return "50";
  return p.yardline_100 > 50
    ? `${p.posteam ?? ""} ${100 - p.yardline_100}`.trim()
    : `${p.defteam ?? ""} ${p.yardline_100}`.trim();
}

const ORDINAL = ["", "1st", "2nd", "3rd", "4th"];
function downDistance(p: GamePlay): string | null {
  if (p.down == null) return null;
  const togo = p.ydstogo == null ? "" : p.ydstogo >= (p.yardline_100 ?? 0) ? " & Goal" : ` & ${p.ydstogo}`;
  return `${ORDINAL[p.down] ?? `${p.down}th`}${togo}`;
}

const QTR = ["", "1st", "2nd", "3rd", "4th", "OT"];

function outcome(p: GamePlay): { label: string; tone: "accent" | "success" | "danger" | "neutral" } {
  if (p.touchdown) return { label: "Touchdown", tone: "success" };
  if (p.interception) return { label: "Interception", tone: "danger" };
  if (p.fumble_lost) return { label: "Fumble lost", tone: "danger" };
  if (p.sack) return { label: "Sack", tone: "danger" };
  if (p.field_goal_result) {
    return p.field_goal_result === "made"
      ? { label: "Field goal", tone: "success" }
      : { label: `Field goal ${p.field_goal_result}`, tone: "danger" };
  }
  if (p.play_type === "no_play") return { label: p.penalty ? "Penalty" : "No play", tone: "neutral" };
  if (p.first_down) return { label: "First down", tone: "accent" };
  if (p.play_type === "pass" && !p.complete_pass) return { label: "Incomplete", tone: "neutral" };
  const kind = p.play_type?.replace(/_/g, " ") ?? "play";
  return { label: kind.charAt(0).toUpperCase() + kind.slice(1), tone: "neutral" };
}

function yards(p: GamePlay): string | null {
  if (p.play_type === "pass" && !p.complete_pass && !p.sack) return null;
  if (p.yards_gained == null) return null;
  const n = p.yards_gained;
  return `${n > 0 ? "+" : ""}${n} yd${Math.abs(n) === 1 ? "" : "s"}`;
}

/* ----------------------------------------------------------------------------
 * The field
 * -------------------------------------------------------------------------- */

function FieldLines() {
  const lines = [];
  for (let yd = 0; yd <= 100; yd += 5) {
    const x = GOAL_L + yd * YARD;
    const major = yd % 10 === 0;
    lines.push(
      <line
        key={`l${yd}`}
        x1={x} y1={0} x2={x} y2={H}
        stroke="var(--border-strong)"
        strokeWidth={major ? 2 : 1}
      />,
    );
  }
  const numbers = [];
  for (let yd = 10; yd <= 90; yd += 10) {
    const x = GOAL_L + yd * YARD;
    const label = yd <= 50 ? yd : 100 - yd;
    numbers.push(
      <g key={`n${yd}`} className="yb-field-num" aria-hidden="true">
        <text x={x} y={H - 40}>{label}</text>
        <text x={x} y={40} transform={`rotate(180 ${x} 34)`}>{label}</text>
      </g>,
    );
  }
  const hashes = [];
  for (let yd = 1; yd < 100; yd++) {
    if (yd % 5 === 0) continue;
    const x = GOAL_L + yd * YARD;
    for (const y of HASH_Y) {
      hashes.push(<line key={`h${yd}-${y}`} x1={x} y1={y - 4} x2={x} y2={y + 4} stroke="var(--border-strong)" strokeWidth={1} />);
    }
  }
  return (
    <g>
      <rect x={0} y={0} width={W} height={H} fill="var(--elevated)" />
      <rect x={0} y={0} width={GOAL_L} height={H} fill="var(--bg-soft)" />
      <rect x={GOAL_R} y={0} width={W - GOAL_R} height={H} fill="var(--bg-soft)" />
      {lines}
      {hashes}
      {numbers}
    </g>
  );
}

function PlayMark({ play, shape }: { play: GamePlay; shape: Shape }) {
  const first = play.ydstogo != null && play.yardline_100 != null && play.down != null
    ? fieldX(100 - play.yardline_100 + play.ydstogo)
    : null;
  const marks: React.ReactNode[] = [];

  // Line of scrimmage, and the line to gain.
  marks.push(<line key="los" className="yb-field-los" x1={shape.los} y1={0} x2={shape.los} y2={H} />);
  if (first != null && first <= GOAL_R) {
    marks.push(<line key="ltg" className="yb-field-ltg" x1={first} y1={0} x2={first} y2={H} />);
  }

  if (shape.kind === "pass") {
    const cx = (shape.los + shape.catch) / 2;
    const cy = Math.min(MID_Y, shape.y) - shape.arc;
    const d = `M ${shape.los} ${MID_Y} Q ${cx} ${cy} ${shape.catch} ${shape.y}`;
    marks.push(
      <path
        key="arc"
        className={`yb-field-arc${shape.complete ? "" : " is-incomplete"}${shape.picked ? " is-picked" : ""}`}
        d={d}
      />,
    );
    if (shape.complete && shape.end !== shape.catch) {
      marks.push(
        <line key="yac" className="yb-field-yac" x1={shape.catch} y1={shape.y} x2={shape.end} y2={shape.y} markerEnd="url(#yb-field-arrow)" />,
      );
    }
    marks.push(
      <circle key="catch" className={`yb-field-catch${shape.complete ? "" : " is-miss"}${shape.picked ? " is-picked" : ""}`} cx={shape.catch} cy={shape.y} r={7} />,
    );
  } else if (shape.kind === "run") {
    const d = `M ${shape.los} ${MID_Y} Q ${(shape.los + shape.end) / 2} ${shape.y} ${shape.end} ${shape.y}`;
    marks.push(
      <path key="run" className={`yb-field-run${shape.loss ? " is-loss" : ""}`} d={d} markerEnd="url(#yb-field-arrow)" />,
    );
  } else if (shape.kind === "kick") {
    marks.push(
      <line
        key="kick"
        className={`yb-field-kick${shape.good === false ? " is-miss" : ""}${shape.good ? " is-good" : ""}`}
        x1={shape.los} y1={MID_Y} x2={shape.end} y2={MID_Y}
      />,
    );
  }
  marks.push(<circle key="ball" className="yb-field-ball" cx={shape.los} cy={MID_Y} r={6} />);
  return <g className="yb-field-play">{marks}</g>;
}

/* ----------------------------------------------------------------------------
 * The view: field + stepper + drive list
 * -------------------------------------------------------------------------- */

export function FieldView({ data }: { data: GamePlaysResponse }) {
  const plays = data.plays;
  const [index, setIndex] = useState(() => Math.max(0, plays.findIndex((p) => p.play_type !== "kickoff" && p.yardline_100 != null)));
  const listRef = useRef<HTMLDivElement>(null);
  const play = plays[index];

  // Drives, in order, for the list.
  const drives = useMemo(() => {
    const groups: { drive: number | null; posteam: string | null; plays: { play: GamePlay; i: number }[] }[] = [];
    plays.forEach((p, i) => {
      const last = groups[groups.length - 1];
      if (last && last.drive === p.drive && last.posteam === p.posteam) last.plays.push({ play: p, i });
      else groups.push({ drive: p.drive, posteam: p.posteam, plays: [{ play: p, i }] });
    });
    return groups;
  }, [plays]);

  // Keep the selected row in view as the stepper moves.
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-play-index="${index}"]`);
    if (!list || !row) return;
    const top = row.offsetTop - list.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop + 32) list.scrollTop = top - 32;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [index]);

  if (!play) return null;
  const shape = shapeOf(play);
  const result = outcome(play);
  const gained = yards(play);
  const who = [play.passer, play.receiver ?? play.rusher].filter(Boolean).join(" → ") || play.rusher;
  const label = [
    play.qtr ? `${QTR[play.qtr] ?? play.qtr} quarter` : null,
    play.clock,
    downDistance(play),
    play.yardline_100 != null ? `at the ${spot(play)}` : null,
    play.description,
  ].filter(Boolean).join(", ");

  const step = (d: number) => setIndex((i) => Math.max(0, Math.min(plays.length - 1, i + d)));

  return (
    <div
      className="yb-field-view"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); step(1); }
        if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); step(-1); }
      }}
    >
      <div className="yb-field-stage" style={teamTheme(play.posteam)}>
        <div className="yb-field-scoreline" aria-live="polite">
          <span className="yb-field-team">
            <TeamLogo team={data.away.team_id} size={18} /> {data.away.team_id}{" "}
            <strong>{play.away_score ?? 0}</strong>
          </span>
          <span className="yb-field-situation">
            {play.qtr ? `${QTR[play.qtr] ?? play.qtr} · ` : ""}{play.clock ?? ""}
            {downDistance(play) ? ` · ${downDistance(play)}` : ""}
            {play.yardline_100 != null ? ` at ${spot(play)}` : ""}
          </span>
          <span className="yb-field-team">
            <strong>{play.home_score ?? 0}</strong> {data.home.team_id}{" "}
            <TeamLogo team={data.home.team_id} size={18} />
          </span>
        </div>

        <svg
          className="yb-field"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={label}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <marker id="yb-field-arrow" viewBox="0 0 10 10" refX={8} refY={5} markerWidth={6} markerHeight={6} orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--chart)" />
            </marker>
          </defs>
          <FieldLines />
          {shape && <PlayMark key={play.play_id} play={play} shape={shape} />}
          {play.posteam && (
            <text className="yb-field-direction" x={GOAL_L + 8} y={H - 12} aria-hidden="true">
              {play.posteam} ▶
            </text>
          )}
        </svg>

        <div className="yb-field-caption">
          <span className={`yb-badge ${result.tone === "neutral" ? "" : result.tone}`}>{result.label}</span>
          {gained && <span className="yb-field-yards">{gained}</span>}
          {who && <span className="yb-field-who">{who}</span>}
          <p className="yb-field-desc">{play.description ?? "—"}</p>
        </div>

        <div className="yb-field-stepper" role="group" aria-label="Step through plays">
          <button type="button" className="yb-btn sm" onClick={() => step(-1)} disabled={index === 0} aria-label="Previous play">
            ‹ Prev
          </button>
          <span className="yb-field-count">Play {index + 1} of {plays.length}</span>
          <button type="button" className="yb-btn sm" onClick={() => step(1)} disabled={index === plays.length - 1} aria-label="Next play">
            Next ›
          </button>
        </div>
      </div>

      <div className="yb-field-drives" ref={listRef} aria-label="Drives">
        {drives.map((d, di) => (
          <section key={`${d.drive ?? "x"}-${di}`} className="yb-field-drive" style={teamTheme(d.posteam)}>
            <h3>
              {d.posteam && <TeamLogo team={d.posteam} size={16} />}
              {d.drive != null ? `Drive ${d.drive}` : "Between drives"}
              {d.posteam ? ` · ${d.posteam}` : ""}
            </h3>
            {d.plays.map(({ play: p, i }) => {
              const o = outcome(p);
              return (
                <button
                  key={p.play_id}
                  type="button"
                  className={`yb-field-row${i === index ? " is-on" : ""}${o.tone !== "neutral" ? ` is-${o.tone}` : ""}`}
                  aria-pressed={i === index}
                  data-play-index={i}
                  onClick={() => setIndex(i)}
                >
                  <span className="dd">{downDistance(p) ?? (p.play_type === "kickoff" ? "Kickoff" : "")}</span>
                  <span className="sp">{p.yardline_100 != null ? spot(p) : ""}</span>
                  <span className="tx">{p.description ?? o.label}</span>
                  <span className="yd">{yards(p) ?? ""}</span>
                </button>
              );
            })}
          </section>
        ))}
      </div>

      <p className="yb-field-note">
        Field position, air yards and yards after the catch as recorded in nflverse play-by-play;
        lateral placement follows the recorded pass or run direction. Passes draw to the catch
        point and continue for yards after the catch; runs draw to where the ball was spotted.{" "}
        <Link href="/glossary">Glossary</Link>
      </p>
    </div>
  );
}
