// Single source of chain params for deploy scripts; values verified live in the pre-flight check.
export type ChainKey = "robinhoodTestnet" | "sepolia" | "monadTestnet" | "arcTestnet" | "fuji";

export interface ChainConfig {
  name: string;
  chainId: number;
  eid: number;
  endpoint: `0x${string}`;
  rpc: string;
  explorer: string;
  blockscout?: string;
  nativeSymbol: string;
  hub: boolean;
}

export const CHAINS: Record<ChainKey, ChainConfig> = {
  robinhoodTestnet: {
    name: "Robinhood Chain Testnet",
    chainId: 46630,
    eid: 40451,
    endpoint: "0x3acaaf60502791d199a5a5f0b173d78229ebfe32",
    rpc: process.env.RPC_ROBINHOOD_TESTNET ?? "https://rpc.testnet.chain.robinhood.com",
    explorer: "https://explorer.testnet.chain.robinhood.com",
    blockscout: "https://explorer.testnet.chain.robinhood.com/api",
    nativeSymbol: "ETH",
    hub: true,
  },
  sepolia: {
    name: "Ethereum Sepolia",
    chainId: 11155111,
    eid: 40161,
    endpoint: "0x6edce65403992e310a62460808c4b910d972f10f",
    rpc: process.env.RPC_SEPOLIA ?? "https://ethereum-sepolia-rpc.publicnode.com",
    explorer: "https://eth-sepolia.blockscout.com",
    blockscout: "https://eth-sepolia.blockscout.com/api",
    nativeSymbol: "ETH",
    hub: false,
  },
  monadTestnet: {
    name: "Monad Testnet",
    chainId: 10143,
    eid: 40204,
    endpoint: "0x6c7ab2202c98c4227c5c46f1417d81144da716ff",
    rpc: process.env.RPC_MONAD_TESTNET ?? "https://testnet-rpc.monad.xyz",
    explorer: "https://testnet.monadexplorer.com",
    nativeSymbol: "MON",
    hub: false,
  },
  arcTestnet: {
    name: "Arc Testnet",
    chainId: 5042002,
    eid: 40434,
    endpoint: "0x6c7ab2202c98c4227c5c46f1417d81144da716ff",
    rpc: process.env.RPC_ARC_TESTNET ?? "https://rpc.testnet.arc.io",
    explorer: "https://explorer.testnet.arc.io",
    blockscout: "https://explorer.testnet.arc.io/api",
    nativeSymbol: "USDC",
    hub: false,
  },
  fuji: {
    name: "Avalanche Fuji",
    chainId: 43113,
    eid: 40106,
    endpoint: "0x6edce65403992e310a62460808c4b910d972f10f",
    rpc: process.env.RPC_FUJI ?? "https://api.avax-test.network/ext/bc/C/rpc",
    explorer: "https://testnet.snowtrace.io",
    nativeSymbol: "AVAX",
    hub: false,
  },
};
