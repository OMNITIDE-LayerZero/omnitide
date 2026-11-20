import { network } from "hardhat";
import { SCRIPT_CHAINS as CHAINS, type ChainKey } from "../chains.js";
import { chainKeyById, loadDeployments } from "./lib.js";

// Read-only: prints the effective send/receive library and ULN config (DVNs, confirmations) per pathway.
const ENDPOINT_ABI = [
  "function getSendLibrary(address,uint32) view returns (address)",
  "function getReceiveLibrary(address,uint32) view returns (address,bool)",
  "function getConfig(address,address,uint32,uint32) view returns (bytes)",
];
const ULN = "tuple(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs)";

const { ethers } = await network.create();
const key = chainKeyById(Number((await ethers.provider.getNetwork()).chainId));
const oapp = loadDeployments()[key]!.OmnitideUSD!.proxy;
const ep = new ethers.Contract(CHAINS[key].endpoint, ENDPOINT_ABI, ethers.provider);
const coder = ethers.AbiCoder.defaultAbiCoder();
for (const peer of Object.keys(CHAINS) as ChainKey[]) {
  if (peer === key) continue;
  const eid = CHAINS[peer].eid;
  for (const dir of ["send", "receive"] as const) {
    try {
      const lib = dir === "send" ? await ep.getFunction("getSendLibrary")(oapp, eid) : (await ep.getFunction("getReceiveLibrary")(oapp, eid))[0];
      const [uln] = coder.decode([ULN], await ep.getFunction("getConfig")(oapp, lib, eid, 2));
      console.log(`${key} ${dir} ${peer}: lib ${lib} conf ${uln.confirmations} dvns ${uln.requiredDVNs.join(",")}`);
    } catch (e) {
      console.log(`${key} ${dir} ${peer}: NONE (${(e as Error).message.slice(0, 80)})`);
    }
  }
}
