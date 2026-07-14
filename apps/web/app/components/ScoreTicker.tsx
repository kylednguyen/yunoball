"use client";

import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";

import { fetchGames, type GamesResponse } from "../lib/api";
import { teamTheme } from "../lib/teamTheme";
import { TeamLogo } from "./TeamLogo";

function TeamLine({
  team,
  score,
  won,
}: {
  team: string;
  score: number | null;
  won: boolean;
}) {
  return (
    <span className={`yb-tick-row${won ? " win" : ""}`} style={won ? teamTheme(team) : undefined}>
      <TeamLogo team={team} size={20} />
      <span className="yb-tick-team">{team}</span>
      <span className="yb-tick-score">{score}</span>
    </span>
  );
}

/** Slim ESPN-style scoreboard strip pinned to the top of the front page. */
export function ScoreTicker() {
  const [games, setGames] = useState<GamesResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetchGames()
      .then((g) => {
        if (active) setGames(g);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  if (failed) return null; // API down: the page works without the strip

  return (
    <div className="yb-ticker" aria-label="Latest scores">
      <a className="yb-tick-label" href="/scores">
        {games ? (
          <>
            <span className="yb-tick-title">
              <CalendarDays size={15} aria-hidden="true" />
              <strong>Week {games.week}</strong>
            </span>
            <span className="yb-tick-season">{games.season}</span>
          </>
        ) : (
          <strong>Scores</strong>
        )}
      </a>
      <div className="yb-tick-scroll">
        {games
          ? games.games.map((g) => {
              const homeWon = (g.home.score ?? 0) > (g.away.score ?? 0);
              return (
                <a key={g.game_id} className="yb-tick-game" href="/scores">
                  <TeamLine team={g.away.team_id} score={g.away.score} won={!homeWon} />
                  <TeamLine team={g.home.team_id} score={g.home.score} won={homeWon} />
                  <span className="yb-tick-status">{g.final ? "Final" : "Live"}</span>
                </a>
              );
            })
          : Array.from({ length: 14 }, (_, i) => (
              <div key={i} className="yb-skel yb-tick-skel" />
            ))}
      </div>
    </div>
  );
}
