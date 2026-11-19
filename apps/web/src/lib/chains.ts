import { arbitrumSepolia, hyperliquidEvmTestnet, robinhoodTestnet } from "viem/chains";
import type { Chain } from "viem";
import { CHAINS, type ChainKey } from "@omnitide/contracts/chains";
import { DEPLOYMENTS } from "@omnitide/contracts/deployments";

const VIEM: Record<ChainKey, Chain> = {
  robinhoodTestnet,
  arbitrumSepolia,
  hyperEvmTestnet: { ...hyperliquidEvmTestnet, blockExplorers: { default: { name: "Purrsec", url: CHAINS.hyperEvmTestnet.explorer } } },
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
};

/** Network names for marketing copy, without the testnet suffix. */
export const NETWORK: Record<ChainKey, string> = {
  robinhoodTestnet: "Robinhood Chain",
  arbitrumSepolia: "Arbitrum",
  hyperEvmTestnet: "HyperEVM",
};

/** Live spokes as "A, B or C". */
export const SPOKE_LIST = new Intl.ListFormat("en-US", { type: "disjunction" }).format(CHAIN_KEYS.filter((k) => k !== HUB_KEY).map((k) => NETWORK[k]));

/** LayerZero testnet lanes (ULN isSupportedEid on both ends, checked 2026-11-20; re-checked live on the Sea Wall page). */
const ALL_LANES: Record<ChainKey, ChainKey[]> = {
  robinhoodTestnet: ["arbitrumSepolia"],
  arbitrumSepolia: ["robinhoodTestnet", "hyperEvmTestnet"],
  // HyperEVM testnet has no Robinhood lane yet (mainnet does); it reaches the hub through Arbitrum Sepolia
  hyperEvmTestnet: ["arbitrumSepolia"],
};
export const LANES = Object.fromEntries(CHAIN_KEYS.map((k) => [k, ALL_LANES[k].filter((o) => CHAIN_KEYS.includes(o))])) as Record<ChainKey, ChainKey[]>;

/** Hops from a spoke to the hub: direct when a lane exists, otherwise through Arbitrum Sepolia. */
export function inflowRoute(from: ChainKey): ChainKey[] {
  if (from === HUB_KEY) return [];
  return ALL_LANES[from].includes(HUB_KEY) ? [HUB_KEY] : ["arbitrumSepolia", HUB_KEY];
}

export const explorerTx = (k: ChainKey, hash: string) => `${CHAINS[k].explorer}/tx/${hash}`;
export const explorerAddress = (k: ChainKey, addr: string) => `${CHAINS[k].explorer}/address/${addr}`;
