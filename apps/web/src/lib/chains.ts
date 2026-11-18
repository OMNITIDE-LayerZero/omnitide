import { arcTestnet, avalancheFuji, monadTestnet, robinhoodTestnet, sepolia } from "viem/chains";
import type { Chain } from "viem";
import { CHAINS, type ChainKey } from "@omnitide/contracts/chains";

const VIEM: Record<ChainKey, Chain> = { robinhoodTestnet, sepolia, monadTestnet, arcTestnet, fuji: avalancheFuji };

/** Browser RPC goes through our own proxy so every visitor reaches every chain, whatever their DNS. */
export function proxiedRpc(chainId: number) {
  const origin = typeof window === "undefined" ? (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:4391") : window.location.origin;
  return `${origin}/api/rpc/${chainId}`;
}

export const CHAIN_KEYS = Object.keys(CHAINS) as ChainKey[];

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
  sepolia: "Ethereum Sepolia",
  monadTestnet: "Monad",
  arcTestnet: "Arc",
  fuji: "Avalanche Fuji",
};

/**
 * LayerZero testnet lanes that exist today (ULN isSupportedEid, re-checked live on the Sea Wall page).
 * Monad and Arc reach the hub through Sepolia.
 */
export const LANES: Record<ChainKey, ChainKey[]> = {
  robinhoodTestnet: ["sepolia", "fuji"],
  sepolia: ["robinhoodTestnet", "monadTestnet", "arcTestnet", "fuji"],
  monadTestnet: ["sepolia", "arcTestnet", "fuji"],
  arcTestnet: ["sepolia", "monadTestnet", "fuji"],
  fuji: ["robinhoodTestnet", "sepolia"],
};

/** Hops from a spoke to the hub: direct when a lane exists, otherwise through Sepolia. */
export function inflowRoute(from: ChainKey): ChainKey[] {
  if (from === HUB_KEY) return [];
  return LANES[from].includes(HUB_KEY) ? [HUB_KEY] : ["sepolia", HUB_KEY];
}

export const explorerTx = (k: ChainKey, hash: string) => `${CHAINS[k].explorer}/tx/${hash}`;
export const explorerAddress = (k: ChainKey, addr: string) => `${CHAINS[k].explorer}/address/${addr}`;
