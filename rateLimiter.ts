import { RateLimitError } from "../util/errors.js";

interface Bucket {
  count: number;
  windowStart: number;
}

/**
 * Simple fixed-window in-memory rate limiter, keyed per (guild, user,
 * bucket). This is process-local: a horizontally-scaled (multi-instance)
 * deployment needs a shared store (e.g. Redis) instead — see README
 * Limitations. Fine for a single-process bot, which is the common case for
 * a community-sized server.
 */
const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  /** Logical bucket name, e.g. "ask", "knowledge-write", "summarize". */
  bucket: string;
  guildId: string;
  userId: string;
  limit: number;
  windowMs: number;
}

/** Throws RateLimitError if the caller has exceeded `limit` calls within `windowMs`. Otherwise records the call. */
export function checkRateLimit(opts: RateLimitOptions): void {
  const key = `${opts.bucket}:${opts.guildId}:${opts.userId}`;
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || now - existing.windowStart >= opts.windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return;
  }

  if (existing.count >= opts.limit) {
    const retryAfterMs = opts.windowMs - (now - existing.windowStart);
    throw new RateLimitError(retryAfterMs);
  }

  existing.count += 1;
}

/** Periodic cleanup so the map doesn't grow unbounded across long uptimes. Safe to call on an interval. */
export function pruneRateLimitBuckets(maxAgeMs: number): void {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (now - bucket.windowStart > maxAgeMs) buckets.delete(key);
  }
}

/** Test-only: clears all in-memory rate limit state. */
export function resetRateLimitsForTests(): void {
  buckets.clear();
}
