// Single source of chain params for deploy scripts; values verified live in the pre-flight check.
export type ChainKey =
  | "robinhoodTestnet"
  | "sepolia"
  | "fuji"
  | "hyperEvmTestnet"
  | "baseSepolia"
  | "arbitrumSepolia"
  | "optimismSepolia"
  | "bscTestnet"
  | "polygonAmoy"
  | "domaTestnet";

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
  fuji: {
    name: "Avalanche Fuji",
    chainId: 43113,
    eid: 40106,
    endpoint: "0x6edce65403992e310a62460808c4b910d972f10f",
    rpc: process.env.RPC_FUJI ?? "https://avalanche-fuji-c-chain-rpc.publicnode.com",
    explorer: "https://testnet.snowtrace.io",
    etherscanApi: "https://api.routescan.io/v2/network/testnet/evm/43113/etherscan/api",
    nativeSymbol: "AVAX",
    hub: false,
    lz: { sendLib: "0x69bf5f48d2072dfebc670a1d19dff91d0f4e8170", receiveLib: "0x819f0faf2cb1fba15b9cb24c9a2bdadb0f895daf", executor: "0xa7bfa9d51032f82d649a501b6a1f922fc2f7d4e3", dvn: "0x9f0e79aeb198750f963b6f30b99d87c6ee5a0467" },
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
  baseSepolia: {
    name: "Base Sepolia",
    chainId: 84532,
    eid: 40245,
    endpoint: "0x6edce65403992e310a62460808c4b910d972f10f",
    rpc: process.env.RPC_BASE_SEPOLIA ?? "https://base-sepolia-rpc.publicnode.com",
    explorer: "https://base-sepolia.blockscout.com",
    blockscout: "https://base-sepolia.blockscout.com/api",
    nativeSymbol: "ETH",
    hub: false,
    lz: { sendLib: "0xc1868e054425d378095a003ecba3823a5d0135c9", receiveLib: "0x12523de19dc41c91f7d2093e0cfbb76b17012c8d", executor: "0x8a3d588d9f6ac041476b094f97ff94ec30169d3d", dvn: "0xe1a12515f9ab2764b887bf60b923ca494ebbb2d6" },
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
  optimismSepolia: {
    name: "OP Sepolia",
    chainId: 11155420,
    eid: 40232,
    endpoint: "0x6edce65403992e310a62460808c4b910d972f10f",
    rpc: process.env.RPC_OPTIMISM_SEPOLIA ?? "https://optimism-sepolia-rpc.publicnode.com",
    explorer: "https://optimism-sepolia.blockscout.com",
    blockscout: "https://optimism-sepolia.blockscout.com/api",
    nativeSymbol: "ETH",
    hub: false,
    lz: { sendLib: "0xb31d2cb502e25b30c651842c7c3293c51fe6d16f", receiveLib: "0x9284fd59b95b9143af0b9795cac16eb3c723c9ca", executor: "0xdc0d68899405673b932f0db7f8a49191491a5bcb", dvn: "0xd680ec569f269aa7015f7979b4f1239b5aa4582c" },
  },
  bscTestnet: {
    name: "BNB Chain Testnet",
    chainId: 97,
    eid: 40102,
    endpoint: "0x6edce65403992e310a62460808c4b910d972f10f",
    rpc: process.env.RPC_BSC_TESTNET ?? "https://bsc-testnet-rpc.publicnode.com",
    explorer: "https://testnet.bscscan.com",
    nativeSymbol: "BNB",
    hub: false,
    lz: { sendLib: "0x55f16c442907e86d764afdc2a07c2de3bdac8bb7", receiveLib: "0x188d4bbced671a7aa2b5055937f79510a32e9683", executor: "0x31894b190a8babd9a067ce59fde0bfcfd2b18470", dvn: "0x0ee552262f7b562efced6dd4a7e2878ab897d405" },
  },
  polygonAmoy: {
    name: "Polygon Amoy",
    chainId: 80002,
    eid: 40267,
    endpoint: "0x6edce65403992e310a62460808c4b910d972f10f",
    rpc: process.env.RPC_POLYGON_AMOY ?? "https://polygon-amoy.gateway.tenderly.co",
    explorer: "https://amoy.polygonscan.com",
    nativeSymbol: "POL",
    hub: false,
    lz: { sendLib: "0x1d186c560281b8f1af831957ed5047fd3ab902f9", receiveLib: "0x53fd4c4fbbd53f6bc58cae6704b92db1f360a648", executor: "0x4cf1b3fa61465c2c907f82fc488b43223ba0cf93", dvn: "0x55c175dd5b039331db251424538169d8495c18d1" },
  },
  domaTestnet: {
    name: "Doma Testnet",
    chainId: 97476,
    eid: 40425,
    endpoint: "0x2072a32df77bae5713853d666f26ba5e47e54717",
    rpc: process.env.RPC_DOMA_TESTNET ?? "https://rpc-testnet.doma.xyz",
    explorer: "https://explorer-testnet.doma.xyz",
    blockscout: "https://explorer-testnet.doma.xyz/api",
    nativeSymbol: "ETH",
    hub: false,
    lz: { sendLib: "0x638b6d10d981273e19e32f812c9b916e82c86927", receiveLib: "0x340b5e5e90a6d177e7614222081e0f9cdd54f25c", executor: "0xb63c87d146cbe60b3c0419003ebd24f21374c8ae", dvn: "0xfee867ed545f26621dc701e6164e02ead9c6b081" },
  },
};
