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

/** Resize at the CDN edge instead of shipping the full source image — the
 * nflverse headshots are 3400px originals that decode visibly late in small
 * avatars. ESPN goes through its combiner; nfl.com URLs are Cloudinary-style
 * and take transforms inline. Callers choose the pixel size for their density. */
export function cdnResize(src: string, px: number, square = true): string {
  if (src.startsWith("https://a.espncdn.com/i/")) {
    const height = square ? `&h=${px}` : "";
    return `https://a.espncdn.com/combiner/i?img=${src.slice("https://a.espncdn.com".length)}&w=${px}${height}`;
  }
  if (src.startsWith("https://static.www.nfl.com/image/upload/")) {
    const crop = square ? `,h_${px},c_fill` : "";
    return src.includes("f_auto,q_auto")
      ? src.replace("f_auto,q_auto", `f_auto,q_auto,w_${px}${crop}`)
      : src.replace("/image/upload/", `/image/upload/f_auto,q_auto,w_${px}${crop}/`);
  }
  return src;
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
