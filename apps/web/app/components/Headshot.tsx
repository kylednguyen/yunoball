"use client";

import { useState } from "react";

/** Player headshot from ESPN's CDN, falling back to an initials avatar when
 *  no ESPN id is mapped (or the image 404s) — the page never shows a broken
 *  image, it just gets richer once ids are populated. */
export function Headshot({
  src,
  name,
  size = 36,
}: {
  src: string | null | undefined;
  name: string;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  if (!src || broken) {
    return (
      <span
        className="yb-avatar fallback"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
        aria-hidden="true"
      >
        {initials}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="yb-avatar"
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}
