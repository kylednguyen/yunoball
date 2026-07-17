"use client";

import { useSeasonParam, useTitle } from "../lib/hooks";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Headshot } from "../components/Headshot";
import { PageHeader } from "../components/ui";
import {
  friendlyError, fetchFantasyPlayers, type FantasyPlayer, type FantasyPlayersResponse } from "../lib/api";

const SLOTS = [
  { id: "QB", label: "QB", accepts: ["QB"] },
  { id: "RB1", label: "RB", accepts: ["RB"] },
  { id: "RB2", label: "RB", accepts: ["RB"] },
  { id: "WR1", label: "WR", accepts: ["WR"] },
  { id: "WR2", label: "WR", accepts: ["WR"] },
  { id: "TE", label: "TE", accepts: ["TE"] },
  { id: "FLEX", label: "FLEX", accepts: ["RB", "WR", "TE"] },
] as const;

type SlotId = (typeof SLOTS)[number]["id"];
type Lineup = Partial<Record<SlotId, string>>;

const STORAGE_KEY = "yunoball_lineup_v1";
const POSITIONS = ["ALL", "QB", "RB", "WR", "TE"] as const;

function loadLineup(season: number): Lineup {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { season: number; slots: Lineup };
    return parsed.season === season ? parsed.slots : {};
  } catch {
    return {};
  }
}

function statLine(p: FantasyPlayer): string {
  if (p.position === "QB") {
    return `${p.passing_yards.toLocaleString()} pass yds · ${p.passing_tds} TD · ${p.interceptions} INT`;
  }
  if (p.position === "RB") {
    return `${p.rushing_yards.toLocaleString()} rush yds · ${p.rushing_tds + p.receiving_tds} TD · ${p.receptions} rec`;
  }
  return `${p.receptions} rec · ${p.receiving_yards.toLocaleString()} yds · ${p.receiving_tds} TD`;
}

