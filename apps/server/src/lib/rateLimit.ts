/** Fixed-window rate limiting per client IP for the search/agent endpoints.
 * In-process counters (single-instance API); windows expire by key rotation.
 * ponytail: swap the Map for Redis INCR if the API ever runs multi-instance. */

import type { Request } from "express";
import { config } from "../config.js";

const WINDOW_SECONDS = 60;
const counts = new Map<string, number>();
let currentWindow = 0;

// Cap on distinct keys held in a single window — a spoofed/rotated source can
// otherwise insert unbounded entries before the next-window clear().
const MAX_KEYS = 100_000;

export function clientIp(req: Request): string {
  // req.ip honors the app's `trust proxy` setting (configured in app.ts), so a
  // client can't mint a fresh bucket by forging X-Forwarded-For — only the
  // configured number of proxy hops are trusted.
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

/** Returns null to allow, or seconds until the window resets when over limit.
 * `key` should namespace the tier (e.g. "w:<ip>" vs "r:<ip>") so read and write
 * tiers count in separate buckets; `limit` defaults to the write limit. */
export function retryAfter(key: string, limit = config.rateLimitPerMinute): number | null {
  if (limit <= 0) return null;
  const now = Math.floor(Date.now() / 1000);
  const window = Math.floor(now / WINDOW_SECONDS);
  if (window !== currentWindow) {
    counts.clear();
    currentWindow = window;
  }
  const n = (counts.get(key) ?? 0) + 1;
  // Stop tracking new keys once the map is saturated within a window; existing
  // keys keep counting so real clients are still limited.
  if (counts.has(key) || counts.size < MAX_KEYS) counts.set(key, n);
  if (n > limit) return WINDOW_SECONDS - (now % WINDOW_SECONDS);
  return null;
}
