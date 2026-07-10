"use client";

/** ESPN team mark (same CDN as player headshots); hides itself on 404. */
export function TeamLogo({ team, size = 18 }: { team: string; size?: number }) {
  return (
    <img
      className="yb-team-logo"
      src={`https://a.espncdn.com/i/teamlogos/nfl/500/${team.toLowerCase()}.png`}
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
