/** NFL team brand colors for avatars and accents. fg is chosen for contrast
 *  against bg. Includes common historical codes (OAK, SD, STL) since the
 *  warehouse goes back to 1999. */
export interface TeamColor {
  bg: string;
  fg: string;
}

const FALLBACK: TeamColor = { bg: "#2a3833", fg: "#f1efe6" };

export const TEAM_COLORS: Record<string, TeamColor> = {
  ARI: { bg: "#97233f", fg: "#ffffff" },
  ATL: { bg: "#a71930", fg: "#ffffff" },
  BAL: { bg: "#241773", fg: "#ffffff" },
  BUF: { bg: "#00338d", fg: "#ffffff" },
  CAR: { bg: "#0085ca", fg: "#0b1310" },
  CHI: { bg: "#0b162a", fg: "#ffffff" },
  CIN: { bg: "#fb4f14", fg: "#0b1310" },
  CLE: { bg: "#311d00", fg: "#ff9e57" },
  DAL: { bg: "#003594", fg: "#ffffff" },
  DEN: { bg: "#fb4f14", fg: "#0b1310" },
  DET: { bg: "#0076b6", fg: "#ffffff" },
  GB: { bg: "#203731", fg: "#ffb612" },
  HOU: { bg: "#03202f", fg: "#ffffff" },
  IND: { bg: "#002c5f", fg: "#ffffff" },
  JAX: { bg: "#006778", fg: "#ffffff" },
  KC: { bg: "#e31837", fg: "#ffffff" },
  LA: { bg: "#003594", fg: "#ffa300" },
  LAC: { bg: "#0080c6", fg: "#ffc20e" },
  LAR: { bg: "#003594", fg: "#ffa300" },
  LV: { bg: "#a5acaf", fg: "#0b1310" },
  MIA: { bg: "#008e97", fg: "#ffffff" },
  MIN: { bg: "#4f2683", fg: "#ffc62f" },
  NE: { bg: "#002244", fg: "#ffffff" },
  NO: { bg: "#d3bc8d", fg: "#0b1310" },
  NYG: { bg: "#0b2265", fg: "#ffffff" },
  NYJ: { bg: "#125740", fg: "#ffffff" },
  OAK: { bg: "#a5acaf", fg: "#0b1310" },
  PHI: { bg: "#004c54", fg: "#a5acaf" },
  PIT: { bg: "#ffb612", fg: "#0b1310" },
  SD: { bg: "#0080c6", fg: "#ffc20e" },
  SEA: { bg: "#002244", fg: "#69be28" },
  SF: { bg: "#aa0000", fg: "#ffffff" },
  STL: { bg: "#003594", fg: "#ffa300" },
  TB: { bg: "#d50a0a", fg: "#ffffff" },
  TEN: { bg: "#0c2340", fg: "#4b92db" },
  WAS: { bg: "#5a1414", fg: "#ffb612" },
};

export function teamColor(team: string | null | undefined): TeamColor {
  return (team && TEAM_COLORS[team]) || FALLBACK;
}

export const HEADSHOT_HOST = "https://static.www.nfl.com/";

/** The warehouse stores unsized Cloudinary originals (multi-MB). Swap the
 *  transform segment for a face-cropped thumbnail at the requested pixel size. */
export function headshotThumb(url: string, px: number): string {
  return url.replace(
    "/image/private/f_auto,q_auto/",
    `/image/private/f_auto,q_auto,w_${px},h_${px},c_fill,g_face/`,
  );
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
