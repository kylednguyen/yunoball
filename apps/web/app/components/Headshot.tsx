"use client";

import { useState } from "react";

export type HeadshotScale =
  | "compact"
  | "row"
  | "card"
  | "feature"
  | "comparison"
  | "profile";

const HEADSHOT_SCALES: Record<
  HeadshotScale,
  { width: number; height: number; variant: "avatar" | "portrait" }
> = {
  compact: { width: 28, height: 28, variant: "avatar" },
  row: { width: 34, height: 34, variant: "avatar" },
  card: { width: 52, height: 52, variant: "avatar" },
  feature: { width: 68, height: 68, variant: "avatar" },
  comparison: { width: 72, height: 72, variant: "avatar" },
  profile: { width: 196, height: 246, variant: "portrait" },
};

/** ESPN's combiner resizes assets at the edge instead of sending the full
 * source image. Callers choose the pixel size needed for their density. */
export function cdnResize(src: string, px: number, square = true): string {
  if (!src.startsWith("https://a.espncdn.com/i/")) return src;
  const height = square ? `&h=${px}` : "";
  return `https://a.espncdn.com/combiner/i?img=${src.slice("https://a.espncdn.com".length)}&w=${px}${height}`;
}

/** Player headshot from ESPN's CDN, falling back to an initials avatar when
 *  no ESPN id is mapped (or the image 404s) — the page never shows a broken
 *  image, it just gets richer once ids are populated. */
export function Headshot({
  src,
  name,
  size = 36,
  width,
  height,
  variant,
  scale,
  priority = false,
}: {
  src: string | null | undefined;
  name: string;
  size?: number;
  width?: number;
  height?: number;
  variant?: "avatar" | "portrait";
  scale?: HeadshotScale;
  priority?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const preset = scale ? HEADSHOT_SCALES[scale] : undefined;
  const renderedWidth = width ?? preset?.width ?? size;
  const renderedHeight = height ?? preset?.height ?? size;
  const renderedVariant = variant ?? preset?.variant ?? "avatar";
  const classes = `yb-avatar${renderedVariant === "portrait" ? " portrait" : ""}`;
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  if (!src || broken) {
    return (
      <span
        className={`${classes} fallback`}
        style={{
          width: renderedWidth,
          height: renderedHeight,
          fontSize: Math.round(renderedWidth * 0.36),
        }}
        aria-hidden="true"
      >
        {initials}
      </span>
    );
  }
  const requestedSize = Math.min(640, Math.max(128, Math.ceil(renderedWidth * 3)));
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={classes}
      src={cdnResize(src, requestedSize, false)}
      alt=""
      width={renderedWidth}
      height={renderedHeight}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      onError={() => setBroken(true)}
    />
  );
}
