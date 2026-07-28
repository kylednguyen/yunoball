"use client";

import { useMemo, useState } from "react";

interface Term {
  term: string;
  abbr?: string;
  pos?: string; // renders the position badge used across the app
  def: string;
}

interface Group {
  title: string;
  blurb: string;
  terms: Term[];
}

const GROUPS: Group[] = [
  {
    title: "Football Basics",
    blurb: "Start here. The vocabulary every other term builds on.",
    terms: [
      {
        term: "Down",
        def: "One play. The offense gets four downs to gain 10 yards; make it and the count resets to 'first down'. '3rd & 4' means third down, four yards still needed.",
      },
      {
        term: "First down",
        def: "Gaining the 10 yards needed to earn a fresh set of four downs. Moving the chains. The basic unit of a sustained drive.",
      },
      {
        term: "Touchdown",
        abbr: "TD",
        def: "Getting the ball into the opponent's end zone. Worth 6 points, plus the try for one or two more. The stat every scoring column counts.",
      },
      {
        term: "Field goal",
        abbr: "FG",
        def: "A place kick through the uprights, worth 3 points. The fallback when a drive stalls in range.",
      },
      {
        term: "Extra point / two-point conversion",
        abbr: "XP / 2PT",
        def: "The try after a touchdown: a short kick for 1 point, or one play from the 2-yard line for 2.",
      },
      {
        term: "Turnover",
        def: "Losing possession to the defense. An interception or a lost fumble. The stat most correlated with losing.",
      },
      {
        term: "Snap",
        def: "The exchange that starts every play, from the center back to the quarterback. Snap counts measure how much a player was actually on the field.",
      },
      {
        term: "Drive",
        def: "One continuous possession. The series of plays from getting the ball until scoring, punting or turning it over.",
      },
      {
        term: "Line of scrimmage",
        def: "The invisible line where the ball sits before the snap. All yardage on a play is measured from here.",
      },
      {
        term: "Red zone",
        def: "Inside the opponent's 20-yard line, where drives are expected to end in points. Red-zone usage is a strong touchdown predictor.",
      },
      {
        term: "Punt",
        def: "Kicking the ball away on fourth down to pin the opponent deep instead of risking a failed conversion.",
      },
    ],
  },
  {
    title: "Positions",
    blurb: "The four offensive skill positions YunoBall tracks stats for.",
    terms: [
      {
        term: "Quarterback",
        pos: "QB",
        def: "Leads the offense and throws (or occasionally runs) the ball on most plays. Judged mainly on passing yards and touchdowns against interceptions.",
      },
      {
        term: "Running back",
        pos: "RB",
        def: "Takes handoffs and runs with the ball; modern backs also catch passes out of the backfield, which matters a lot in PPR fantasy scoring.",
      },
      {
        term: "Wide receiver",
        pos: "WR",
        def: "Lines up wide and catches passes downfield. Production shows up as targets, receptions, receiving yards and receiving touchdowns.",
      },
      {
        term: "Tight end",
        pos: "TE",
        def: "A hybrid blocker/receiver who lines up next to the offensive line. Scored like a receiver, but usually with fewer targets.",
      },
    ],
  },
  {
    title: "Passing Stats",
    blurb: "Everything a quarterback question can ask about.",
    terms: [
      {
        term: "Passing yards",
        def: "Yards gained on completed passes. The headline stat for quarterbacks. A 4,000-yard season is a strong year; 5,000 is historic.",
      },
      {
        term: "Passing touchdown",
        abbr: "PASS TD",
        def: "A completed pass that scores a touchdown. Credited to both the passer and the receiver.",
      },
      {
        term: "Interception",
        abbr: "INT",
        def: "A pass caught by the defense. A turnover charged against the quarterback. The classic risk stat weighed against touchdowns.",
      },
      {
        term: "Completions / attempts",
        abbr: "COMP/ATT",
        def: "Passes caught by the intended receiver versus passes thrown. Together they give completion percentage.",
      },
      {
        term: "Sack",
        def: "The quarterback is tackled behind the line of scrimmage before he can throw. Counted against the offense as lost yardage.",
      },
    ],
  },
  {
    title: "Rushing & Receiving Stats",
    blurb: "The ground game and the catch game.",
    terms: [
      {
        term: "Rushing yards",
        def: "Yards gained running the ball. 1,000 rushing yards in a season is the traditional benchmark for a lead running back.",
      },
      {
        term: "Rushing touchdown",
        abbr: "RUSH TD",
        def: "A touchdown scored on a running play.",
      },
      {
        term: "Carry",
        abbr: "ATT",
        def: "One rushing attempt. Yards per carry (yards ÷ carries) measures a runner's efficiency.",
      },
      {
        term: "Reception",
        abbr: "REC",
        def: "A caught pass. In PPR fantasy formats every reception is worth a point on its own, whatever the yardage.",
      },
      {
        term: "Receiving yards",
        def: "Yards gained on caught passes, measured from the line of scrimmage to where the receiver is downed.",
      },
      {
        term: "Receiving touchdown",
        abbr: "REC TD",
        def: "A touchdown scored by the player catching the ball.",
      },
      {
        term: "Target",
        def: "A pass thrown a player's way, caught or not. Targets measure opportunity. A high-target player has a stable role in the offense.",
      },
      {
        term: "Fumble (lost)",
        def: "The ball carrier drops the ball. It's only a turnover. A 'fumble lost'. When the defense recovers it.",
      },
    ],
  },
  {
    title: "Fantasy Football",
    blurb: "The scoring language behind the Fantasy page and the assistant's start/sit calls.",
    terms: [
      {
        term: "PPR (point per reception)",
        abbr: "PPR",
        def: "A fantasy scoring format that awards one point per catch on top of yardage and touchdown points. YunoBall's fantasy numbers are full-PPR.",
      },
      {
        term: "Fantasy points",
        def: "A player's real stats converted to a single score: roughly 1 point per 10 rushing/receiving yards, 1 per 25 passing yards, 4-6 per touchdown, minus turnovers. Plus receptions in PPR.",
      },
      {
        term: "Points per game",
        abbr: "PPG",
        def: "Fantasy points divided by games played. A fairer measure than season totals when comparing players who missed time.",
      },
      {
        term: "Start / sit",
        def: "The weekly lineup decision between two rostered players. The assistant weighs production rate, PPR floor and offense environment rather than raw totals alone.",
      },
      {
        term: "PPR floor",
        def: "The safety net receptions provide: a player who catches 6 balls banks 6 points even on a quiet yardage day. High-catch players have high floors.",
      },
      {
        term: "Boom/bust",
        def: "A volatile scoring profile. Players who rely on touchdowns for most of their points swing hard week to week. Big booms, ugly busts.",
      },
      {
        term: "Waiver wire",
        def: "The pool of unrostered players in a fantasy league, claimed in a priority order between games.",
      },
    ],
  },
  {
    title: "Seasons & Games",
    blurb: "How the NFL calendar is sliced everywhere on this site.",
    terms: [
      {
        term: "Regular season",
        abbr: "REG",
        def: "The 18-week, 17-game schedule (16 games before 2021) that decides playoff seeding. Stat leaderboards default to regular-season numbers.",
      },
      {
        term: "Postseason",
        abbr: "POST",
        def: "The playoffs: Wild Card, Divisional and Conference rounds, then the Super Bowl. YunoBall groups all four rounds under one postseason label.",
      },
      {
        term: "Super Bowl",
        abbr: "SB",
        def: "The league championship game between the AFC and NFC winners. The last game of the postseason.",
      },
      {
        term: "Week",
        def: "One slate of games. Regular-season weeks run 1-18; postseason rounds continue the numbering, which is why a Super Bowl can appear as week 21 or 22.",
      },
      {
        term: "Bye week",
        def: "A team's scheduled week off during the regular season. Players score nothing that week. The classic fantasy trap.",
      },
      {
        term: "Streak",
        def: "Consecutive results of the same kind, newest game backwards: W3 means won the last three, L2 means lost the last two.",
      },
      {
        term: "Point differential",
        abbr: "+/-",
        def: "Points scored minus points allowed. A quick read on how dominant (or lucky) a team's record really is.",
      },
      {
        term: "Win percentage",
        abbr: "PCT",
        def: "Wins plus half-credit for ties, divided by games played. The number standings are sorted by: .750 beats .688.",
      },
    ],
  },
  {
    title: "Players & Careers",
    blurb: "How players enter the league and earn their roles.",
    terms: [
      {
        term: "Rookie",
        def: "A player in his first NFL season. Rookie stats set career baselines. A 1,000-yard rookie receiver is a genuine event.",
      },
      {
        term: "NFL Draft",
        def: "The annual seven-round selection of college players, worst teams picking first. Where most stars enter the league.",
      },
      {
        term: "Depth chart",
        def: "A team's ranking of players at each position. The starter, the backup, and so on. Climbing it is how a player earns snaps and stats.",
      },
      {
        term: "Free agent",
        abbr: "FA",
        def: "A player whose contract has expired and can sign with any team. The offseason's player-movement market.",
      },
      {
        term: "Veteran",
        def: "An experienced player past his rookie contract. 'Vet' production tends to be steadier. Less upside, higher floor.",
      },
    ],
  },
  {
    title: "League Structure",
    blurb: "How 32 teams organize into the standings you see.",
    terms: [
      {
        term: "Conference",
        abbr: "AFC / NFC",
        def: "The league's two halves. The American and National Football Conferences, 16 teams each. Their champions meet in the Super Bowl.",
      },
      {
        term: "Division",
        def: "Four-team groups within each conference (e.g. NFC West). Division rivals play twice a year, and each winner is guaranteed a playoff spot.",
      },
      {
        term: "Franchise",
        def: "The team as an organization, across relocations and renames. YunoBall folds history forward. Oakland Raiders stats live under today's Las Vegas Raiders.",
      },
    ],
  },
];

