"use client";

import { cdnResize } from "./Headshot";

/** ESPN team mark (same CDN as player headshots); hides itself on 404.
 *  Served at 128px via the CDN combiner (~3KB vs 40KB for the 500px
 *  original) — largest render is 64px, so 128 covers 2x displays. */
export function TeamLogo({ team, size = 18 }: { team: string; size?: number }) {
  return (
    <img
      className="yb-team-logo"
      src={cdnResize(`https://a.espncdn.com/i/teamlogos/nfl/500/${team.toLowerCase()}.png`, 128)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={(e) => {
        e.currentTarget.style.visibility = "hidden";
      }}
    />
  );
}
