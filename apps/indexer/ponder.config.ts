import { createConfig } from "ponder";
import { CHAINS } from "@omnitide/contracts/chains";
import { DEPLOYMENTS } from "@omnitide/contracts/deployments";
import { omnitideUSDAbi, omnitideClearinghouseAbi } from "@omnitide/contracts/abi";

const d = DEPLOYMENTS.testnet;
const rpc = (key: keyof typeof CHAINS) => process.env[`PONDER_RPC_${CHAINS[key].chainId}`]?.split(",") ?? CHAINS[key].rpc;
const usdOn = (key: keyof typeof CHAINS) => ({ address: d[key].OmnitideUSD.proxy as `0x${string}`, startBlock: d[key].OmnitideUSD.block });

export default createConfig({
  ordering: "multichain",
  database: { kind: "postgres", connectionString: process.env.DATABASE_URL },
  chains: {
    robinhoodTestnet: { id: CHAINS.robinhoodTestnet.chainId, rpc: rpc("robinhoodTestnet"), pollingInterval: 2_000 },
    sepolia: { id: CHAINS.sepolia.chainId, rpc: rpc("sepolia"), maxRequestsPerSecond: 8 },
    fuji: { id: CHAINS.fuji.chainId, rpc: rpc("fuji"), maxRequestsPerSecond: 8 },
  },
  contracts: {
    OmnitideUSD: {
      abi: omnitideUSDAbi,
      chain: {
        robinhoodTestnet: usdOn("robinhoodTestnet"),
        sepolia: usdOn("sepolia"),
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