export default function FantasyPage() {
  useTitle("Fantasy lineup builder");
  const [data, setData] = useState<FantasyPlayersResponse | null>(null);
  const [season] = useSeasonParam();
  const [position, setPosition] = useState<(typeof POSITIONS)[number]>("ALL");
  const [query, setQuery] = useState("");
  const [lineup, setLineup] = useState<Lineup>({});
  // Clearing 7 picks deserves a takeback, not a confirm dialog.
  const [undoLineup, setUndoLineup] = useState<Lineup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchFantasyPlayers(season)
      .then((d) => {
        if (!active) return;
        setData(d);
        setError(null);
        setLineup(loadLineup(d.season));
      })
      .catch((e) => active && setError((e as Error).message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [season]);

  useEffect(() => {
    if (!data) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ season: data.season, slots: lineup }));
    } catch {
      // storage full/blocked — lineup just won't persist
    }
  }, [lineup, data]);

  const byId = useMemo(() => {
    const m = new Map<string, FantasyPlayer>();
    data?.players.forEach((p) => m.set(p.player_id, p));
    return m;
  }, [data]);

  const rostered = useMemo(() => new Set(Object.values(lineup)), [lineup]);

  const pool = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.players.filter(
      (p) =>
        (position === "ALL" || p.position === position) &&
        (!q || p.name.toLowerCase().includes(q) || (p.team ?? "").toLowerCase().includes(q)),
    );
  }, [data, position, query]);

  const openSlotFor = (p: FantasyPlayer): SlotId | null => {
    for (const s of SLOTS) {
      if (!lineup[s.id] && s.accepts.includes(p.position as never)) return s.id;
    }
    return null;
  };

  const add = (p: FantasyPlayer) => {
    const slot = openSlotFor(p);
    if (!slot || rostered.has(p.player_id)) return;
    setLineup((prev) => ({ ...prev, [slot]: p.player_id }));
  };

  const remove = (slot: SlotId) => {
    setLineup((prev) => {
      const next = { ...prev };
      delete next[slot];
      return next;
    });
  };

  const autoFill = () => {
    if (!data) return;
    const next: Lineup = { ...lineup };
    const taken = new Set(Object.values(next));
    for (const s of SLOTS) {
      if (next[s.id]) continue;
      const best = data.players.find(
        (p) =>
          !taken.has(p.player_id) &&
          s.accepts.includes(p.position as never) &&
          p.points_per_game > 0,
      );
      if (best) {
        next[s.id] = best.player_id;
        taken.add(best.player_id);
      }
    }
    setLineup(next);
  };

  const picks = SLOTS.map((s) => (lineup[s.id] ? byId.get(lineup[s.id]!) : undefined));
  const totalPpg = picks.reduce((sum, p) => sum + (p?.points_per_game ?? 0), 0);
  const totalSeason = picks.reduce((sum, p) => sum + (p?.fantasy_points_ppr ?? 0), 0);
  const filled = picks.filter(Boolean).length;

  return (
    <>
      <main id="main" className="yb-page">
        <PageHeader
          title="Fantasy Lineup Builder"
          action={<div className="yb-format-lock" aria-label="Scoring format">PPR scoring</div>}
        />

        {error && (
          <div className="yb-state error" role="alert">
            <h2>Couldn’t load the player pool</h2>
            <p>{friendlyError(error)}</p>
          </div>
        )}

        {loading && !data && (
          <div className="yb-fantasy-grid">
            <div className="yb-skel" style={{ height: 480, borderRadius: 14 }} />
            <div className="yb-skel" style={{ height: 480, borderRadius: 14 }} />
          </div>
        )}

        {data && !error && (
          <div className="yb-fantasy-grid">
            <section aria-label="Your lineup" className="yb-lineup-panel">
              {/* role=status: lineup edits announce the recalculated total. */}
              <div
                className={`yb-card yb-lineup-summary${filled === SLOTS.length ? " complete" : ""}`}
                role="status"
              >
                <div className="yb-tile-label">Actual PPR per game</div>
                <div className="yb-total-hero">{totalPpg.toFixed(1)}</div>
                <div className="yb-tile-meta">
                  {filled}/{SLOTS.length} slots
                </div>
                <div className="yb-lineup-season-total">
                  <span>Season PPR points</span>
                  <strong>{totalSeason.toFixed(1)}</strong>
                  <span>{data.season}</span>
                </div>
              </div>

              {SLOTS.map((s, i) => {
                const p = picks[i];
                return (
                  <div key={s.id} className={`yb-slot${p ? " filled" : ""}`}>
                    <span className="yb-slot-label">{s.label}</span>
                    {p ? (
                      <>
                        <span className="yb-slot-name">
                          <div className="who">
                            <Link
                              href={`/players/${encodeURIComponent(p.player_id)}`}
                              style={{ color: "inherit" }}
                            >
                              {p.name}
                            </Link>
                          </div>
                          <div className="meta">
                            {p.team} · {statLine(p)}
                          </div>
                        </span>
                        <span className="yb-slot-pts">{p.points_per_game.toFixed(1)} PPG</span>
                        <button
                          className="yb-x"
                          aria-label={`Remove ${p.name}`}
                          onClick={() => remove(s.id)}
                        >
                          ✕
                        </button>
                      </>
                    ) : (
                      <span className="yb-slot-empty" style={{ gridColumn: "2 / -1" }}>
                        Add a {s.accepts.join("/")} from the pool →
                      </span>
                    )}
                  </div>
                );
              })}

              <div className="yb-lineup-actions">
                <button className="yb-btn" onClick={autoFill} disabled={filled === SLOTS.length}>
                  Optimize by PPR average
                </button>
                <button
                  className="yb-btn"
                  onClick={() => {
                    setUndoLineup(lineup);
                    setLineup({});
                    setTimeout(() => setUndoLineup(null), 8000);
                  }}
                  disabled={filled === 0}
                >
                  Clear
                </button>
                {undoLineup && (
                  <button
                    className="yb-link"
                    onClick={() => {
                      setLineup(undoLineup);
                      setUndoLineup(null);
                    }}
                  >
                    Undo clear
                  </button>
                )}
              </div>
            </section>

            <section aria-label="Player pool" className="yb-player-pool yb-card">
              <div className="yb-pool-controls">
                <div className="yb-pill-seg" role="group" aria-label="Position filter">
                  {POSITIONS.map((pos) => (
                    <button
                      key={pos}
                      type="button"
                      aria-pressed={position === pos}
                      onClick={() => setPosition(pos)}
                    >
                      {pos}
                    </button>
                  ))}
                </div>
                <input
                  className="yb-input"
                  style={{ flex: 1, minWidth: 160 }}
                  placeholder="Search player or team…"
                  aria-label="Search players"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>

              <div className="yb-table-scroll" style={{ maxHeight: 560, overflowY: "auto" }}>
                <table className="yb-table">
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>Pos</th>
                      <th className="num">PPR</th>
                      <th className="num">Pts/gm</th>
                      <th aria-label="Add" />
                    </tr>
                  </thead>
                  <tbody>
                    {pool.map((p) => {
                      const inLineup = rostered.has(p.player_id);
                      const slot = openSlotFor(p);
                      return (
                        <tr key={p.player_id}>
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <Headshot src={p.headshot_url} name={p.name} scale="row" />
                              <div>
                                <div>
                                  <Link
                                    href={`/players/${encodeURIComponent(p.player_id)}`}
                                    style={{ color: "inherit" }}
                                  >
                                    {p.name}
                                  </Link>
                                </div>
                                <div
                                  style={{ fontSize: "var(--fs-caption)", color: "var(--faint)", fontWeight: 400 }}
                                >
                                  {p.team} · {statLine(p)}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td>{p.position}</td>
                          <td className="num">{p.fantasy_points_ppr.toFixed(1)}</td>
                          <td className="num">{p.points_per_game.toFixed(1)}</td>
                          <td className="num">
                            {inLineup ? (
                              <span className="yb-chip-static">In lineup</span>
                            ) : (
                              <button
                                className="yb-btn sm"
                                disabled={!slot}
                                title={slot ? `Add to ${slot}` : "No open slot"}
                                onClick={() => add(p)}
                              >
                                + Add
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {pool.length === 0 && (
                      <tr>
                        <td colSpan={5} style={{ color: "var(--muted)" }}>
                          No players match that filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </main>
    </>
  );
}
