import type { Request, Response, NextFunction, RequestHandler } from "express";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db, rateLimitEvents } from "@workspace/db";
import { logger } from "../lib/logger";

interface RateLimitOptions {
  /**
   * Logical name for this limiter (stored in the `bucket` column). Use a
   * stable string per limiter instance, e.g. "sticker:generate". Multiple
   * limiters can share the underlying table without their counts colliding.
   */
  bucket: string;
  perMinute: number;
  perDay: number;
  keyGenerator?: (req: Request) => string;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * MINUTE_MS;

let cleanupTimer: NodeJS.Timeout | null = null;

async function deleteExpiredEvents(): Promise<void> {
  const cutoff = new Date(Date.now() - DAY_MS);
  try {
    await db.delete(rateLimitEvents).where(lt(rateLimitEvents.createdAt, cutoff));
  } catch (err) {
    logger.warn({ err }, "Rate limit cleanup failed");
  }
}

function ensureCleanupTimer(): void {
  if (cleanupTimer) return;
  // Kick off one cleanup soon after startup so old rows don't pile up while
  // we wait for the first interval tick.
  void deleteExpiredEvents();
  cleanupTimer = setInterval(() => {
    void deleteExpiredEvents();
  }, CLEANUP_INTERVAL_MS);
  // Don't keep the event loop alive just for cleanup.
  cleanupTimer.unref?.();
}

function defaultKey(req: Request): string {
  // Express's req.ip respects the `trust proxy` setting; fall back when blank.
  return req.ip || req.socket?.remoteAddress || "unknown";
}

export function rateLimit(options: RateLimitOptions): RequestHandler {
  const { bucket, perMinute, perDay, keyGenerator = defaultKey } = options;
  ensureCleanupTimer();

  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const key = keyGenerator(req);
    const now = Date.now();
    const dayAgo = new Date(now - DAY_MS);
    const minuteCutoffMs = now - MINUTE_MS;

    res.setHeader("X-RateLimit-Limit-Minute", String(perMinute));
    res.setHeader("X-RateLimit-Limit-Day", String(perDay));

    type Decision =
      | {
          kind: "ok";
          minuteCount: number;
          dayCount: number;
        }
      | {
          kind: "over";
          scope: "minute" | "day";
          retryAfter: number;
          minuteCount: number;
          dayCount: number;
        };

    let decision: Decision;
    try {
      // Run count-and-insert in a single transaction guarded by a Postgres
      // advisory lock keyed on (bucket, key). The lock is released
      // automatically when the transaction commits or rolls back, so
      // concurrent requests for the same client serialise here and cannot
      // race past the limit. Different (bucket, key) pairs do not block
      // each other because the lock pair is unique per key.
      decision = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${bucket}), hashtext(${key}))`,
        );

        // Fetch every event for this (bucket, key) within the last day.
        // Bounded by `perDay` (typically tens of rows) so this stays cheap.
        const recent = await tx
          .select({ createdAt: rateLimitEvents.createdAt })
          .from(rateLimitEvents)
          .where(
            and(
              eq(rateLimitEvents.bucket, bucket),
              eq(rateLimitEvents.key, key),
              gt(rateLimitEvents.createdAt, dayAgo),
            ),
          )
          .orderBy(rateLimitEvents.createdAt);

        const minuteHits = recent.filter(
          (r) => r.createdAt.getTime() > minuteCutoffMs,
        );

        if (minuteHits.length >= perMinute) {
          const oldest = minuteHits[0].createdAt.getTime();
          return {
            kind: "over",
            scope: "minute",
            retryAfter: Math.max(
              1,
              Math.ceil((oldest + MINUTE_MS - now) / 1000),
            ),
            minuteCount: minuteHits.length,
            dayCount: recent.length,
          };
        }

        if (recent.length >= perDay) {
          const oldest = recent[0].createdAt.getTime();
          return {
            kind: "over",
            scope: "day",
            retryAfter: Math.max(
              1,
              Math.ceil((oldest + DAY_MS - now) / 1000),
            ),
            minuteCount: minuteHits.length,
            dayCount: recent.length,
          };
        }

        await tx.insert(rateLimitEvents).values({ bucket, key });
        return {
          kind: "ok",
          minuteCount: minuteHits.length + 1,
          dayCount: recent.length + 1,
        };
      });
    } catch (err) {
      logger.error({ err, bucket, key }, "Rate limit transaction failed");
      // Fail closed: refuse the request rather than silently letting a
      // misbehaving DB defeat the limiter.
      res.status(503).json({
        error: "暫時無法驗證生成額度，請稍後再試一次。",
      });
      return;
    }

    if (decision.kind === "over") {
      res.setHeader("Retry-After", String(decision.retryAfter));
      res.setHeader(
        "X-RateLimit-Remaining-Minute",
        decision.scope === "minute"
          ? "0"
          : String(Math.max(0, perMinute - decision.minuteCount)),
      );
      res.setHeader(
        "X-RateLimit-Remaining-Day",
        decision.scope === "day"
          ? "0"
          : String(Math.max(0, perDay - decision.dayCount)),
      );
      logger.warn(
        {
          key,
          bucket,
          retryAfter: decision.retryAfter,
          scope: decision.scope,
          limit: decision.scope === "minute" ? perMinute : perDay,
        },
        "Rate limit exceeded",
      );
      if (decision.scope === "minute") {
        res.status(429).json({
          error: `為了讓大家都能玩到，每分鐘最多只能生成 ${perMinute} 張貼圖，請等 ${decision.retryAfter} 秒後再試一次。`,
          retryAfterSeconds: decision.retryAfter,
          scope: "minute",
          limit: perMinute,
        });
      } else {
        res.status(429).json({
          error: `今天的免費生成額度（每人每天 ${perDay} 張）已經用完囉，請明天再回來試試！`,
          retryAfterSeconds: decision.retryAfter,
          scope: "day",
          limit: perDay,
        });
      }
      return;
    }

    // Report remaining quota *after* counting this request so the value
    // reflects how many calls the client has left going forward.
    res.setHeader(
      "X-RateLimit-Remaining-Minute",
      String(Math.max(0, perMinute - decision.minuteCount)),
    );
    res.setHeader(
      "X-RateLimit-Remaining-Day",
      String(Math.max(0, perDay - decision.dayCount)),
    );

    next();
  };
}

export async function __resetRateLimitForTests(): Promise<void> {
  await db.delete(rateLimitEvents).where(sql`true`);
}
