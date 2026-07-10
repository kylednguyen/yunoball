"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

/** ESPN's combiner resizes on the CDN: full headshots are ~256KB, a 160px
 *  variant ~19KB. 160 covers the largest render (72px) at 2x. */
export function cdnResize(src: string, px: number): string {
  if (!src.startsWith("https://a.espncdn.com/i/")) return src;
  return `https://a.espncdn.com/combiner/i?img=${src.slice("https://a.espncdn.com".length)}&w=${px}&h=${px}`;
}

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
        className="inline-flex flex-none select-none items-center justify-center rounded-full border bg-muted font-bold text-muted-foreground"
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
      className={cn("inline-flex flex-none rounded-full border bg-muted object-cover align-middle")}
      src={cdnResize(src, 160)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}
