import { upstream } from "@/lib/server/upstream";

const PATHS = new Set(["stats", "trades", "positions", "orders", "flows", "bridge", "leaderboard", "harbor", "tide", "book", "trader", "deep", "sealed", "lighthouse", "badges", "council", "vaults"]);
// one id segment is allowed under these
const NESTED = new Set(["deep", "council", "vaults"]);
const PARAMS = new Set(["account", "limit", "owner", "voter", "by"]);

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const ok = PATHS.has(path[0] ?? "") && (path.length === 1 || (path.length === 2 && NESTED.has(path[0]!) && /^(0x[0-9a-fA-F]{40}|0x[0-9a-fA-F]{64}|\d{1,8})$/.test(path[1]!)));
  if (!ok) return Response.json({ error: "not found" }, { status: 404 });
  const src = new URL(req.url).searchParams;
  const qs = new URLSearchParams([...src].filter(([k]) => PARAMS.has(k)));
  try {
    const data = await upstream<unknown>("indexer", `/${path.join("/")}${qs.size ? `?${qs}` : ""}`);
    return Response.json(data, { headers: { "cache-control": "public, max-age=3" } });
  } catch {
    return Response.json({ error: "indexer unavailable" }, { status: 503 });
  }
}
