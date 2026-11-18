import { z } from "zod";
import { MARKETS } from "@omnitide/contracts/markets";
import { db } from "@/lib/server/db";

const Q = z.object({
  feed: z.enum(MARKETS.map((m) => m.feed) as [string, ...string[]]),
  interval: z.coerce.number().pipe(z.union([z.literal(60), z.literal(900), z.literal(3600)])).default(60),
  limit: z.coerce.number().int().min(10).max(1000).default(300),
});

export async function GET(req: Request) {
  const q = Q.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return Response.json({ error: "bad query" }, { status: 400 });
  const rows = await db().candle.findMany({
    where: { feed: q.data.feed, interval: q.data.interval },
    orderBy: { start: "desc" },
    take: q.data.limit,
  });
  const candles = rows.reverse().map((c) => ({
    time: Math.floor(c.start.getTime() / 1000),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
  }));
  return Response.json({ candles }, { headers: { "cache-control": "public, max-age=5" } });
}
