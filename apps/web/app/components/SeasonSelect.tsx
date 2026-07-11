"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** The season dropdown every stat page shares. */
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
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className="w-[160px]" aria-label="Select season">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {seasons.map((s) => (
          <SelectItem key={s} value={String(s)}>
            {s} season
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
