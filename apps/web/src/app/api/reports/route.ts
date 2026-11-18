import { MARKETS } from "@omnitide/contracts/markets";
import { upstream } from "@/lib/server/upstream";

const FEEDS = new Set(MARKETS.map((m) => m.feed));

/** Fresh keeper-signed EIP-712 price reports, attached to trade/withdraw calls by the browser. */
export async function GET(req: Request) {
  const feeds = (new URL(req.url).searchParams.get("feeds") ?? "").split(",").filter((f) => FEEDS.has(f));
  if (feeds.length === 0) return Response.json({ error: "unknown feeds" }, { status: 400 });
  try {
    return Response.json(await upstream("keeper", `/reports?feeds=${feeds.join(",")}`), { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "price service unavailable" }, { status: 503 });
  }
}
