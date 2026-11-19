import { createConfig } from "ponder";
import { CHAINS, type ChainKey } from "@omnitide/contracts/chains";
import { DEPLOYMENTS } from "@omnitide/contracts/deployments";
import { omnitideUSDAbi, omnitideClearinghouseAbi } from "@omnitide/contracts/abi";

const d = DEPLOYMENTS.testnet;
const hub = d.robinhoodTestnet?.OmnitideClearinghouse;
if (!hub) throw new Error("hub contracts are not deployed");
// only chains with a deployed OmnitideUSD are indexed
const LIVE = (Object.keys(CHAINS) as ChainKey[]).flatMap((k) => (d[k]?.OmnitideUSD ? [[k, d[k].OmnitideUSD] as const] : []));
const rpc = (key: ChainKey) => process.env[`PONDER_RPC_${CHAINS[key].chainId}`]?.split(",") ?? CHAINS[key].rpc;
// public RPCs of the busier testnets cap eth_getLogs ranges and request rates
const LIMITS: Partial<Record<ChainKey, { maxRequestsPerSecond?: number; ethGetLogsBlockRange?: number; pollingInterval?: number }>> = {
  robinhoodTestnet: { pollingInterval: 2_000 },
  hyperEvmTestnet: { maxRequestsPerSecond: 5, ethGetLogsBlockRange: 1_000 },
  domaTestnet: { maxRequestsPerSecond: 5 },
};

export default createConfig({
  ordering: "multichain",
  database: { kind: "postgres", connectionString: process.env.DATABASE_URL },
  chains: Object.fromEntries(LIVE.map(([k]) => [k, { id: CHAINS[k].chainId, rpc: rpc(k), maxRequestsPerSecond: 8, ...LIMITS[k] }])),
  contracts: {
    OmnitideUSD: {
      abi: omnitideUSDAbi,
      chain: Object.fromEntries(LIVE.map(([k, usd]) => [k, { address: usd.proxy as `0x${string}`, startBlock: usd.block }])),
      filter: [{ event: "OFTSent", args: {} }, { event: "OFTReceived", args: {} }, { event: "Dripped", args: {} }],
    },
    OmnitideClearinghouse: {
      abi: omnitideClearinghouseAbi,
      chain: "robinhoodTestnet",
      address: hub.proxy as `0x${string}`,
      startBlock: hub.block,
    },
  },
});
