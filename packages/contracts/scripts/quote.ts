import { network } from "hardhat";
import { SCRIPT_CHAINS as CHAINS, type ChainKey } from "../chains.js";
import { chainKeyById, loadDeployments } from "./lib.js";

// Read-only: quotes every outbound pathway (Inflow with compose to the hub, plain sends elsewhere).
const { ethers } = await network.create();
const key = chainKeyById(Number((await ethers.provider.getNetwork()).chainId));
const all = loadDeployments();
const usd = await ethers.getContractAt("OmnitideUSD", all[key]!.OmnitideUSD!.proxy);
const hub = all[(Object.keys(CHAINS) as ChainKey[]).find((k) => CHAINS[k].hub)!]!.OmnitideClearinghouse!.proxy;
const who = "0xB58dE05CC819F7B04ca611F23e4be9E4be0C23f9";
for (const peer of Object.keys(CHAINS) as ChainKey[]) {
  if (peer === key) continue;
  const toHub = CHAINS[peer].hub;
  const p = {
    dstEid: CHAINS[peer].eid,
    to: ethers.zeroPadValue(toHub ? hub : who, 32),
    amountLD: 1_000_000n,
    minAmountLD: 1_000_000n,
    extraOptions: "0x",
    composeMsg: toHub ? ethers.AbiCoder.defaultAbiCoder().encode(["address"], [who]) : "0x",
    oftCmd: "0x",
  };
  try {
    const q = await usd.quoteSend(p, false);
    console.log(`${key} → ${peer}${toHub ? " (compose)" : ""}: ${ethers.formatEther(q.nativeFee)} ${CHAINS[key].nativeSymbol}`);
  } catch (e) {
    console.log(`${key} → ${peer}: FAILED ${(e as Error).message.slice(0, 160)}`);
  }
}
