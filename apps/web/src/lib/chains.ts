import { arbitrumSepolia, hyperliquidEvmTestnet, robinhoodTestnet, sepolia } from "viem/chains";
import type { Chain } from "viem";
import { CHAINS, type ChainKey } from "@omnitide/contracts/chains";
import { DEPLOYMENTS } from "@omnitide/contracts/deployments";

const VIEM: Record<ChainKey, Chain> = {
  robinhoodTestnet,
  arbitrumSepolia,
  hyperEvmTestnet: { ...hyperliquidEvmTestnet, blockExplorers: { default: { name: "Purrsec", url: CHAINS.hyperEvmTestnet.explorer } } },
  sepolia,
};

/** Browser RPC goes through our own proxy so every visitor reaches every chain, whatever their DNS. */
export function proxiedRpc(chainId: number) {
  const origin = typeof window === "undefined" ? (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:4391") : window.location.origin;
  return `${origin}/api/rpc/${chainId}`;
}

/** Chains with a live OmnitideUSD; a configured chain stays hidden until it is deployed. */
export const CHAIN_KEYS = (Object.keys(CHAINS) as ChainKey[]).filter((k) => DEPLOYMENTS.testnet[k]?.OmnitideUSD);

export const CHAIN_COUNT = CHAIN_KEYS.length;

export const CHAIN_LIST = CHAIN_KEYS.map((k) => {
  const c = VIEM[k];
  return { ...c, rpcUrls: { default: { http: [proxiedRpc(c.id)] } } } as Chain;
}) as [Chain, ...Chain[]];

export const HUB_KEY: ChainKey = "robinhoodTestnet";
export const HUB = CHAINS[HUB_KEY];

export const chainKeyOf = (chainId: number | undefined) => CHAIN_KEYS.find((k) => CHAINS[k].chainId === chainId);

/** Short display names; the hub is named for what it is. */
export const SHORT: Record<ChainKey, string> = {
  robinhoodTestnet: "Robinhood Chain",
  arbitrumSepolia: "Arbitrum Sepolia",
  hyperEvmTestnet: "HyperEVM",
  sepolia: "Ethereum Sepolia",
};

/** Network names for marketing copy, without the testnet suffix. */
export const NETWORK: Record<ChainKey, string> = {
  robinhoodTestnet: "Robinhood Chain",
  arbitrumSepolia: "Arbitrum",
  hyperEvmTestnet: "HyperEVM",
  sepolia: "Ethereum",
};

/** Live spokes as "A, B or C". */
export const SPOKE_LIST = new Intl.ListFormat("en-US", { type: "disjunction" }).format(CHAIN_KEYS.filter((k) => k !== HUB_KEY).map((k) => NETWORK[k]));

/**
 * LayerZero testnet lanes per direction: destinations with a live executor and DVN from each chain (checked 2026-11-20).
 * HyperEVM testnet's executor serves neither the hub nor Arbitrum, so HyperEVM leaves through Sepolia.
 */
const ALL_LANES: Record<ChainKey, ChainKey[]> = {
  robinhoodTestnet: ["arbitrumSepolia", "sepolia"],
  arbitrumSepolia: ["robinhoodTestnet", "sepolia", "hyperEvmTestnet"],
  sepolia: ["robinhoodTestnet", "arbitrumSepolia", "hyperEvmTestnet"],
  hyperEvmTestnet: ["sepolia"],
};
export const LANES = Object.fromEntries(CHAIN_KEYS.map((k) => [k, ALL_LANES[k].filter((o) => CHAIN_KEYS.includes(o))])) as Record<ChainKey, ChainKey[]>;

/** Hops from a spoke to the hub: direct when a lane exists, otherwise through Sepolia. */
export function inflowRoute(from: ChainKey): ChainKey[] {
  if (from === HUB_KEY) return [];
  return ALL_LANES[from].includes(HUB_KEY) ? [HUB_KEY] : ["sepolia", HUB_KEY];
}

export const explorerTx = (k: ChainKey, hash: string) => `${CHAINS[k].explorer}/tx/${hash}`;
export const explorerAddress = (k: ChainKey, addr: string) => `${CHAINS[k].explorer}/address/${addr}`;
