"use client";

export interface BarDatum {
  label: string;
  value: number;
}

/** Minimal dependency-free horizontal bar chart (SVG). */
export function BarChart({ data, unit = "" }: { data: BarDatum[]; unit?: string }) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.value), 0) || 1;
  const rowH = 28;
  const gap = 8;
  const labelW = 150;
  const valueW = 64;
  const width = 640;
  const barArea = width - labelW - valueW;
  const height = data.length * (rowH + gap);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label="bar chart"
      style={{ maxWidth: width, marginTop: 12 }}
    >
      {data.map((d, i) => {
        const y = i * (rowH + gap);
        const w = Math.max((d.value / max) * barArea, 2);
        return (
          <g key={`${d.label}-${i}`}>
            <text
              x={labelW - 10}
              y={y + rowH / 2}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="13"
              fill="var(--muted)"
            >
              {d.label.length > 22 ? d.label.slice(0, 21) + "…" : d.label}
            </text>
            <rect
              x={labelW}
              y={y}
              width={w}
              height={rowH}
              rx={4}
              fill="var(--accent)"
              opacity={0.85}
            />
            <text
              x={labelW + w + 8}
              y={y + rowH / 2}
              dominantBaseline="middle"
              fontSize="13"
              fill="var(--text)"
            >
              {formatValue(d.value)}
              {unit ? ` ${unit}` : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function formatValue(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
