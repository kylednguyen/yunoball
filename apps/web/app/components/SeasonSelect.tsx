"use client";

import { Dropdown } from "./Dropdown";

/** The season dropdown every stat page shares (in-house, not the OS menu). */
export function SeasonSelect({
  seasons,
  value,
  onChange,
}: {
  seasons: number[];
  value: number;
  onChange: (season: number) => void;
}) {
  return (
    <Dropdown
      ariaLabel="Select season"
      value={String(value)}
      onChange={(v) => onChange(Number(v))}
      options={seasons.map((s) => ({ value: String(s), label: `${s} season` }))}
    />
  );
}
