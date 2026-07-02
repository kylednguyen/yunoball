import Image from "next/image";

import { HEADSHOT_HOST, headshotThumb, initials, teamColor } from "../lib/teams";

/** Player face: real headshot when the warehouse has one (ringed in the
 *  player's team color), team-colored monogram otherwise. */
export function Avatar({
  name,
  team,
  headshotUrl,
  size = 34,
}: {
  name: string;
  team: string | null | undefined;
  headshotUrl?: string | null;
  size?: number;
}) {
  const c = teamColor(team);
  // Only the host allowed in next.config.ts — anything else would throw in next/image.
  if (headshotUrl?.startsWith(HEADSHOT_HOST)) {
    return (
      <span
        className="avatar avatar-photo"
        aria-hidden
        style={{ width: size, height: size, borderColor: c.bg }}
      >
        <Image
          src={headshotThumb(headshotUrl, size * 2)}
          alt=""
          width={size}
          height={size}
          unoptimized
        />
      </span>
    );
  }
  return (
    <span
      className="avatar"
      aria-hidden
      style={{
        width: size,
        height: size,
        background: c.bg,
        color: c.fg,
        fontSize: Math.round(size * 0.36),
      }}
    >
      {initials(name)}
    </span>
  );
}
