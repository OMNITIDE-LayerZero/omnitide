import { createConfig, factory } from "ponder";
import { getAbiItem } from "viem";
import { CHAINS, type ChainKey } from "@omnitide/contracts/chains";
import { DEPLOYMENTS } from "@omnitide/contracts/deployments";
import {
  omnitideUSDAbi,
  omnitideClearinghouseAbi,
  omnitideHarborAbi,
  omnitideTideReaderAbi,
  omnitideDeepPoolAbi,
  omnitideLighthouseAbi,
  omnitideBadgeAbi,
  omnitideCouncilAbi,
  omnitideCopyVaultAbi,
  omnitideCopyVaultFactoryAbi,
} from "@omnitide/contracts/abi";

const d = DEPLOYMENTS.testnet;
const hub = d.robinhoodTestnet?.OmnitideClearinghouse;
const harbor = d.robinhoodTestnet?.OmnitideHarbor;
const reader = d.arbitrumSepolia?.OmnitideTideReader;
if (!hub || !harbor || !reader) throw new Error("hub, Harbor and Tide reader contracts must be deployed");
const rh = d.robinhoodTestnet!;
if (!rh.OmnitideDeepPool || !rh.OmnitideCopyVaultFactory) throw new Error("Deep Water contracts must be deployed on the hub");
// V3 OApps live on the hub and every chain with deepWater set
const v3 = (name: "OmnitideLighthouse" | "OmnitideBadge" | "OmnitideCouncil") =>
  Object.fromEntries((Object.keys(CHAINS) as ChainKey[]).flatMap((k) => {
    const c = d[k]?.[name];
    return c ? [[k, { address: c.proxy as `0x${string}`, startBlock: c.block }]] : [];
  }));
// only chains with a deployed OmnitideUSD are indexed
const LIVE = (Object.keys(CHAINS) as ChainKey[]).flatMap((k) => (d[k]?.OmnitideUSD ? [[k, d[k].OmnitideUSD] as const] : []));
const rpc = (key: ChainKey) => process.env[`PONDER_RPC_${CHAINS[key].chainId}`]?.split(",") ?? CHAINS[key].rpc;
// HyperEVM public RPC caps eth_getLogs ranges and request rates, and prunes old blocks; HyperBFT is final per block,
// so reorgWindow 0 stops Ponder's startup finality search from probing pruned heights
const LIMITS: Partial<Record<ChainKey, { maxRequestsPerSecond?: number; ethGetLogsBlockRange?: number; pollingInterval?: number; reorgWindow?: number }>> = {
  robinhoodTestnet: { pollingInterval: 2_000 },
  hyperEvmTestnet: { maxRequestsPerSecond: 5, ethGetLogsBlockRange: 1_000, reorgWindow: 0 },
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
    OmnitideDeepPool: {
      abi: omnitideDeepPoolAbi,
      chain: "robinhoodTestnet",
      address: rh.OmnitideDeepPool.proxy as `0x${string}`,
      startBlock: rh.OmnitideDeepPool.block,
      filter: [{ event: "DeepDeposit", args: {} }, { event: "Sealed", args: {} }, { event: "DeepWithdraw", args: {} }, { event: "ExitRequested", args: {} }, { event: "Exited", args: {} }],
    },
    OmnitideLighthouse: { abi: omnitideLighthouseAbi, chain: v3("OmnitideLighthouse"), filter: [{ event: "BeamLit", args: {} }, { event: "BeamSent", args: {} }] },
    OmnitideBadge: { abi: omnitideBadgeAbi, chain: v3("OmnitideBadge"), filter: [{ event: "Transfer", args: {} }, { event: "BadgeClaimed", args: {} }, { event: "BadgeReceived", args: {} }, { event: "BadgeSent", args: {} }] },
    OmnitideCouncil: {
      abi: omnitideCouncilAbi,
      chain: v3("OmnitideCouncil"),
      filter: [
        { event: "ProposalCreated", args: {} },
        { event: "ProposalMirrored", args: {} },
        { event: "VoteCast", args: {} },
        { event: "VoteTallied", args: {} },
        { event: "Staked", args: {} },
        { event: "Unstaked", args: {} },
      ],
    },
    OmnitideCopyVaultFactory: {
      abi: omnitideCopyVaultFactoryAbi,
      chain: "robinhoodTestnet",
      address: rh.OmnitideCopyVaultFactory.proxy as `0x${string}`,
      startBlock: rh.OmnitideCopyVaultFactory.block,
      filter: [{ event: "VaultCreated", args: {} }],
    },
    OmnitideCopyVault: {
      abi: omnitideCopyVaultAbi,
      chain: "robinhoodTestnet",
      address: factory({ address: rh.OmnitideCopyVaultFactory.proxy as `0x${string}`, event: getAbiItem({ abi: omnitideCopyVaultFactoryAbi, name: "VaultCreated" }), parameter: "vault" }),
      startBlock: rh.OmnitideCopyVaultFactory.block,
      filter: [{ event: "Deposited", args: {} }, { event: "Queued", args: {} }, { event: "Redeemed", args: {} }, { event: "LeaderTrade", args: {} }],
    },
  },
});
