"use client";

import Link from "next/link";

import { TeamLogo } from "./TeamLogo";
import { Badge, Surface } from "./ui";
import type { GameRow } from "../lib/api";
import { formatGameDate, weekLabel } from "../lib/format";
import { teamTheme } from "../lib/teamTheme";

/** One game as a compact box-score card: status, both teams (each linking to
 *  its team page), score, and a link to the full box score once final. Renders
 *  in the Scores page grid. */
export function GameCard({ game }: { game: GameRow }) {
  const homeWon = game.final && (game.home.score ?? 0) > (game.away.score ?? 0);
  const awayWon = game.final && (game.away.score ?? 0) > (game.home.score ?? 0);
  const hasScore = game.home.score !== null || game.away.score !== null;
  const status = game.final ? "Final" : hasScore ? "Live" : "Scheduled";
  return (
    <Surface as="article" interactive className="yb-game-card yb-enter">
      <div className="yb-game-card-head">
        <Badge tone={game.final ? "neutral" : hasScore ? "success" : "accent"}>{status}</Badge>
        <span>{formatGameDate(game.date)} · {weekLabel(game.week, game.season)}</span>
      </div>
      <table
        className="yb-mini-boxscore"
        aria-label={`${game.away.name} at ${game.home.name} box score`}
      >
        <thead>
          <tr>
            <th>Team</th>
            <th className="num">Score</th>
          </tr>
        </thead>
        <tbody>
          {[
            { side: game.away, won: awayWon, site: "Away" },
            { side: game.home, won: homeWon, site: "Home" },
          ].map(({ side, won, site }) => (
            <tr
              key={side.team_id}
              className={`yb-game-result-row${won ? " winner" : ""}`}
              style={won ? teamTheme(side.team_id) : undefined}
            >
              <td>
                <Link className="yb-game-team" href={`/teams/${side.team_id}?season=${game.season}`}>
                  <TeamLogo team={side.team_id} />
                  <span>
                    <span className="abbr">{side.team_id}</span>
                    <span className="nick">{side.nickname ?? side.name}</span>
                    <span className="site">{site}</span>
                  </span>
                </Link>
              </td>
              <td className="yb-game-score num">{side.score ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="yb-game-foot">
        <span>{game.final ? "Complete" : hasScore ? "In progress" : "Pregame"}</span>
        {game.final ? (
          <Link className="yb-card-action yb-game-stretch" href={`/games/${encodeURIComponent(game.game_id)}`}>
            Full box score →
          </Link>
        ) : (
          <span className="yb-final-chip">Pregame</span>
        )}
      </div>
    </Surface>
  );
}
