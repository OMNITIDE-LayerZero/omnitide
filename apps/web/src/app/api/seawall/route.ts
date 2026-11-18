import { parseAbi, parseAbiParameters, decodeAbiParameters, type Address } from "viem";
import { CHAINS } from "@omnitide/contracts/chains";
import { CHAIN_KEYS, HUB_KEY, LANES } from "@/lib/chains";
import { CLEARINGHOUSE, omnitideClearinghouseAbi, omnitideUSDAbi, usdAddress } from "@/lib/contracts";
import { serverClient } from "@/lib/server/clients";

const ENDPOINT = parseAbi([
  "function getSendLibrary(address,uint32) view returns (address)",
  "function getConfig(address,address,uint32,uint32) view returns (bytes)",
]);
const ULN = parseAbiParameters("(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs)");
const TTL = 30_000;
let cache: { at: number; body: unknown } | undefined;

async function chainReport(key: (typeof CHAIN_KEYS)[number]) {
  const c = CHAINS[key];
  const client = serverClient(c.chainId);
  const token = usdAddress(key);
  const [supply, paused] = await Promise.all([
    client.readContract({ address: token, abi: omnitideUSDAbi, functionName: "totalSupply" }),
    client.readContract({ address: token, abi: omnitideUSDAbi, functionName: "paused" }),
  ]);
  const lanes = await Promise.all(
    LANES[key].map(async (dst) => {
      const eid = CHAINS[dst].eid;
      const [rate, available, lib] = await Promise.all([
        client.readContract({ address: token, abi: omnitideUSDAbi, functionName: "rateLimits", args: [eid] }),
        client.readContract({ address: token, abi: omnitideUSDAbi, functionName: "availableToSend", args: [eid] }),
        client.readContract({ address: c.endpoint as Address, abi: ENDPOINT, functionName: "getSendLibrary", args: [token, eid] }),
      ]);
      const raw = await client.readContract({ address: c.endpoint as Address, abi: ENDPOINT, functionName: "getConfig", args: [token, lib, eid, 2] });
      const [uln] = decodeAbiParameters(ULN, raw);
      return {
        to: dst,
        limit: rate[0].toString(),
        window: Number(rate[1]),
        available: available.toString(),
        confirmations: Number(uln.confirmations),
        dvns: uln.requiredDVNs.length + uln.optionalDVNs.length,
      };
    }),
  );
  return { chain: key, chainId: c.chainId, eid: c.eid, supply: supply.toString(), paused, lanes };
}

/** Live Sea Wall: supply per chain, lane limits and DVN config, and hub reserves vs liabilities. */
export async function GET() {
  if (cache && Date.now() - cache.at < TTL) return Response.json(cache.body);
  const hub = serverClient(CHAINS[HUB_KEY].chainId);
  const [chains, held, collateral, pool, cap, paused] = await Promise.all([
    Promise.allSettled(CHAIN_KEYS.map(chainReport)),
    hub.readContract({ address: usdAddress(HUB_KEY), abi: omnitideUSDAbi, functionName: "balanceOf", args: [CLEARINGHOUSE] }),
    hub.readContract({ address: CLEARINGHOUSE, abi: omnitideClearinghouseAbi, functionName: "totalCollateral" }),
    hub.readContract({ address: CLEARINGHOUSE, abi: omnitideClearinghouseAbi, functionName: "poolBalance" }),
    hub.readContract({ address: CLEARINGHOUSE, abi: omnitideClearinghouseAbi, functionName: "depositCap" }),
    hub.readContract({ address: CLEARINGHOUSE, abi: omnitideClearinghouseAbi, functionName: "paused" }),
  ]);
  const body = {
    at: Date.now(),
    reserves: { held: held.toString(), collateral: collateral.toString(), pool: pool.toString(), depositCap: cap.toString(), paused },
    chains: chains.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])),
  };
  cache = { at: Date.now(), body };
  return Response.json(body);
}
