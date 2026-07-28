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

const NFL_TEAM_COLORS: Record<
  string,
  { name: string; primary: string; secondary: string; accent: string }
> = {
  ARI: { name: "Arizona Cardinals", primary: "#97233F", secondary: "#000000", accent: "#FFB612" },
  ATL: { name: "Atlanta Falcons", primary: "#A71930", secondary: "#000000", accent: "#A5ACAF" },
  BAL: { name: "Baltimore Ravens", primary: "#241773", secondary: "#000000", accent: "#9E7C0C" },
  BUF: { name: "Buffalo Bills", primary: "#00338D", secondary: "#C60C30", accent: "#FFFFFF" },
  CAR: { name: "Carolina Panthers", primary: "#0085CA", secondary: "#101820", accent: "#BFC0BF" },
  CHI: { name: "Chicago Bears", primary: "#0B162A", secondary: "#C83803", accent: "#FFFFFF" },
  CIN: { name: "Cincinnati Bengals", primary: "#FB4F14", secondary: "#000000", accent: "#FFFFFF" },
  CLE: { name: "Cleveland Browns", primary: "#311D00", secondary: "#FF3C00", accent: "#FFFFFF" },
  DAL: { name: "Dallas Cowboys", primary: "#003594", secondary: "#041E42", accent: "#869397" },
  DEN: { name: "Denver Broncos", primary: "#FB4F14", secondary: "#002244", accent: "#FFFFFF" },
  DET: { name: "Detroit Lions", primary: "#0076B6", secondary: "#B0B7BC", accent: "#000000" },
  GB: { name: "Green Bay Packers", primary: "#203731", secondary: "#FFB612", accent: "#FFFFFF" },
  HOU: { name: "Houston Texans", primary: "#03202F", secondary: "#A71930", accent: "#FFFFFF" },
  IND: { name: "Indianapolis Colts", primary: "#002C5F", secondary: "#A2AAAD", accent: "#FFFFFF" },
  JAX: { name: "Jacksonville Jaguars", primary: "#006778", secondary: "#101820", accent: "#D7A22A" },
  KC: { name: "Kansas City Chiefs", primary: "#E31837", secondary: "#FFB81C", accent: "#FFFFFF" },
  LV: { name: "Las Vegas Raiders", primary: "#000000", secondary: "#A5ACAF", accent: "#FFFFFF" },
  LAC: { name: "Los Angeles Chargers", primary: "#0080C6", secondary: "#FFC20E", accent: "#FFFFFF" },
  LAR: { name: "Los Angeles Rams", primary: "#003594", secondary: "#FFA300", accent: "#FFFFFF" },
  MIA: { name: "Miami Dolphins", primary: "#008E97", secondary: "#FC4C02", accent: "#005778" },
  MIN: { name: "Minnesota Vikings", primary: "#4F2683", secondary: "#FFC62F", accent: "#FFFFFF" },
  NE: { name: "New England Patriots", primary: "#002244", secondary: "#C60C30", accent: "#B0B7BC" },
  NO: { name: "New Orleans Saints", primary: "#D3BC8D", secondary: "#101820", accent: "#FFFFFF" },
  NYG: { name: "New York Giants", primary: "#0B2265", secondary: "#A71930", accent: "#A5ACAF" },
  NYJ: { name: "New York Jets", primary: "#125740", secondary: "#000000", accent: "#FFFFFF" },
  PHI: { name: "Philadelphia Eagles", primary: "#004C54", secondary: "#A5ACAF", accent: "#000000" },
  PIT: { name: "Pittsburgh Steelers", primary: "#FFB612", secondary: "#101820", accent: "#FFFFFF" },
  SF: { name: "San Francisco 49ers", primary: "#AA0000", secondary: "#B3995D", accent: "#FFFFFF" },
  SEA: { name: "Seattle Seahawks", primary: "#002244", secondary: "#69BE28", accent: "#A5ACAF" },
  TB: { name: "Tampa Bay Buccaneers", primary: "#D50A0A", secondary: "#34302B", accent: "#FF7900" },
  TEN: { name: "Tennessee Titans", primary: "#0C2340", secondary: "#4B92DB", accent: "#C8102E" },
  WAS: { name: "Washington Commanders", primary: "#5A1414", secondary: "#FFB612", accent: "#FFFFFF" },
};

/** Team full names, derived from the colour palette (one source of truth). */
export const NFL_TEAM_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(NFL_TEAM_COLORS).map(([id, c]) => [id, c.name]),
);

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

/** Rough saturation (0..1): how far the colour is from grey. Strong brand hues
 *  (gold, green, red) score high; silver/white/black score near zero. */
function chroma(hex: string): number {
  const [r, g, b] = rgb(hex);
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

const DARK_INK = 0.013; // luminance of near-black text (#0c0d0f-ish)
const BG_LUM = luminance(rgb("#0a0c11")); // the app's dark canvas

/** The team's own brand colour to use for accent text/labels on the dark
 *  canvas. Prefer the most vivid palette colour that actually reads (Seahawks
 *  green, Commanders gold), so the theme shows the real colours instead of a
 *  washed-out lightened primary. Falls back to the primary if nothing reads. */
function readableInk(palette: { primary: string; secondary: string; accent: string }): string {
  const reads = (hex: string, min: number) => contrast(luminance(rgb(hex)), BG_LUM) >= min;
  const cands = [palette.primary, palette.secondary, palette.accent];
  const vivid = cands.find((c) => chroma(c) >= 0.25 && reads(c, 3.4));
  if (vivid) return vivid;
  return cands.find((c) => reads(c, 3.2)) ?? palette.primary;
}

/** CSS-variable overrides for one team's accent, or undefined when the
 *  team is unknown — spread onto a container's style to scope the theme. */
export function teamTheme(
  teamId: string | null | undefined,
): CSSProperties | undefined {
  const palette = teamId ? NFL_TEAM_COLORS[teamId] : undefined;
  if (!palette) return undefined;
  const hue = palette.primary;
  const lum = luminance(rgb(hue));
  // Readability first. A team's second colour is usually another strong hue
  // (navy + gold, purple + gold), and coloured ink on a coloured card reads
  // badly. Only borrow a brand colour for text when it's a near-neutral
  // (silver / white / black); every strong hue falls back to plain black or
  // white — whichever the primary surface carries at >= 4.5:1.
  const safeInk = contrast(lum, DARK_INK) >= contrast(lum, 1) ? "#0c0d0f" : "#ffffff";
  const inkCandidates = [palette.secondary, palette.accent];
  const contrastInk = inkCandidates.find(
    (candidate) =>
      chroma(candidate) <= 0.2 &&
      contrast(lum, luminance(rgb(candidate))) >= 4.5,
  ) ?? safeInk;
  // Base team colours straight from the palette — no lightening or muting. The
  // primary drives solid surfaces; the brand ink (a real palette colour that
  // reads on dark) drives accent text/labels. Only backgrounds carry a tint.
  const ink = readableInk(palette);
  return {
    "--accent": hue,
    "--accent-deep": hue,
    "--accent-hover": ink,
    "--accent-ink": ink,
    // No coloured tint: a low-opacity team colour over the dark canvas goes
    // muddy. Soft surfaces stay a clean neutral; the brand shows in the text.
    "--accent-soft": "var(--elevated)",
    "--accent-border": "var(--border)",
    "--accent-contrast": contrastInk,
    "--chart": hue,
    "--chart-strong": ink,
  } as CSSProperties;
}
