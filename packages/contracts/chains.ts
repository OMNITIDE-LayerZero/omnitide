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
  etherscanApi?: string;
  nativeSymbol: string;
  hub: boolean;
  // LayerZero ULN302 libraries, executor and LayerZero Labs DVN (metadata-api + on-chain defaults)
  lz: { sendLib: string; receiveLib: string; executor: string; dvn: string };
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
    lz: { sendLib: "0x45841dd1ca50265da7614fc43a361e526c0e6160", receiveLib: "0xd682ecf100f6f4284138aa925348633b0611ae21", executor: "0x701f3927871efcea1235db722f9e608ae120d243", dvn: "0xa78a78a13074ed93ad447a26ec57121f29e8fec2" },
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
    lz: { sendLib: "0xcc1ae8cf5d3904cef3360a9532b477529b177cce", receiveLib: "0xdaf00f5ee2158dd58e0d3857851c432e34a3a851", executor: "0x718b92b5cb0a5552039b593faf724d182a881eda", dvn: "0x8eebf8b423b73bfca51a1db4b7354aa0bfca9193" },
  },
  monadTestnet: {
    name: "Monad Testnet",
    chainId: 10143,
    eid: 40442, // LayerZero "monad2-testnet"; the 40204 endpoint on this chain is a non-functional stub
    endpoint: "0x3acaaf60502791d199a5a5f0b173d78229ebfe32",
    rpc: process.env.RPC_MONAD_TESTNET ?? "https://testnet-rpc.monad.xyz",
    explorer: "https://testnet.monadexplorer.com",
    nativeSymbol: "MON",
    hub: false,
    lz: { sendLib: "0x45841dd1ca50265da7614fc43a361e526c0e6160", receiveLib: "0xd682ecf100f6f4284138aa925348633b0611ae21", executor: "0x701f3927871efcea1235db722f9e608ae120d243", dvn: "0xa78a78a13074ed93ad447a26ec57121f29e8fec2" },
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
    lz: { sendLib: "0xd682ecf100f6f4284138aa925348633b0611ae21", receiveLib: "0xcf1b0f4106b0324f96fefcc31ba9498caa80701c", executor: "0x9db9ca3305b48f196d18082e91cb64663b13d014", dvn: "0x88b27057a9e00c5f05dda29241027aff63f9e6e0" },
  },
  fuji: {
    name: "Avalanche Fuji",
    chainId: 43113,
    eid: 40106,
    endpoint: "0x6edce65403992e310a62460808c4b910d972f10f",
    rpc: process.env.RPC_FUJI ?? "https://api.avax-test.network/ext/bc/C/rpc",
    explorer: "https://testnet.snowtrace.io",
    etherscanApi: "https://api.routescan.io/v2/network/testnet/evm/43113/etherscan/api",
    nativeSymbol: "AVAX",
    hub: false,
    lz: { sendLib: "0x69bf5f48d2072dfebc670a1d19dff91d0f4e8170", receiveLib: "0x819f0faf2cb1fba15b9cb24c9a2bdadb0f895daf", executor: "0xa7bfa9d51032f82d649a501b6a1f922fc2f7d4e3", dvn: "0x9f0e79aeb198750f963b6f30b99d87c6ee5a0467" },
  },
};
