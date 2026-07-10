"use client";

import { type ReactNode, useMemo, useState } from "react";

export interface SortColumn<T> {
  key: string;
  label: ReactNode;
  /** Right-aligned, tabular numerals; first click sorts descending. */
  numeric?: boolean;
  width?: number | string;
  /** Value used for sorting (and display when no render is given). */
  value: (row: T) => string | number | null;
  render?: (row: T) => ReactNode;
}

interface Sort {
  key: string;
  dir: "asc" | "desc";
}

/** Stat table with click-to-sort column headers (sports-reference style). */
export function SortTable<T>({
  columns,
  rows,
  rowKey,
  rowClass,
  defaultSort,
}: {
  columns: SortColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowClass?: (row: T) => string | undefined;
  defaultSort?: Sort;
}) {
  const [sort, setSort] = useState<Sort | null>(defaultSort ?? null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = col.value(a);
      const vb = col.value(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // empty cells sink regardless of direction
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [rows, sort, columns]);

  function toggle(col: SortColumn<T>) {
    setSort((s) =>
      s?.key === col.key
        ? { key: col.key, dir: s.dir === "desc" ? "asc" : "desc" }
        : { key: col.key, dir: col.numeric ? "desc" : "asc" },
    );
  }

  return (
    <div className="yb-table-scroll">
      <table className="yb-table">
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={c.numeric ? "num" : undefined}
                  style={c.width ? { width: c.width } : undefined}
                  aria-sort={
                    active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined
                  }
                >
                  <button
                    type="button"
                    className={`yb-th-sort${active ? " on" : ""}`}
                    onClick={() => toggle(c)}
                  >
                    {c.label}
                    <span className="dir" aria-hidden="true">
                      {active ? (sort!.dir === "asc" ? "▴" : "▾") : ""}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={rowKey(row)} className={rowClass?.(row)}>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? "num" : undefined}>
                  {c.render ? c.render(row) : (c.value(row) ?? "-")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
