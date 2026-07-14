/** Dynamic team theming — purely presentational.
 *
 *  When the active context is one team (a team page, a player's profile,
 *  a single-team answer), the accent token family re-tints to that team's
 *  branding. Only accent-driven UI changes — buttons, active tabs, links,
 *  chart marks, stat highlights. Backgrounds and neutrals never recolor.
 *
 *  Brand values are the canonical primary, secondary and accent colors.
 *  Solid team surfaces use primary; readable foreground selection may use
 *  secondary or accent before falling back to safe light/dark ink.
 */

import type { CSSProperties } from "react";

export const NFL_TEAM_COLORS: Record<
  string,
  { primary: string; secondary: string; accent: string }
> = {
  ARI: { primary: "#97233F", secondary: "#000000", accent: "#FFB612" },
  ATL: { primary: "#A71930", secondary: "#000000", accent: "#A5ACAF" },
  BAL: { primary: "#241773", secondary: "#000000", accent: "#9E7C0C" },
  BUF: { primary: "#00338D", secondary: "#C60C30", accent: "#FFFFFF" },
  CAR: { primary: "#0085CA", secondary: "#101820", accent: "#BFC0BF" },
  CHI: { primary: "#0B162A", secondary: "#C83803", accent: "#FFFFFF" },
  CIN: { primary: "#FB4F14", secondary: "#000000", accent: "#FFFFFF" },
  CLE: { primary: "#311D00", secondary: "#FF3C00", accent: "#FFFFFF" },
  DAL: { primary: "#003594", secondary: "#041E42", accent: "#869397" },
  DEN: { primary: "#FB4F14", secondary: "#002244", accent: "#FFFFFF" },
  DET: { primary: "#0076B6", secondary: "#B0B7BC", accent: "#000000" },
  GB: { primary: "#203731", secondary: "#FFB612", accent: "#FFFFFF" },
  HOU: { primary: "#03202F", secondary: "#A71930", accent: "#FFFFFF" },
  IND: { primary: "#002C5F", secondary: "#A2AAAD", accent: "#FFFFFF" },
  JAX: { primary: "#006778", secondary: "#101820", accent: "#D7A22A" },
  KC: { primary: "#E31837", secondary: "#FFB81C", accent: "#FFFFFF" },
  LV: { primary: "#000000", secondary: "#A5ACAF", accent: "#FFFFFF" },
  LAC: { primary: "#0080C6", secondary: "#FFC20E", accent: "#001432" },
  LAR: { primary: "#003594", secondary: "#FFA300", accent: "#FFD100" },
  MIA: { primary: "#008E97", secondary: "#FC4C02", accent: "#005778" },
  MIN: { primary: "#4F2683", secondary: "#FFC62F", accent: "#FFFFFF" },
  NE: { primary: "#002244", secondary: "#C60C30", accent: "#B0B7BC" },
  NO: { primary: "#D3BC8D", secondary: "#101820", accent: "#FFFFFF" },
  NYG: { primary: "#0B2265", secondary: "#A71930", accent: "#A5ACAF" },
  NYJ: { primary: "#125740", secondary: "#000000", accent: "#FFFFFF" },
  PHI: { primary: "#004C54", secondary: "#A5ACAF", accent: "#000000" },
  PIT: { primary: "#FFB612", secondary: "#101820", accent: "#C60C30" },
  SF: { primary: "#AA0000", secondary: "#B3995D", accent: "#000000" },
  SEA: { primary: "#002244", secondary: "#69BE28", accent: "#A5ACAF" },
  TB: { primary: "#D50A0A", secondary: "#34302B", accent: "#FF7900" },
  TEN: { primary: "#0C2340", secondary: "#4B92DB", accent: "#C8102E" },
  WAS: { primary: "#5A1414", secondary: "#FFB612", accent: "#000000" },
};

export const NFL_TEAM_NAMES: Record<string, string> = {
  ARI: "Arizona Cardinals", ATL: "Atlanta Falcons", BAL: "Baltimore Ravens",
  BUF: "Buffalo Bills", CAR: "Carolina Panthers", CHI: "Chicago Bears",
  CIN: "Cincinnati Bengals", CLE: "Cleveland Browns", DAL: "Dallas Cowboys",
  DEN: "Denver Broncos", DET: "Detroit Lions", GB: "Green Bay Packers",
  HOU: "Houston Texans", IND: "Indianapolis Colts", JAX: "Jacksonville Jaguars",
  KC: "Kansas City Chiefs", LV: "Las Vegas Raiders", LAC: "Los Angeles Chargers",
  LAR: "Los Angeles Rams", MIA: "Miami Dolphins", MIN: "Minnesota Vikings",
  NE: "New England Patriots", NO: "New Orleans Saints", NYG: "New York Giants",
  NYJ: "New York Jets", PHI: "Philadelphia Eagles", PIT: "Pittsburgh Steelers",
  SF: "San Francisco 49ers", SEA: "Seattle Seahawks", TB: "Tampa Bay Buccaneers",
  TEN: "Tennessee Titans", WAS: "Washington Commanders",
};

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG relative luminance. */
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Mix a color toward white by `t` (0..1) — the "ink" tint for accent text. */
function lighten(hex: string, t: number): string {
  const [r, g, b] = rgb(hex);
  const mix = (c: number) => Math.round(c + (255 - c) * t);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

/** Same-hue darker surface for controls sitting on a solid team card. */
function darken(hex: string, t: number): string {
  const [r, g, b] = rgb(hex);
  const mix = (c: number) => Math.round(c * (1 - t));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function alpha(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

const DARK_INK = 0.013; // luminance of near-black text (#0c0d0f-ish)

/** CSS-variable overrides for one team's accent, or undefined when the
 *  team is unknown — spread onto a container's style to scope the theme. */
export function teamTheme(
  teamId: string | null | undefined,
): CSSProperties | undefined {
  const palette = teamId ? NFL_TEAM_COLORS[teamId] : undefined;
  if (!palette) return undefined;
  const hue = palette.primary;
  const lum = luminance(rgb(hue));
  // Prefer the supplied brand pair, then the supplied accent, while enforcing
  // readable text on every solid primary surface.
  const safeInk = contrast(lum, DARK_INK) >= contrast(lum, 1) ? "#0c0d0f" : "#ffffff";
  const inkCandidates = [palette.secondary, palette.accent];
  const ink = inkCandidates.find(
    (candidate) => contrast(lum, luminance(rgb(candidate))) >= 4.5,
  ) ?? safeInk;
  return {
    "--accent": hue,
    "--accent-deep": darken(hue, 0.22),
    "--accent-hover": lighten(hue, 0.12),
    "--accent-ink": lighten(hue, 0.28),
    "--accent-soft": alpha(hue, 0.14),
    "--accent-border": alpha(hue, 0.4),
    "--accent-contrast": ink,
    "--chart": hue,
    "--chart-strong": hue,
  } as CSSProperties;
}
