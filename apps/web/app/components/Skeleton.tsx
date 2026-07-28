/** Shimmer skeleton primitives + composed loading states. */

function Skel({
  w = "100%",
  h = 14,
  r = 8,
  style,
}: {
  w?: number | string;
  h?: number | string;
  r?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="yb-skel"
      style={{ width: w, height: h, borderRadius: r, ...style }}
    />
  );
}

/** Placeholder for a single leaderboard board. */
export function BoardSkeleton() {
  return (
    <section style={{ marginTop: 32 }} aria-busy="true">
      <Skel w={160} h={16} style={{ marginBottom: 14 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[96, 80, 67, 55, 44, 33].map((pct, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Skel w={130} h={12} />
            <Skel w={`${pct}%`} h={22} r={4} />
          </div>
        ))}
      </div>
    </section>
  );
}
