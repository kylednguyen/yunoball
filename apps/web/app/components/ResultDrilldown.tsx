"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { AnswerResult, PlayerProfile } from "../lib/api";
import { fetchPlayer } from "../lib/api";
import { Headshot } from "./Headshot";
import { TeamLogo } from "./TeamLogo";

/** Player-leaderboard result: the leader (or tied leaders) as a team-coloured
 * card, then the ranked table. */
export function ResultDrilldown({ result, leaderboard }: { result: AnswerResult; leaderboard: ReactNode }) {
  const [profiles, setProfiles] = useState<PlayerProfile[]>([]);
  const leaders = useMemo(() => {
    const first = result.rows[0];
    if (!first) return [];
    const leadingValue = Number(first.value);
    return result.rows.filter((row) => Number(row.value) === leadingValue && row.player_id);
  }, [result.rows]);
  const leaderIds = useMemo(() => leaders.map((row) => String(row.player_id)), [leaders]);

  useEffect(() => {
    let active = true;
    Promise.allSettled(leaderIds.map((id) => fetchPlayer(id)))
      .then((items) => {
        if (!active) return;
        setProfiles(items.flatMap((item) => (item.status === "fulfilled" && item.value ? [item.value] : [])));
      })
      .catch(() => active && setProfiles([]));
    return () => {
      active = false;
    };
  }, [leaderIds]);

  const profileById = new Map(profiles.map((profile) => [profile.player_id, profile]));

  return (
    <section className="yb-result-drilldown" aria-label="Result">
      <div className="yb-result-leaders" aria-label={leaders.length > 1 ? "Tied leaders" : "Leader"}>
        {leaders.map((row) => {
          const id = String(row.player_id);
          const profile = profileById.get(id);
          return (
            <article key={id} className="yb-result-leader-card" data-themed={Boolean(profile?.team)}>
              {profile && <Headshot src={profile.headshot_url} name={profile.name} scale="feature" />}
              <div>
                <span>{leaders.length > 1 ? "Tied leader" : "Leader"}</span>
                <h2>{String(row.full_name)}</h2>
                <p>
                  {profile?.team && <TeamLogo team={profile.team} size={14} />}
                  {profile?.team_name ?? profile?.team ?? "NFL"} · {String(row.value)}{" "}
                  {result.query_context?.metric_label ?? "value"}
                </p>
              </div>
              <Link className="yb-table-profile-link" href={`/players/${encodeURIComponent(id)}`}>
                View profile →
              </Link>
            </article>
          );
        })}
      </div>
      <div className="yb-result-ranked-table">{leaderboard}</div>
    </section>
  );
}
