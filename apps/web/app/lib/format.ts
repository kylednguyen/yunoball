export function formatRecord(wins: number, losses: number, ties = 0): string {
  return `${wins}-${losses}${ties ? `-${ties}` : ""}`;
}

export function formatPct(value: number): string {
  return value.toFixed(3).replace(/^0/, "");
}

export function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export function formatNumber(value: number, decimals = 0): string {
  return Number.isInteger(value) && decimals === 0
    ? value.toLocaleString("en-US")
    : value.toLocaleString("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
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
