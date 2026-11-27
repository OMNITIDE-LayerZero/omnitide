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
  omnitideLendingAbi,
} from "@omnitide/contracts/abi";

const d = DEPLOYMENTS[process.env.OMNITIDE_ENV === "mainnet" ? "mainnet" : "testnet"];
const hubKey = (Object.keys(CHAINS) as ChainKey[]).find((k) => CHAINS[k].hub && d[k]?.OmnitideClearinghouse);
if (!hubKey) throw new Error("hub contracts must be deployed");
const rh = d[hubKey]!;
// every contract maps chain → deployment; V2/V3 maps stay empty until that version ships (mainnet goes version by version)
type Name = "OmnitideHarbor" | "OmnitideTideReader" | "OmnitideDeepPool" | "OmnitideLighthouse" | "OmnitideBadge" | "OmnitideCouncil" | "OmnitideCopyVaultFactory" | "OmnitideClearinghouse" | "OmnitideLending";
const on = (name: Name) =>
  Object.fromEntries((Object.keys(CHAINS) as ChainKey[]).flatMap((k) => {
    const c = d[k]?.[name];
    return c ? [[k, { address: c.proxy as `0x${string}`, startBlock: c.block }]] : [];
  }));
const factoryRec = rh.OmnitideCopyVaultFactory;
// only chains with a deployed OmnitideUSD are indexed
const LIVE = (Object.keys(CHAINS) as ChainKey[]).flatMap((k) => (d[k]?.OmnitideUSD ? [[k, d[k].OmnitideUSD] as const] : []));
const rpc = (key: ChainKey) => process.env[`PONDER_RPC_${CHAINS[key].chainId}`]?.split(",") ?? CHAINS[key].rpc;
// HyperEVM public RPC caps eth_getLogs ranges and request rates, and prunes old blocks; HyperBFT is final per block,
// so reorgWindow 0 stops Ponder's startup finality search from probing pruned heights
const LIMITS: Partial<Record<ChainKey, { maxRequestsPerSecond?: number; ethGetLogsBlockRange?: number; pollingInterval?: number; reorgWindow?: number }>> = {
  robinhoodTestnet: { pollingInterval: 2_000 },
  hyperEvmTestnet: { maxRequestsPerSecond: 5, ethGetLogsBlockRange: 1_000, reorgWindow: 0 },
  robinhood: { pollingInterval: 2_000 },
  hyperEvm: { maxRequestsPerSecond: 5, ethGetLogsBlockRange: 1_000, reorgWindow: 0 },
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
    OmnitideClearinghouse: { abi: omnitideClearinghouseAbi, chain: on("OmnitideClearinghouse") },
    OmnitideHarbor: {
      abi: omnitideHarborAbi,
      chain: on("OmnitideHarbor"),
      filter: [{ event: "Deposit", args: {} }, { event: "Withdraw", args: {} }, { event: "Composed", args: {} }],
    },
    OmnitideLending: {
      abi: omnitideLendingAbi,
      chain: on("OmnitideLending"),
      filter: [
        { event: "Deposit", args: {} },
        { event: "Withdraw", args: {} },
        { event: "CollateralDeposited", args: {} },
        { event: "CollateralWithdrawn", args: {} },
        { event: "Borrowed", args: {} },
        { event: "Repaid", args: {} },
        { event: "Liquidated", args: {} },
        { event: "BadDebt", args: {} },
      ],
    },
    OmnitideTideReader: {
      abi: omnitideTideReaderAbi,
      chain: on("OmnitideTideReader"),
      filter: [{ event: "TideRequested", args: {} }, { event: "TideRead", args: {} }],
    },
    OmnitideDeepPool: {
      abi: omnitideDeepPoolAbi,
      chain: on("OmnitideDeepPool"),
      filter: [{ event: "DeepDeposit", args: {} }, { event: "Sealed", args: {} }, { event: "DeepWithdraw", args: {} }, { event: "ExitRequested", args: {} }, { event: "Exited", args: {} }],
    },
    OmnitideLighthouse: { abi: omnitideLighthouseAbi, chain: on("OmnitideLighthouse"), filter: [{ event: "BeamLit", args: {} }, { event: "BeamSent", args: {} }] },
    OmnitideBadge: { abi: omnitideBadgeAbi, chain: on("OmnitideBadge"), filter: [{ event: "Transfer", args: {} }, { event: "BadgeClaimed", args: {} }, { event: "BadgeReceived", args: {} }, { event: "BadgeSent", args: {} }] },
    OmnitideCouncil: {
      abi: omnitideCouncilAbi,
      chain: on("OmnitideCouncil"),
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
      chain: on("OmnitideCopyVaultFactory"),
      filter: [{ event: "VaultCreated", args: {} }],
    },
    OmnitideCopyVault: {
      abi: omnitideCopyVaultAbi,
      chain: factoryRec
        ? {
            [hubKey]: {
              address: factory({ address: factoryRec.proxy as `0x${string}`, event: getAbiItem({ abi: omnitideCopyVaultFactoryAbi, name: "VaultCreated" }), parameter: "vault" }),
              startBlock: factoryRec.block,
            },
          }
        : {},
      filter: [{ event: "Deposited", args: {} }, { event: "Queued", args: {} }, { event: "Redeemed", args: {} }, { event: "LeaderTrade", args: {} }, { event: "FeeCharged", args: {} }],
    },
  },
});
