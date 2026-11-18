import { db } from "@/lib/server/db";
import { serverClient } from "@/lib/server/clients";
import { upstream } from "@/lib/server/upstream";
import { HUB } from "@/lib/chains";

async function check<T>(fn: () => Promise<T>) {
  const t = Date.now();
  try {
    const value = await fn();
    return { ok: true as const, ms: Date.now() - t, value };
  } catch (e) {
    return { ok: false as const, ms: Date.now() - t, error: (e as Error).message.split("\n")[0] };
  }
}

/** Liveness for the VPS and uptime checks: DB and hub RPC must be up; keeper/indexer are reported. */
export async function GET() {
  const [database, rpc, keeper, indexer] = await Promise.all([
    check(async () => (await db().$queryRaw<{ ok: number }[]>`SELECT 1 AS ok`)[0]?.ok === 1),
    check(async () => (await serverClient(HUB.chainId).getBlockNumber()).toString()),
    check(() => upstream<{ liveFeeds: number }>("keeper", "/health")),
    check(async () => (await upstream<{ global: unknown }>("indexer", "/stats")).global !== undefined),
  ]);
  const ok = database.ok && rpc.ok;
  return Response.json({ ok, database, rpc, keeper, indexer, at: new Date().toISOString() }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
