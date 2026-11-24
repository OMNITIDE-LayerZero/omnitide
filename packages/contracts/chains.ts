// Single source of chain params for deploy scripts; values verified live in the pre-flight check.
export type TestnetChainKey = "robinhoodTestnet" | "arbitrumSepolia" | "hyperEvmTestnet" | "sepolia";
export type MainnetChainKey = "robinhood" | "arbitrum" | "hyperEvm";
export type ChainKey = TestnetChainKey | MainnetChainKey;

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
  /** Chains this one can lzRead (LayerZero read DVN coverage, checked 2026-11-20); only spokes with a ReadLib carry it. */
  lzRead?: ChainKey[];
  /** Spoke that carries Harbor shares (needs direct LayerZero lanes both ways with the hub). */
  harborShares?: boolean;
  /** Spoke carries the V3 OApps: TIDE, Council, Lighthouse and Arena Badges. */
  deepWater?: boolean;
  /** Dollar stablecoin an OmnitidePort mints tdUSD against (mainnet only; testnet tdUSD comes from the faucet). */
  stable?: { symbol: string; address: `0x${string}` };
  /** Hub only: launched governance token that OmnitideTokenAdapter wraps into an OFT (mainnet $OMNITIDE); else TIDE is deployed. */
  govToken?: `0x${string}`;
}

export const TESTNET_CHAINS: Record<TestnetChainKey, ChainConfig> = {
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
    lzRead: ["arbitrumSepolia", "sepolia"],
    harborShares: true,
    deepWater: true,
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

// Mainnet set (LayerZero metadata-api, checked 2026-11-21): direct lanes hub ⇄ Arbitrum ⇄ HyperEVM, no relay needed.
export const MAINNET_CHAINS: Record<MainnetChainKey, ChainConfig> = {
  robinhood: {
    name: "Robinhood Chain",
    chainId: 4663,
    eid: 30416,
    endpoint: "0x6f475642a6e85809b1c36fa62763669b1b48dd5b",
    rpc: process.env.RPC_ROBINHOOD ?? "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robinhoodchain.blockscout.com",
    blockscout: "https://robinhoodchain.blockscout.com/api",
    nativeSymbol: "ETH",
    hub: true,
    stable: { symbol: "USDG", address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" },
    govToken: "0x9e3e0595376894875901b5082b135b13e9fc1fa2",
    lz: { sendLib: "0xc39161c743d0307eb9bcc9fef03eeb9dc4802de7", receiveLib: "0xe1844c5d63a9543023008d332bd3d2e6f1fe1043", executor: "0x4208d6e27538189bb48e603d6123a94b8abe0a0b", dvn: "0xd01ae6905d48315f7be10c7330aecf8360ef5b12" },
  },
  hyperEvm: {
    name: "HyperEVM",
    chainId: 999,
    eid: 30367,
    endpoint: "0x3a73033c0b1407574c76bdbac67f126f6b4a9aa9",
    rpc: process.env.RPC_HYPEREVM ?? "https://rpc.hyperliquid.xyz/evm",
    explorer: "https://hyperevmscan.io",
    nativeSymbol: "HYPE",
    hub: false,
    deepWater: true,
    stable: { symbol: "USDC", address: "0xb88339CB7199b77E23DB6E890353E22632Ba630f" },
    lz: { sendLib: "0xfd76d9cb0bac839725ab79127e7411fe71b1e3ca", receiveLib: "0x7cacbe439ead55fa1c22790330b12835c6884a91", executor: "0x41bdb4aa4a63a5b2efc531858d3118392b1a1c3d", dvn: "0xc097ab8cd7b053326dfe9fb3e3a31a0cce3b526f" },
  },
  arbitrum: {
    name: "Arbitrum One",
    chainId: 42161,
    eid: 30110,
    endpoint: "0x1a44076050125825900e736c501f859c50fe728c",
    rpc: process.env.RPC_ARBITRUM ?? "https://arb1.arbitrum.io/rpc",
    explorer: "https://arbitrum.blockscout.com",
    blockscout: "https://arbitrum.blockscout.com/api",
    nativeSymbol: "ETH",
    hub: false,
    lzRead: ["arbitrum", "hyperEvm"],
    harborShares: true,
    deepWater: true,
    stable: { symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
    lz: { sendLib: "0x975bcd720be66659e3eb3c0e4f1866a3020e493a", receiveLib: "0x7b9e184e07a6ee1ac23eae0fe8d6be2f663f05e6", executor: "0x31cae3b7fb82d847621859fb1585353c5720660d", dvn: "0x2f55c492897526677c5b68fb199ea31e2c126416" },
  },
};

/** Every chain OMNITIDE knows; apps show the ones with contracts in their env's deployment file. */
export const CHAINS: Record<ChainKey, ChainConfig> = { ...TESTNET_CHAINS, ...MAINNET_CHAINS };

/** Chain set the contract scripts act on: mainnet when OMNITIDE_ENV is `mainnet` or `mainnet-fork`. */
// shortcut: typed as the full record so scripts index it freely; only the env's keys exist at runtime
export const SCRIPT_CHAINS = (process.env.OMNITIDE_ENV?.startsWith("mainnet") ? MAINNET_CHAINS : TESTNET_CHAINS) as Record<ChainKey, ChainConfig>;
