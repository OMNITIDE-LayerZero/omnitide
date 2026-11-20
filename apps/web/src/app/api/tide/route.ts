import { CHAINS } from "@omnitide/contracts/chains";
import { MARKETS } from "@omnitide/contracts/markets";
import { CHAIN_KEYS, HUB_KEY } from "@/lib/chains";
import { CLEARINGHOUSE, FEATURES, HARBOR, SHARE_CHAINS, omnitideClearinghouseAbi, omnitideHarborAbi, omnitideUSDAbi, shareAddress, usdAddress } from "@/lib/contracts";
import { serverClient } from "@/lib/server/clients";

const TTL = 15_000;
const settled = (keys: string[], rs: PromiseSettledResult<bigint>[]) =>
  Object.fromEntries(keys.flatMap((k, i) => { const r = rs[i]; return r?.status === "fulfilled" ? [[k, r.value.toString()]] : []; }));
let cache: { at: number; body: unknown } | undefined;

/** Tide Chart, live half: open interest per market, Harbor and the pool on the hub, supply on every chain. */
export async function GET() {
  if (!FEATURES.harbor) return Response.json({ error: "Harbor opens with V2 Current" }, { status: 404 });
  if (cache && Date.now() - cache.at < TTL) return Response.json(cache.body);
  const hub = serverClient(CHAINS[HUB_KEY].chainId);
  const [markets, assets, shares, pool, supplies, spokeShares] = await Promise.all([
    Promise.all(MARKETS.map((m) => hub.readContract({ address: CLEARINGHOUSE, abi: omnitideClearinghouseAbi, functionName: "markets", args: [m.id] }))),
    hub.readContract({ address: HARBOR, abi: omnitideHarborAbi, functionName: "totalAssets" }),
    hub.readContract({ address: HARBOR, abi: omnitideHarborAbi, functionName: "totalSupply" }),
    hub.readContract({ address: CLEARINGHOUSE, abi: omnitideClearinghouseAbi, functionName: "poolBalance" }),
    Promise.allSettled(CHAIN_KEYS.map((k) => serverClient(CHAINS[k].chainId).readContract({ address: usdAddress(k), abi: omnitideUSDAbi, functionName: "totalSupply" }))),
    Promise.allSettled(SHARE_CHAINS.map((k) => serverClient(CHAINS[k].chainId).readContract({ address: shareAddress(k), abi: omnitideUSDAbi, functionName: "totalSupply" }))),
  ]);
  const body = {
    at: Date.now(),
    markets: markets.map((m, i) => ({ id: MARKETS[i]!.id, long: m[5].toString(), short: m[6].toString(), maxOpenInterestUsd: m[4].toString() })),
    harbor: { assets: assets.toString(), supply: shares.toString(), pool: pool.toString() },
    supply: settled(CHAIN_KEYS, supplies),
    shares: settled(SHARE_CHAINS, spokeShares),
  };
  cache = { at: Date.now(), body };
  return Response.json(body);
}
