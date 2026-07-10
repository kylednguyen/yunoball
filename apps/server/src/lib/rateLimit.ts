/** Fixed-window rate limiting per client IP for the search/agent endpoints.
 * In-process counters (single-instance API); windows expire by key rotation.
 * ponytail: swap the Map for Redis INCR if the API ever runs multi-instance. */

import type { Request } from "express";
import { config } from "../config.js";

const WINDOW_SECONDS = 60;
const counts = new Map<string, number>();
let currentWindow = 0;

export function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]!.trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

/** Returns null to allow, or seconds until the window resets when over limit. */
export function retryAfter(ip: string): number | null {
  const limit = config.rateLimitPerMinute;
  if (limit <= 0) return null;
  const now = Math.floor(Date.now() / 1000);
  const window = Math.floor(now / WINDOW_SECONDS);
  if (window !== currentWindow) {
    counts.clear();
    currentWindow = window;
  }
  const n = (counts.get(ip) ?? 0) + 1;
  counts.set(ip, n);
  if (n > limit) return WINDOW_SECONDS - (now % WINDOW_SECONDS);
  return null;
}
