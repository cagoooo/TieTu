import { index, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const rateLimitEvents = pgTable(
  "rate_limit_events",
  {
    id: serial("id").primaryKey(),
    bucket: text("bucket").notNull(),
    key: text("key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("rate_limit_events_bucket_key_created_at_idx").on(
      table.bucket,
      table.key,
      table.createdAt,
    ),
    index("rate_limit_events_created_at_idx").on(table.createdAt),
  ],
);

export const insertRateLimitEventSchema = createInsertSchema(
  rateLimitEvents,
).omit({
  id: true,
  createdAt: true,
});

export type RateLimitEvent = typeof rateLimitEvents.$inferSelect;
export type InsertRateLimitEvent = z.infer<typeof insertRateLimitEventSchema>;
