// Single source of chain params for deploy scripts; values verified live in the pre-flight check.
export type ChainKey = "robinhoodTestnet" | "arbitrumSepolia" | "hyperEvmTestnet" | "sepolia";

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
  hyperEvmTestnet: {
    name: "HyperEVM Testnet",
    chainId: 998,
    eid: 40362,
    endpoint: "0xf9e1815f151024bde4b7c10bac10e8ba9f6b53e1",
    rpc: process.env.RPC_HYPEREVM_TESTNET ?? "https://rpc.hyperliquid-testnet.xyz/evm",
    explorer: "https://testnet.purrsec.com",
    nativeSymbol: "HYPE",
    hub: false,
    lz: { sendLib: "0x43e505ba192aac7babdc1a796c87844171011684", receiveLib: "0x012f6eae2a0bf5916f48b5f37c62bcfb7c1ffda1", executor: "0x72e34f44eb09058bddaf1aeeebdec062f1844b00", dvn: "0x91e698871030d0e1b6c9268c20bb57e2720618dd" },
  },
  arbitrumSepolia: {
    name: "Arbitrum Sepolia",
    chainId: 421614,
    eid: 40231,
    endpoint: "0x6edce65403992e310a62460808c4b910d972f10f",
    rpc: process.env.RPC_ARBITRUM_SEPOLIA ?? "https://sepolia-rollup.arbitrum.io/rpc",
    explorer: "https://arbitrum-sepolia.blockscout.com",
    blockscout: "https://arbitrum-sepolia.blockscout.com/api",
    nativeSymbol: "ETH",
    hub: false,
    lz: { sendLib: "0x4f7cd4da19abb31b0ec98b9066b9e857b1bf9c0e", receiveLib: "0x75db67cdab2824970131d5aa9cecfc9f69c69636", executor: "0x5df3a1cebbd9c8ba7f8df51fd632a9aef8308897", dvn: "0x53f488e93b4f1b60e8e83aa374dbe1780a1ee8a8" },
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
};
