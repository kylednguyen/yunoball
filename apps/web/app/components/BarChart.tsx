"use client";

export interface BarDatum {
  label: string;
  value: number;
}

/** Minimal dependency-free horizontal bar chart (SVG), StatMuse-clean. */
export function BarChart({ data, unit = "" }: { data: BarDatum[]; unit?: string }) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.value), 0) || 1;
  const rowH = 30;
  const gap = 9;
  const labelW = 168;
  const valueW = 74;
  const width = 660;
  const barArea = width - labelW - valueW;
  const height = data.length * (rowH + gap) - gap;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label="bar chart"
      style={{ maxWidth: width, marginTop: 14, display: "block" }}
    >
      {data.map((d, i) => {
        const y = i * (rowH + gap);
        const w = Math.max((d.value / max) * barArea, 3);
        return (
          <g key={`${d.label}-${i}`}>
            <text
              x={labelW - 12}
              y={y + rowH / 2}
              textAnchor="end"
              dominantBaseline="central"
              fontSize="13.5"
              fontWeight="500"
              fill="var(--muted)"
            >
              {d.label.length > 24 ? d.label.slice(0, 23) + "…" : d.label}
            </text>
            <rect x={labelW} y={y} width={barArea} height={rowH} rx={7} fill="var(--bg-soft)" />
            <rect x={labelW} y={y} width={w} height={rowH} rx={7} fill="var(--accent)" />
            <text
              x={labelW + w + 10}
              y={y + rowH / 2}
              dominantBaseline="central"
              fontSize="13.5"
              fontWeight="700"
              fill="var(--text)"
            >
              {fmtValue(d.value)}
              {unit ? ` ${unit}` : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function fmtValue(v: number): string {
  return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
