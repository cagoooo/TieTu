import type { Request, Response, NextFunction, RequestHandler } from "express";
import { logger } from "../lib/logger";

interface Bucket {
  perMinute: number[];
  perDay: number[];
}

interface RateLimitOptions {
  perMinute: number;
  perDay: number;
  keyGenerator?: (req: Request) => string;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const buckets = new Map<string, Bucket>();

let cleanupTimer: NodeJS.Timeout | null = null;

function ensureCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    const dayAgo = now - DAY_MS;
    for (const [key, bucket] of buckets) {
      bucket.perMinute = bucket.perMinute.filter((t) => t > now - MINUTE_MS);
      bucket.perDay = bucket.perDay.filter((t) => t > dayAgo);
      if (bucket.perMinute.length === 0 && bucket.perDay.length === 0) {
        buckets.delete(key);
      }
    }
  }, 5 * MINUTE_MS);
  // Don't keep the event loop alive just for cleanup.
  cleanupTimer.unref?.();
}

function defaultKey(req: Request): string {
  // Express's req.ip respects the `trust proxy` setting; fall back when blank.
  return req.ip || req.socket?.remoteAddress || "unknown";
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  const { perMinute, perDay, keyGenerator = defaultKey } = options;
  ensureCleanupTimer();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyGenerator(req);
    const now = Date.now();
    const minuteAgo = now - MINUTE_MS;
    const dayAgo = now - DAY_MS;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { perMinute: [], perDay: [] };
      buckets.set(key, bucket);
    }

    bucket.perMinute = bucket.perMinute.filter((t) => t > minuteAgo);
    bucket.perDay = bucket.perDay.filter((t) => t > dayAgo);

    res.setHeader("X-RateLimit-Limit-Minute", String(perMinute));
    res.setHeader("X-RateLimit-Limit-Day", String(perDay));

    if (bucket.perMinute.length >= perMinute) {
      const retryAfter = Math.max(
        1,
        Math.ceil((bucket.perMinute[0] + MINUTE_MS - now) / 1000),
      );
      res.setHeader("Retry-After", String(retryAfter));
      res.setHeader("X-RateLimit-Remaining-Minute", "0");
      res.setHeader(
        "X-RateLimit-Remaining-Day",
        String(Math.max(0, perDay - bucket.perDay.length)),
      );
      logger.warn(
        { key, retryAfter, scope: "minute", limit: perMinute },
        "Rate limit exceeded",
      );
      res.status(429).json({
        error: `為了讓大家都能玩到，每分鐘最多只能生成 ${perMinute} 張貼圖，請等 ${retryAfter} 秒後再試一次。`,
        retryAfterSeconds: retryAfter,
        scope: "minute",
        limit: perMinute,
      });
      return;
    }

    if (bucket.perDay.length >= perDay) {
      const retryAfter = Math.max(
        1,
        Math.ceil((bucket.perDay[0] + DAY_MS - now) / 1000),
      );
      res.setHeader("Retry-After", String(retryAfter));
      res.setHeader(
        "X-RateLimit-Remaining-Minute",
        String(Math.max(0, perMinute - bucket.perMinute.length)),
      );
      res.setHeader("X-RateLimit-Remaining-Day", "0");
      logger.warn(
        { key, retryAfter, scope: "day", limit: perDay },
        "Rate limit exceeded",
      );
      res.status(429).json({
        error: `今天的免費生成額度（每人每天 ${perDay} 張）已經用完囉，請明天再回來試試！`,
        retryAfterSeconds: retryAfter,
        scope: "day",
        limit: perDay,
      });
      return;
    }

    bucket.perMinute.push(now);
    bucket.perDay.push(now);

    // Report remaining quota *after* counting this request so the value
    // reflects how many calls the client has left going forward.
    res.setHeader(
      "X-RateLimit-Remaining-Minute",
      String(Math.max(0, perMinute - bucket.perMinute.length)),
    );
    res.setHeader(
      "X-RateLimit-Remaining-Day",
      String(Math.max(0, perDay - bucket.perDay.length)),
    );

    next();
  };
}

export function __resetRateLimitForTests(): void {
  buckets.clear();
}
