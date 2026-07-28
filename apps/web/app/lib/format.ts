export function formatRecord(wins: number, losses: number, ties = 0): string {
  return `${wins}-${losses}${ties ? `-${ties}` : ""}`;
}

export function formatPct(value: number): string {
  return value.toFixed(3).replace(/^0/, "");
}

export function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export function formatStatValue(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString("en-US") : value.toFixed(1);
}

export function formatGameDate(iso: string | null): string {
  if (!iso) return "Date TBD";
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Playoff weeks get round names; regular-season weeks stay numbered.
 * 2021+ seasons play 18 regular-season weeks, earlier seasons 17. */
export function weekLabel(week: number, season: number, short = false): string {
  const regWeeks = season >= 2021 ? 18 : 17;
  if (week <= regWeeks) return short ? `Wk ${week}` : `Week ${week}`;
  const rounds = ["Wild Card", "Divisional", "Championship", "Super Bowl"];
  return rounds[week - regWeeks - 1] ?? `Week ${week}`;
}

/** Drop the conference prefix from a division name ("AFC East" → "East"). */
export function divisionShortName(division: string): string {
  return division.replace(/^(AFC|NFC)\s+/, "");
}

export function formatRank(rank: number): string {
  const suffix =
    rank % 100 >= 11 && rank % 100 <= 13
      ? "th"
      : rank % 10 === 1
        ? "st"
        : rank % 10 === 2
          ? "nd"
          : rank % 10 === 3
            ? "rd"
            : "th";
  return `${rank}${suffix}`;
}
