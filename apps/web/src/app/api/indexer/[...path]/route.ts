import { upstream } from "@/lib/server/upstream";

const PATHS = new Set(["stats", "trades", "positions", "orders", "flows", "bridge", "leaderboard"]);
const PARAMS = new Set(["account", "limit"]);

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (path.length !== 1 || !PATHS.has(path[0]!)) return Response.json({ error: "not found" }, { status: 404 });
  const src = new URL(req.url).searchParams;
  const qs = new URLSearchParams([...src].filter(([k]) => PARAMS.has(k)));
  try {
    const data = await upstream<unknown>("indexer", `/${path[0]}${qs.size ? `?${qs}` : ""}`);
    return Response.json(data, { headers: { "cache-control": "public, max-age=3" } });
  } catch {
    return Response.json({ error: "indexer unavailable" }, { status: 503 });
  }
}
