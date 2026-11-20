import { network } from "hardhat";
import { SCRIPT_CHAINS as CHAINS, type ChainKey } from "../chains.js";
import { chainKeyById, deployerSigner, loadDeployments } from "./lib.js";

// Sets an explicit LayerZero config (libraries, executor, LayerZero Labs DVN) for pathways that have no default.
// Usage: PEERS=monadTestnet,arcTestnet hardhat run scripts/set-pathway.ts --network robinhoodTestnet
const ENDPOINT_ABI = [
  "function setSendLibrary(address,uint32,address)",
  "function setReceiveLibrary(address,uint32,address,uint256)",
  "function setConfig(address,address,tuple(uint32 eid,uint32 configType,bytes config)[])",
];
const ULN = "tuple(uint64 confirmations,uint8 requiredDVNCount,uint8 optionalDVNCount,uint8 optionalDVNThreshold,address[] requiredDVNs,address[] optionalDVNs)";
const CONFIRMATIONS = 1n;

const { ethers } = await network.create();
const signer = await deployerSigner(ethers);
const key = chainKeyById(Number((await ethers.provider.getNetwork()).chainId));
const local = CHAINS[key];
const oapp = loadDeployments()[key]!.OmnitideUSD!.proxy;
const ep = new ethers.Contract(local.endpoint, ENDPOINT_ABI, signer);
const coder = ethers.AbiCoder.defaultAbiCoder();
const uln = coder.encode([ULN], [[CONFIRMATIONS, 1, 0, 0, [local.lz.dvn], []]]);
const executor = coder.encode(["tuple(uint32 maxMessageSize,address executor)"], [[10_000, local.lz.executor]]);

for (const peer of (process.env.PEERS ?? "").split(",").filter(Boolean) as ChainKey[]) {
  const eid = CHAINS[peer].eid;
  await (await ep.getFunction("setSendLibrary")(oapp, eid, local.lz.sendLib)).wait();
  await (await ep.getFunction("setReceiveLibrary")(oapp, eid, local.lz.receiveLib, 0)).wait();
  await (await ep.getFunction("setConfig")(oapp, local.lz.sendLib, [{ eid, configType: 1, config: executor }, { eid, configType: 2, config: uln }])).wait();
  await (await ep.getFunction("setConfig")(oapp, local.lz.receiveLib, [{ eid, configType: 2, config: uln }])).wait();
  console.log(`${key} ⇄ ${peer} configured (DVN ${local.lz.dvn}, ${CONFIRMATIONS} confirmation)`);
}
