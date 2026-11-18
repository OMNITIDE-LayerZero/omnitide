import { createConfig } from "ponder";
import { CHAINS } from "@omnitide/contracts/chains";
import { DEPLOYMENTS } from "@omnitide/contracts/deployments";
import { omnitideUSDAbi, omnitideClearinghouseAbi } from "@omnitide/contracts/abi";

const d = DEPLOYMENTS.testnet;
const rpc = (key: keyof typeof CHAINS) => process.env[`PONDER_RPC_${CHAINS[key].chainId}`] ?? CHAINS[key].rpc;
const usdOn = (key: keyof typeof CHAINS) => ({ address: d[key].OmnitideUSD.proxy as `0x${string}`, startBlock: d[key].OmnitideUSD.block });

export default createConfig({
  ordering: "multichain",
  database: { kind: "postgres", connectionString: process.env.DATABASE_URL },
  chains: {
    robinhoodTestnet: { id: CHAINS.robinhoodTestnet.chainId, rpc: rpc("robinhoodTestnet"), pollingInterval: 2_000 },
    sepolia: { id: CHAINS.sepolia.chainId, rpc: rpc("sepolia"), maxRequestsPerSecond: 8 },
    monadTestnet: { id: CHAINS.monadTestnet.chainId, rpc: rpc("monadTestnet"), maxRequestsPerSecond: 8, ethGetLogsBlockRange: 100 },
    arcTestnet: { id: CHAINS.arcTestnet.chainId, rpc: rpc("arcTestnet"), maxRequestsPerSecond: 8 },
    fuji: { id: CHAINS.fuji.chainId, rpc: rpc("fuji"), maxRequestsPerSecond: 4, ethGetLogsBlockRange: 90 }, // public Fuji RPC caps eth_getLogs at 100 blocks
  },
  contracts: {
    OmnitideUSD: {
      abi: omnitideUSDAbi,
      chain: {
        robinhoodTestnet: usdOn("robinhoodTestnet"),
        sepolia: usdOn("sepolia"),
        monadTestnet: usdOn("monadTestnet"),
        arcTestnet: usdOn("arcTestnet"),
        fuji: usdOn("fuji"),
      },
      filter: [{ event: "OFTSent", args: {} }, { event: "OFTReceived", args: {} }, { event: "Dripped", args: {} }],
    },
    OmnitideClearinghouse: {
      abi: omnitideClearinghouseAbi,
      chain: "robinhoodTestnet",
      address: d.robinhoodTestnet.OmnitideClearinghouse.proxy as `0x${string}`,
      startBlock: d.robinhoodTestnet.OmnitideClearinghouse.block,
    },
  },
});
