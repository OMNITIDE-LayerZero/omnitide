/** NEAR Intents 1Click origins the Inlet takes. `chainId` marks the ones the connected wallet can send from in one click. */
export interface Origin {
  id: string;
  chain: string;
  symbol: string;
  assetId: string;
  decimals: number;
  chainId?: number;
  token?: `0x${string}`; // ERC-20 on an EVM origin; absent = native coin
  refundHint: string;
}

export const ORIGINS: readonly Origin[] = [
  { id: "arb-eth", chain: "Arbitrum", symbol: "ETH", assetId: "nep141:arb.omft.near", decimals: 18, chainId: 42161, refundHint: "0x…" },
  { id: "arb-usdc", chain: "Arbitrum", symbol: "USDC", assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", decimals: 6, chainId: 42161, token: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", refundHint: "0x…" },
  { id: "base-eth", chain: "Base", symbol: "ETH", assetId: "nep141:base.omft.near", decimals: 18, refundHint: "0x…" },
  { id: "base-usdc", chain: "Base", symbol: "USDC", assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", decimals: 6, refundHint: "0x…" },
  { id: "eth-eth", chain: "Ethereum", symbol: "ETH", assetId: "nep141:eth.omft.near", decimals: 18, refundHint: "0x…" },
  { id: "eth-usdc", chain: "Ethereum", symbol: "USDC", assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", decimals: 6, refundHint: "0x…" },
  { id: "sol-sol", chain: "Solana", symbol: "SOL", assetId: "nep141:sol.omft.near", decimals: 9, refundHint: "Solana address" },
  { id: "sol-usdc", chain: "Solana", symbol: "USDC", assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", decimals: 6, refundHint: "Solana address" },
  { id: "btc-btc", chain: "Bitcoin", symbol: "BTC", assetId: "nep141:btc.omft.near", decimals: 8, refundHint: "bc1…" },
];

/** What lands on Robinhood Chain: USDG for margin or a loan, native ETH for Lending collateral. */
export const DESTINATIONS = {
  usd: "nep141:hood-0x5fc5360d0400a0fd4f2af552add042d716f1d168.omft.near",
  eth: "nep141:hood.omft.near",
} as const;
export type Destination = keyof typeof DESTINATIONS;

/** Inlet routes, as OmnitideInlet.Route. ETH always lands as collateral, whichever box it reaches. */
export const ROUTE = { margin: 0, repay: 1 } as const;

/** 1Click status, folded into the four steps the tracker draws. */
export type Stage = "waiting" | "swapping" | "landed" | "refunded" | "failed";
export function stageOf(status: string | undefined): Stage {
  switch (status) {
    case "KNOWN_DEPOSIT_TX":
    case "PROCESSING":
      return "swapping";
    case "SUCCESS":
      return "landed";
    case "REFUNDED":
      return "refunded";
    case "FAILED":
      return "failed";
    default:
      return "waiting"; // PENDING_DEPOSIT, INCOMPLETE_DEPOSIT
  }
}
