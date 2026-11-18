import { upstreamRpc } from "@/lib/server/env";

const ALLOWED = new Set([
  "eth_chainId", "net_version", "eth_blockNumber", "eth_call", "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas",
  "eth_feeHistory", "eth_getBalance", "eth_getCode", "eth_getTransactionCount", "eth_getTransactionByHash",
  "eth_getTransactionReceipt", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getLogs", "eth_sendRawTransaction",
]);
const MAX_BODY = 64 * 1024;
const MAX_BATCH = 20;

type RpcReq = { id?: unknown; method?: unknown };

/** JSON-RPC relay for the five OMNITIDE chains: read methods plus signed-tx broadcast, nothing else. */
export async function POST(req: Request, ctx: { params: Promise<{ chainId: string }> }) {
  const { chainId } = await ctx.params;
  const target = upstreamRpc(Number(chainId));
  if (!target) return Response.json({ error: "unknown chain" }, { status: 404 });

  const raw = await req.text();
  if (raw.length > MAX_BODY) return Response.json({ error: "payload too large" }, { status: 413 });
  let body: RpcReq | RpcReq[];
  try {
    body = JSON.parse(raw) as RpcReq | RpcReq[];
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const calls = Array.isArray(body) ? body : [body];
  if (calls.length === 0 || calls.length > MAX_BATCH) return Response.json({ error: "bad batch size" }, { status: 400 });
  const denied = calls.find((c) => typeof c.method !== "string" || !ALLOWED.has(c.method));
  if (denied) return Response.json({ jsonrpc: "2.0", id: denied.id ?? null, error: { code: -32601, message: "method not available" } });

  const res = await fetch(target, { method: "POST", headers: { "content-type": "application/json" }, body: raw, signal: AbortSignal.timeout(15_000) });
  return new Response(res.body, { status: res.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
