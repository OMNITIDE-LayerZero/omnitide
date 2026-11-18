import { MARKETS } from "@omnitide/contracts/markets";
import { db } from "@/lib/server/db";

export async function GET() {
  const rows = await db().priceLatest.findMany();
  const byFeed = new Map(rows.map((r) => [r.feed, r]));
  const prices = MARKETS.flatMap((m) => {
    const r = byFeed.get(m.feed);
    if (!r) return [];
    return [{ feed: m.feed, price: Number(r.price), change24h: r.change24h === null ? null : Number(r.change24h), source: r.source, observed: r.observed.getTime() }];
  });
  return Response.json({ prices }, { headers: { "cache-control": "public, max-age=2" } });
}
