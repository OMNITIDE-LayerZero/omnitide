import type { PrismaClient } from "@omnitide/db";
import type { Quote } from "./prices.js";

export const INTERVALS = [60, 900, 3600] as const;

export function bucketStart(ms: number, intervalSec: number): Date {
  const size = intervalSec * 1000;
  return new Date(Math.floor(ms / size) * size);
}

/** Folds one quote into every candle interval and the latest-price row, atomically per row. */
export async function recordQuote(db: PrismaClient, q: Quote) {
  for (const interval of INTERVALS) {
    const start = bucketStart(q.observed, interval);
    await db.$executeRaw`
      INSERT INTO "Candle" ("feed","interval","start","open","high","low","close","ticks")
      VALUES (${q.feed}, ${interval}, ${start}, ${q.price}::numeric, ${q.price}::numeric, ${q.price}::numeric, ${q.price}::numeric, 1)
      ON CONFLICT ("feed","interval","start") DO UPDATE SET
        "high" = GREATEST("Candle"."high", EXCLUDED."high"),
        "low" = LEAST("Candle"."low", EXCLUDED."low"),
        "close" = EXCLUDED."close",
        "ticks" = "Candle"."ticks" + 1`;
  }
  await db.priceLatest.upsert({
    where: { feed: q.feed },
    create: { feed: q.feed, price: q.price, source: q.source, observed: new Date(q.observed), change24h: q.change24h },
    update: { price: q.price, source: q.source, observed: new Date(q.observed), change24h: q.change24h },
  });
}
