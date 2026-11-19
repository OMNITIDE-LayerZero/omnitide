import { env } from "@/lib/server/env";
import { upstream } from "@/lib/server/upstream";

// The keeper owns alert writes and verifies the wallet signature; this route only forwards.
export async function GET(req: Request) {
  const account = new URL(req.url).searchParams.get("account") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(account)) return Response.json({ error: "account required" }, { status: 400 });
  try {
    return Response.json(await upstream<unknown>("keeper", `/alerts?account=${account}`), { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "alerts unavailable" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const body = await req.text();
  if (body.length > 8_192) return Response.json({ error: "too large" }, { status: 413 });
  try {
    const res = await fetch(`${env().KEEPER_URL}/alerts`, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(8_000) });
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json({ error: "alerts unavailable" }, { status: 503 });
  }
}
