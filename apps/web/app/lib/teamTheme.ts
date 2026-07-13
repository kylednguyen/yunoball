/** Dynamic team theming — purely presentational.
 *
 *  When the active context is one team (a team page, a player's profile,
 *  a single-team answer), the accent token family re-tints to that team's
 *  branding. Only accent-driven UI changes — buttons, active tabs, links,
 *  chart marks, stat highlights. Backgrounds and neutrals never recolor.
 *
 *  Hues are static brand-adjacent tones tuned for the dark surface: where
 *  a franchise's primary is too dark to read (midnight green, navy), the
 *  tone is lifted toward its bright broadcast variant. This is styling
 *  data, not warehouse data — it lives with the UI on purpose.
 */

import type { CSSProperties } from "react";

const TEAM_HUES: Record<string, string> = {
  ARI: "#c94a62",
  ATL: "#e0393e",
  BAL: "#9d7be0",
  BUF: "#4a8fe2",
  CAR: "#0085ca",
  CHI: "#e8642b",
  CIN: "#fb4f14",
  CLE: "#ff6a39",
  DAL: "#5a9bd8",
  DEN: "#fa5a1e",
  DET: "#2e9bd6",
  GB: "#6aa832",
  HOU: "#c9243f",
  IND: "#5289d6",
  JAX: "#00a5b8",
  KC: "#e31837",
  LAC: "#0080c6",
  LAR: "#5b8dee",
  LV: "#b9bfc2",
  MIA: "#00a3ae",
  MIN: "#8a63d2",
  NE: "#d64258",
  NO: "#d3bc8d",
  NYG: "#4a72d1",
  NYJ: "#2ba36a",
  PHI: "#1d9f98",
  PIT: "#ffb612",
  SEA: "#69be28",
  SF: "#d5303e",
  TB: "#e13c3c",
  TEN: "#4b92db",
  WAS: "#c1443d",
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

function alpha(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

const DARK_INK = 0.013; // luminance of near-black text (#0c0d0f-ish)

/** CSS-variable overrides for one team's accent, or undefined when the
 *  team is unknown — spread onto a container's style to scope the theme. */
export function teamTheme(teamId: string | null | undefined): CSSProperties | undefined {
  const hue = teamId ? TEAM_HUES[teamId] : undefined;
  if (!hue) return undefined;
  const lum = luminance(rgb(hue));
  // Text on a solid accent fill: whichever ink reads better.
  const ink = contrast(lum, DARK_INK) >= contrast(lum, 1) ? "#0c0d0f" : "#ffffff";
  return {
    "--accent": hue,
    "--accent-hover": lighten(hue, 0.12),
    "--accent-ink": lighten(hue, 0.28),
    "--accent-soft": alpha(hue, 0.14),
    "--accent-border": alpha(hue, 0.4),
    "--accent-contrast": ink,
    "--chart": hue,
    "--chart-strong": hue,
  } as CSSProperties;
}
