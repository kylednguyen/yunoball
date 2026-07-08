"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Nav } from "../../components/Nav";
import {
  fetchPlayer,
  type PlayerCareer,
  type PlayerProfile,
} from "../../lib/api";

/** Position decides which stat family leads the tiles and tables. */
function headlineTiles(p: PlayerProfile): { label: string; value: string; meta: string }[] {
  const c: PlayerCareer = p.career;
  const fmt = (n: number) => n.toLocaleString();
  if (p.position === "QB") {
    return [
      { label: "Passing yards", value: fmt(c.passing_yards), meta: "career" },
      { label: "Passing TDs", value: fmt(c.passing_tds), meta: `${c.interceptions} INT` },
      { label: "Rushing yards", value: fmt(c.rushing_yards), meta: `${c.rushing_tds} TD` },
      { label: "Fantasy (PPR)", value: c.fantasy_points_ppr.toFixed(1), meta: `${c.games_played} games` },
    ];
  }
  if (p.position === "RB") {
    return [
      { label: "Rushing yards", value: fmt(c.rushing_yards), meta: `${c.rushing_tds} TD` },
      { label: "Receptions", value: fmt(c.receptions), meta: `${fmt(c.receiving_yards)} yds` },
      { label: "Total TDs", value: fmt(c.rushing_tds + c.receiving_tds), meta: "career" },
      { label: "Fantasy (PPR)", value: c.fantasy_points_ppr.toFixed(1), meta: `${c.games_played} games` },
    ];
  }
  return [
    { label: "Receptions", value: fmt(c.receptions), meta: "career" },
    { label: "Receiving yards", value: fmt(c.receiving_yards), meta: `${c.receiving_tds} TD` },
    { label: "Rushing yards", value: fmt(c.rushing_yards), meta: `${c.rushing_tds} TD` },
    { label: "Fantasy (PPR)", value: c.fantasy_points_ppr.toFixed(1), meta: `${c.games_played} games` },
  ];
}

function seasonColumns(position: string | null): { key: string; label: string }[] {
  if (position === "QB") {
    return [
      { key: "passing_yards", label: "Pass yds" },
      { key: "passing_tds", label: "Pass TD" },
      { key: "interceptions", label: "INT" },
      { key: "rushing_yards", label: "Rush yds" },
      { key: "rushing_tds", label: "Rush TD" },
    ];
  }
  if (position === "RB") {
    return [
      { key: "rushing_yards", label: "Rush yds" },
      { key: "rushing_tds", label: "Rush TD" },
      { key: "receptions", label: "Rec" },
      { key: "receiving_yards", label: "Rec yds" },
      { key: "receiving_tds", label: "Rec TD" },
    ];
  }
  return [
    { key: "receptions", label: "Rec" },
    { key: "receiving_yards", label: "Rec yds" },
    { key: "receiving_tds", label: "Rec TD" },
    { key: "rushing_yards", label: "Rush yds" },
    { key: "rushing_tds", label: "Rush TD" },
  ];
}

