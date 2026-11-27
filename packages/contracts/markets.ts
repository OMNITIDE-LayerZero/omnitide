// Market listing shared by the deploy script, keeper and web app; `id` is the on-chain market id.
export type MarketKind = "crypto" | "stock";
/** Where a market sits on the board: China ADRs trade like any US listing but get their own shelf. */
export type MarketGroup = "crypto" | "us" | "china";

export interface MarketConfig {
  id: number;
  feed: string;
  symbol: string;
  name: string;
  kind: MarketKind;
  initialMarginBps: number;
  maintenanceMarginBps: number;
  maxOpenInterestUsd: number;
  region?: "china";
}

export const MARKETS: MarketConfig[] = [
  { id: 0, feed: "BTC-USD", symbol: "BTC", name: "Bitcoin", kind: "crypto", initialMarginBps: 1000, maintenanceMarginBps: 500, maxOpenInterestUsd: 250_000 },
  { id: 1, feed: "ETH-USD", symbol: "ETH", name: "Ether", kind: "crypto", initialMarginBps: 1000, maintenanceMarginBps: 500, maxOpenInterestUsd: 250_000 },
  { id: 2, feed: "SOL-USD", symbol: "SOL", name: "Solana", kind: "crypto", initialMarginBps: 1500, maintenanceMarginBps: 750, maxOpenInterestUsd: 100_000 },
  { id: 3, feed: "AVAX-USD", symbol: "AVAX", name: "Avalanche", kind: "crypto", initialMarginBps: 2000, maintenanceMarginBps: 1000, maxOpenInterestUsd: 50_000 },
  { id: 4, feed: "LINK-USD", symbol: "LINK", name: "Chainlink", kind: "crypto", initialMarginBps: 2000, maintenanceMarginBps: 1000, maxOpenInterestUsd: 50_000 },
  { id: 5, feed: "DOGE-USD", symbol: "DOGE", name: "Dogecoin", kind: "crypto", initialMarginBps: 2000, maintenanceMarginBps: 1000, maxOpenInterestUsd: 50_000 },
  { id: 6, feed: "TSLA", symbol: "TSLA", name: "Tesla", kind: "stock", initialMarginBps: 2000, maintenanceMarginBps: 1000, maxOpenInterestUsd: 100_000 },
  { id: 7, feed: "NVDA", symbol: "NVDA", name: "NVIDIA", kind: "stock", initialMarginBps: 2000, maintenanceMarginBps: 1000, maxOpenInterestUsd: 100_000 },
  { id: 8, feed: "AAPL", symbol: "AAPL", name: "Apple", kind: "stock", initialMarginBps: 2000, maintenanceMarginBps: 1000, maxOpenInterestUsd: 100_000 },
  { id: 9, feed: "COIN", symbol: "COIN", name: "Coinbase", kind: "stock", initialMarginBps: 2500, maintenanceMarginBps: 1250, maxOpenInterestUsd: 50_000 },
  { id: 10, feed: "HOOD", symbol: "HOOD", name: "Robinhood", kind: "stock", initialMarginBps: 2500, maintenanceMarginBps: 1250, maxOpenInterestUsd: 50_000 },
  { id: 11, feed: "SPY", symbol: "SPY", name: "S&P 500 ETF", kind: "stock", initialMarginBps: 1000, maintenanceMarginBps: 500, maxOpenInterestUsd: 250_000 },
  { id: 12, feed: "BABA", symbol: "BABA", name: "Alibaba", kind: "stock", region: "china", initialMarginBps: 2500, maintenanceMarginBps: 1250, maxOpenInterestUsd: 50_000 },
  { id: 13, feed: "PDD", symbol: "PDD", name: "PDD Holdings", kind: "stock", region: "china", initialMarginBps: 2500, maintenanceMarginBps: 1250, maxOpenInterestUsd: 50_000 },
  { id: 14, feed: "JD", symbol: "JD", name: "JD.com", kind: "stock", region: "china", initialMarginBps: 2500, maintenanceMarginBps: 1250, maxOpenInterestUsd: 50_000 },
  { id: 15, feed: "BIDU", symbol: "BIDU", name: "Baidu", kind: "stock", region: "china", initialMarginBps: 2500, maintenanceMarginBps: 1250, maxOpenInterestUsd: 50_000 },
  { id: 16, feed: "NIO", symbol: "NIO", name: "NIO", kind: "stock", region: "china", initialMarginBps: 3000, maintenanceMarginBps: 1500, maxOpenInterestUsd: 25_000 },
  { id: 17, feed: "FXI", symbol: "FXI", name: "China Large-Cap ETF", kind: "stock", region: "china", initialMarginBps: 2000, maintenanceMarginBps: 1000, maxOpenInterestUsd: 100_000 },
  { id: 18, feed: "AMZN", symbol: "AMZN", name: "Amazon", kind: "stock", initialMarginBps: 2000, maintenanceMarginBps: 1000, maxOpenInterestUsd: 100_000 },
  { id: 19, feed: "MSFT", symbol: "MSFT", name: "Microsoft", kind: "stock", initialMarginBps: 2000, maintenanceMarginBps: 1000, maxOpenInterestUsd: 100_000 },
  { id: 20, feed: "GOOGL", symbol: "GOOGL", name: "Alphabet", kind: "stock", initialMarginBps: 2000, maintenanceMarginBps: 1000, maxOpenInterestUsd: 100_000 },
  { id: 21, feed: "META", symbol: "META", name: "Meta", kind: "stock", initialMarginBps: 2000, maintenanceMarginBps: 1000, maxOpenInterestUsd: 100_000 },
  { id: 22, feed: "AMD", symbol: "AMD", name: "AMD", kind: "stock", initialMarginBps: 2500, maintenanceMarginBps: 1250, maxOpenInterestUsd: 50_000 },
];

export const groupOf = (m: MarketConfig): MarketGroup => (m.kind === "crypto" ? "crypto" : (m.region ?? "us"));

export const GROUPS: { id: MarketGroup; label: string; tag: string }[] = [
  { id: "crypto", label: "Crypto", tag: "crypto" },
  { id: "us", label: "US stocks", tag: "US stock" },
  { id: "china", label: "China", tag: "China ADR" },
];
