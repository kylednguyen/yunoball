/** Shimmer skeleton primitives + composed loading states. */

import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

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
  return <Skeleton style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

/** Placeholder while an answer is loading — mirrors the AnswerCard layout. */
export function AnswerSkeleton() {
  return (
    <Card className="mt-7 p-6" aria-busy="true" aria-label="Loading answer">
      <Skel w="85%" h={26} style={{ marginBottom: 10 }} />
      <Skel w="55%" h={26} style={{ marginBottom: 20 }} />
      {/* chart bars */}
      <div className="mb-5 flex flex-col gap-2.5">
        {[92, 74, 61, 48, 34].map((pct, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skel w={110} h={12} />
            <Skel w={`${pct}%`} h={22} r={4} />
          </div>
        ))}
      </div>
      {/* table rows */}
      <div className="flex flex-col gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skel key={i} h={16} />
        ))}
      </div>
    </Card>
  );
}

/** Placeholder for a single leaderboard board. */
export function BoardSkeleton() {
  return (
    <section className="mt-8" aria-busy="true">
      <Skel w={160} h={16} style={{ marginBottom: 14 }} />
      <div className="flex flex-col gap-2.5">
        {[96, 80, 67, 55, 44, 33].map((pct, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skel w={130} h={12} />
            <Skel w={`${pct}%`} h={22} r={4} />
          </div>
        ))}
      </div>
    </section>
  );
}