export default function PlayerPage() {
  const params = useParams<{ id: string }>();
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!params?.id) return;
    let active = true;
    setLoading(true);
    fetchPlayer(decodeURIComponent(params.id))
      .then((p) => {
        if (!active) return;
        if (p === null) setNotFound(true);
        else setProfile(p);
      })
      .catch((e) => active && setError((e as Error).message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [params?.id]);

  const cols = profile ? seasonColumns(profile.position) : [];

  return (
    <>
      <Nav />
      <main id="main" className="yb-page" style={{ maxWidth: 980 }}>
        {loading && (
          <>
            <div className="yb-skel" style={{ height: 60, width: 380, marginBottom: 20 }} />
            <div className="yb-skel" style={{ height: 110, borderRadius: 14, marginBottom: 20 }} />
            <div className="yb-skel" style={{ height: 300, borderRadius: 14 }} />
          </>
        )}

        {error && (
          <div className="yb-state error" role="alert">
            <div className="yb-glyph" aria-hidden="true">
              ⚠️
            </div>
            <h2>Couldn&apos;t load this player</h2>
            <p>{error}</p>
          </div>
        )}

        {notFound && (
          <div className="yb-state">
            <div className="yb-glyph" aria-hidden="true">
              🔍
            </div>
            <h2>Player not found</h2>
            <p>
              That player isn&apos;t in the warehouse yet. Try the{" "}
              <a href="/leaderboards">leaderboards</a> or <a href="/">search</a>.
            </p>
          </div>
        )}

        {profile && (
          <>
            <div className="yb-page-head" style={{ alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <h1 className="yb-page-title">{profile.name}</h1>
                {profile.position && (
                  <span className={`yb-pos ${profile.position}`} style={{ fontSize: 13 }}>
                    {profile.position}
                  </span>
                )}
              </div>
              <button
                className="yb-btn ghost"
                onClick={() =>
                  (window.location.href = `/?q=${encodeURIComponent(
                    `${profile.name} career stats`,
                  )}`)
                }
              >
                Ask about {profile.name.split(" ").pop()} →
              </button>
            </div>
            <p className="yb-page-sub">
              {profile.team_name ?? profile.team ?? "—"} · {profile.career.seasons} season
              {profile.career.seasons === 1 ? "" : "s"} in the warehouse ·{" "}
              {profile.career.games_played} games
            </p>

            <div className="yb-tiles">
              {headlineTiles(profile).map((t) => (
                <div key={t.label} className="yb-tile">
                  <div className="yb-tile-label">{t.label}</div>
                  <div className="yb-tile-value">{t.value}</div>
                  <div className="yb-tile-meta">{t.meta}</div>
                </div>
              ))}
            </div>

            <h2 style={{ fontSize: 20, fontWeight: 800, margin: "24px 0 10px" }}>
              Season by season
            </h2>
            <div className="yb-table-scroll">
              <table className="yb-table">
                <thead>
                  <tr>
                    <th>Season</th>
                    <th>Team</th>
                    <th className="num">GP</th>
                    {cols.map((c) => (
                      <th key={c.key} className="num">
                        {c.label}
                      </th>
                    ))}
                    <th className="num">PPR</th>
                    <th className="num">Pts/gm</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.seasons.map((s) => (
                    <tr key={s.season}>
                      <td>{s.season}</td>
                      <td style={{ color: "var(--muted)", fontWeight: 400 }}>{s.team ?? "—"}</td>
                      <td className="num">{s.games_played}</td>
                      {cols.map((c) => (
                        <td key={c.key} className="num">
                          {(s[c.key as keyof typeof s] as number).toLocaleString()}
                        </td>
                      ))}
                      <td className="num" style={{ fontWeight: 700 }}>
                        {s.fantasy_points_ppr.toFixed(1)}
                      </td>
                      <td className="num">{s.points_per_game.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {profile.game_log.length > 0 && (
              <>
                <h2 style={{ fontSize: 20, fontWeight: 800, margin: "28px 0 10px" }}>
                  Notable games
                </h2>
                <div className="yb-table-scroll">
                  <table className="yb-table">
                    <thead>
                      <tr>
                        <th>Game</th>
                        <th>Result</th>
                        {profile.position === "QB" && (
                          <>
                            <th className="num">Pass yds</th>
                            <th className="num">Pass TD</th>
                          </>
                        )}
                        <th className="num">Rush yds</th>
                        <th className="num">Rush TD</th>
                        <th className="num">Rec</th>
                        <th className="num">Rec yds</th>
                        <th className="num">Rec TD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profile.game_log.map((g) => (
                        <tr key={g.game_id}>
                          <td>
                            {g.season} Wk {g.week} {g.home ? "vs" : "@"} {g.opponent}
                          </td>
                          <td>
                            <span
                              className={
                                g.result === "W"
                                  ? "yb-streak-w"
                                  : g.result === "L"
                                    ? "yb-streak-l"
                                    : undefined
                              }
                            >
                              {g.result} {g.team_score ?? "–"}–{g.opp_score ?? "–"}
                            </span>
                          </td>
                          {profile.position === "QB" && (
                            <>
                              <td className="num">{g.passing_yards.toLocaleString()}</td>
                              <td className="num">{g.passing_tds}</td>
                            </>
                          )}
                          <td className="num">{g.rushing_yards.toLocaleString()}</td>
                          <td className="num">{g.rushing_tds}</td>
                          <td className="num">{g.receptions}</td>
                          <td className="num">{g.receiving_yards.toLocaleString()}</td>
                          <td className="num">{g.receiving_tds}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </main>
    </>
  );
}
