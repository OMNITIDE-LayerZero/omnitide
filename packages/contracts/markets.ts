// Market listing shared by the deploy script, keeper and web app; `id` is the on-chain market id.
export type MarketKind = "crypto" | "stock";

export interface MarketConfig {
  id: number;
  feed: string;
  symbol: string;
  name: string;
  kind: MarketKind;
  initialMarginBps: number;
  maintenanceMarginBps: number;
  maxOpenInterestUsd: number;
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
];