function Highlight({ text, needle }: { text: string; needle: string }) {
  if (!needle) return <>{text}</>;
  const i = text.toLowerCase().indexOf(needle);
  if (i === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="yb-hit">{text.slice(i, i + needle.length)}</mark>
      {text.slice(i + needle.length)}
    </>
  );
}

export function Glossary() {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();

  const groups = useMemo(() => {
    if (!needle) return GROUPS;
    return GROUPS.map((g) => ({
      ...g,
      terms: g.terms.filter(
        (t) =>
          t.term.toLowerCase().includes(needle) ||
          t.def.toLowerCase().includes(needle) ||
          t.abbr?.toLowerCase().includes(needle) ||
          t.pos?.toLowerCase().includes(needle),
      ),
    })).filter((g) => g.terms.length > 0);
  }, [needle]);

  const count = groups.reduce((n, g) => n + g.terms.length, 0);

  return (
    <>
      <div className="yb-gloss-controls">
        <input
          className="yb-input"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter terms… e.g. PPR, streak, interception"
          aria-label="Filter glossary terms"
        />
        <span className="yb-muted" role="status">
          {count} term{count === 1 ? "" : "s"}
        </span>
      </div>

      {groups.length === 0 ? (
        <div className="yb-state">
          <h2>No matching terms</h2>
          <p>Try a shorter fragment: “yards”, “TD”, “playoff”.</p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.title} className="yb-gloss-group" aria-label={g.title}>
            <h2>{g.title}</h2>
            <p>{g.blurb}</p>
            <dl className="yb-gloss-list">
              {g.terms.map((t) => (
                <div key={t.term} className="yb-gloss-item">
                  <dt>
                    <Highlight text={t.term} needle={needle} />
                    {t.abbr && <span className="abbr">{t.abbr}</span>}
                  </dt>
                  <dd>
                    <Highlight text={t.def} needle={needle} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))
      )}
    </>
  );
}
