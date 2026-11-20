import { env } from "@/lib/server/env";

// Deep Water calls the keeper verifies itself (EIP-712 / signed messages); this route only forwards an allowlist.
const GET_PATHS = new Set(["deep/key", "deep/status", "arena"]);
const POST_PATHS = new Set(["deep/register", "deep/trade", "deep/withdraw", "lighthouse"]);

async function forward(req: Request, path: string, init: RequestInit) {
  const qs = new URL(req.url).search;
  try {
    // trades and withdrawals wait for their block before answering
    const res = await fetch(`${env().KEEPER_URL}/${path}${qs}`, { ...init, cache: "no-store", signal: AbortSignal.timeout(60_000) });
    return Response.json(await res.json(), { status: res.status, headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "the keeper is busy, try again shortly" }, { status: 503 });
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const path = (await ctx.params).path.join("/");
  if (!GET_PATHS.has(path)) return Response.json({ error: "not found" }, { status: 404 });
  return forward(req, path, {});
}

export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const path = (await ctx.params).path.join("/");
  if (!POST_PATHS.has(path)) return Response.json({ error: "not found" }, { status: 404 });
  const body = await req.text();
  if (body.length > 16_384) return Response.json({ error: "too large" }, { status: 413 });
  return forward(req, path, { method: "POST", headers: { "content-type": "application/json" }, body });
}
