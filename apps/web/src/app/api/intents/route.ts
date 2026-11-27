import { isAddress, parseUnits, type Address } from "viem";
import { z } from "zod";
import { HUB } from "@/lib/chains";
import { INLET, FEATURES, omnitideInletAbi } from "@/lib/contracts";
import { DESTINATIONS, ORIGINS } from "@/lib/intents";
import { env } from "@/lib/server/env";
import { serverClient } from "@/lib/server/clients";

const ONE_CLICK = "https://1click.chaindefuser.com/v0";

async function oneClick(path: string, init?: RequestInit) {
  const res = await fetch(`${ONE_CLICK}${path}`, { ...init, headers: { "content-type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

const QuoteIn = z.object({
  kind: z.literal("quote"),
  dry: z.boolean(),
  origin: z.string(),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  account: z.string().refine((a) => isAddress(a)).optional(),
  route: z.union([z.literal(0), z.literal(1)]),
  to: z.enum(["usd", "eth"]),
  refundTo: z.string().min(20).max(100).optional(),
});
const SubmitIn = z.object({ kind: z.literal("submit"), txHash: z.string().min(10).max(120), depositAddress: z.string().min(20).max(100) });

const off = () => Response.json({ error: "not available here" }, { status: 404 });

/** Live 1Click status for one deposit address. */
export async function GET(req: Request) {
  if (!FEATURES.inlet) return off();
  const depositAddress = new URL(req.url).searchParams.get("status") ?? "";
  if (depositAddress.length < 20 || depositAddress.length > 100) return Response.json({ error: "status=<deposit address> required" }, { status: 400 });
  const r = await oneClick(`/status?depositAddress=${encodeURIComponent(depositAddress)}`).catch(() => null);
  if (!r) return Response.json({ error: "NEAR Intents is slow to answer, retrying" }, { status: 503 });
  return Response.json(r.body, { status: r.ok ? 200 : r.status, headers: { "cache-control": "no-store" } });
}

/** Quotes (dry for the preview, firm for a deposit address) and deposit-tx hints, proxied to 1Click with the recipient pinned to the account's inlet. */
export async function POST(req: Request) {
  if (!FEATURES.inlet) return off();
  const raw = await req.json().catch(() => null);
  const submit = SubmitIn.safeParse(raw);
  if (submit.success) {
    const { txHash, depositAddress } = submit.data;
    const r = await oneClick("/deposit/submit", { method: "POST", body: JSON.stringify({ txHash, depositAddress }) }).catch(() => null);
    return Response.json(r?.body ?? {}, { status: r?.ok ? 200 : 202 });
  }
  const q = QuoteIn.safeParse(raw);
  if (!q.success) return Response.json({ error: "invalid request" }, { status: 400 });
  const { dry, amount, account, to, refundTo } = q.data;
  const route = to === "eth" ? 0 : q.data.route; // ETH is collateral from any box; keep it on one
  const origin = ORIGINS.find((o) => o.id === q.data.origin);
  if (!origin) return Response.json({ error: "unknown origin" }, { status: 400 });
  if (!dry && (!account || !refundTo)) return Response.json({ error: "account and refund address required" }, { status: 400 });
  // the recipient is always the account's own inlet; a preview without a wallet quotes to the Inlet itself
  const recipient = account
    ? await serverClient(HUB.chainId).readContract({ address: INLET, abi: omnitideInletAbi, functionName: "inletOf", args: [account as Address, route] })
    : INLET;
  const r = await oneClick("/quote", {
    method: "POST",
    body: JSON.stringify({
      dry,
      swapType: "EXACT_INPUT",
      slippageTolerance: 100,
      originAsset: origin.assetId,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: DESTINATIONS[to],
      amount: parseUnits(amount, origin.decimals).toString(),
      refundTo: refundTo ?? recipient,
      refundType: "ORIGIN_CHAIN",
      recipient,
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + 3_600_000).toISOString(),
    }),
  }).catch(() => null);
  if (!r) return Response.json({ error: "NEAR Intents is slow to answer, try again" }, { status: 503 });
  if (!r.ok) return Response.json({ error: String(r.body?.message ?? "no route for that amount") }, { status: 400 });
  if (!dry && account) {
    // the keeper sweeps the box the moment the delivery lands; the panel's Sweep button covers a missed watch
    await fetch(`${env().KEEPER_URL}/inlet/watch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account, route }), signal: AbortSignal.timeout(5_000) }).catch(() => {});
  }
  const quote = r.body.quote ?? {};
  return Response.json({ recipient, ...quote, deadline: quote.deadline ?? r.body.quoteRequest?.deadline });
}
