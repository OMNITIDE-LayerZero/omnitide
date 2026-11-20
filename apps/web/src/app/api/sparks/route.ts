import { MARKETS } from "@omnitide/contracts/markets";
import { db } from "@/lib/server/db";

/** Last 24 hourly closes for every market in one request, for the landing sparklines. */
export async function GET() {
  const rows = await Promise.all(
    MARKETS.map((m) => db().candle.findMany({ where: { feed: m.feed, interval: 3600 }, orderBy: { start: "desc" }, take: 24, select: { close: true } })),
  );
  const sparks = Object.fromEntries(MARKETS.map((m, i) => [m.feed, rows[i]!.reverse().map((r) => Number(r.close))]));
  return Response.json({ sparks }, { headers: { "cache-control": "public, max-age=60" } });
}
