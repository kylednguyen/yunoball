/** Shimmer skeleton primitives + composed loading states. */

export function Skel({
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

/** Placeholder while an answer is loading — mirrors the AnswerCard layout. */
export function AnswerSkeleton() {
  return (
    <section className="yb-card" style={{ marginTop: 28 }} aria-busy="true" aria-label="Loading answer">
      <Skel w="85%" h={26} style={{ marginBottom: 10 }} />
      <Skel w="55%" h={26} style={{ marginBottom: 20 }} />
      {/* chart bars */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
        {[92, 74, 61, 48, 34].map((pct, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Skel w={110} h={12} />
            <Skel w={`${pct}%`} h={22} r={4} />
          </div>
        ))}
      </div>
      {/* table rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {[0, 1, 2, 3].map((i) => (
          <Skel key={i} h={16} />
        ))}
      </div>
    </section>
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
