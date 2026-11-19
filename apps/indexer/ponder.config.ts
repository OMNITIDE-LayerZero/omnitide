import { createConfig } from "ponder";
import { CHAINS, type ChainKey } from "@omnitide/contracts/chains";
import { DEPLOYMENTS } from "@omnitide/contracts/deployments";
import { omnitideUSDAbi, omnitideClearinghouseAbi, omnitideHarborAbi, omnitideTideReaderAbi } from "@omnitide/contracts/abi";

const d = DEPLOYMENTS.testnet;
const hub = d.robinhoodTestnet?.OmnitideClearinghouse;
const harbor = d.robinhoodTestnet?.OmnitideHarbor;
const reader = d.arbitrumSepolia?.OmnitideTideReader;
if (!hub || !harbor || !reader) throw new Error("hub, Harbor and Tide reader contracts must be deployed");
// only chains with a deployed OmnitideUSD are indexed
const LIVE = (Object.keys(CHAINS) as ChainKey[]).flatMap((k) => (d[k]?.OmnitideUSD ? [[k, d[k].OmnitideUSD] as const] : []));
const rpc = (key: ChainKey) => process.env[`PONDER_RPC_${CHAINS[key].chainId}`]?.split(",") ?? CHAINS[key].rpc;
// HyperEVM public RPC caps eth_getLogs ranges and request rates
const LIMITS: Partial<Record<ChainKey, { maxRequestsPerSecond?: number; ethGetLogsBlockRange?: number; pollingInterval?: number }>> = {
  robinhoodTestnet: { pollingInterval: 2_000 },
  hyperEvmTestnet: { maxRequestsPerSecond: 5, ethGetLogsBlockRange: 1_000 },
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
    OmnitideHarbor: {
      abi: omnitideHarborAbi,
      chain: "robinhoodTestnet",
      address: harbor.proxy as `0x${string}`,
      startBlock: harbor.block,
      filter: [{ event: "Deposit", args: {} }, { event: "Withdraw", args: {} }, { event: "Composed", args: {} }],
    },
    OmnitideTideReader: {
      abi: omnitideTideReaderAbi,
      chain: "arbitrumSepolia",
      address: reader.proxy as `0x${string}`,
      startBlock: reader.block,
      filter: [{ event: "TideRequested", args: {} }, { event: "TideRead", args: {} }],
    },
  },
});
