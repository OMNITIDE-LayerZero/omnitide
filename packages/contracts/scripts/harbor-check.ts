// V2 Current check on any env: on the hub redeem + re-deposit a little htdUSD; on spokes quote the share lane and lzRead.
import { network } from "hardhat";
import { SCRIPT_CHAINS as CHAINS, type ChainKey } from "../chains.js";
import { chainKeyById, deployerSigner, loadDeployments } from "./lib.js";

const AMOUNT = BigInt(process.env.AMOUNT ?? "500000"); // 0.5 htdUSD
const { ethers } = await network.create();
const signer = await deployerSigner(ethers);
const key = chainKeyById(Number((await ethers.provider.getNetwork()).chainId));
const all = loadDeployments();
const here = all[key]!;

if (CHAINS[key].hub) {
  const harbor = await ethers.getContractAt("OmnitideHarbor", here.OmnitideHarbor!.proxy);
  const ch = await ethers.getContractAt("OmnitideClearinghouse", here.OmnitideClearinghouse!.proxy);
  const usd = await ethers.getContractAt("OmnitideUSD", here.OmnitideUSD!.proxy);
  console.log(`pool ${ethers.formatUnits(await ch.poolBalance(), 6)} · available ${ethers.formatUnits(await ch.poolAvailable(), 6)} · traderPnl ${await ch.traderPnl()} · harbor assets ${ethers.formatUnits(await harbor.totalAssets(), 6)}`);
  const out = await harbor.previewRedeem(AMOUNT);
  await (await harbor.redeem(AMOUNT, signer.address, signer.address)).wait();
  await (await usd.approve(here.OmnitideHarbor!.proxy, out)).wait();
  await (await harbor.deposit(out, signer.address)).wait();
  console.log(`redeemed ${ethers.formatUnits(AMOUNT, 6)} htdUSD → ${ethers.formatUnits(out, 6)} tdUSD and deposited it back · shares ${ethers.formatUnits(await harbor.balanceOf(signer.address), 6)}`);
}

const shareOft = here.OmnitideHarborShareAdapter ?? here.OmnitideHarborShare;
for (const peer of (Object.keys(CHAINS) as ChainKey[]).filter((k) => k !== key && (all[k]?.OmnitideHarborShare || all[k]?.OmnitideHarborShareAdapter))) {
  const oft = await ethers.getContractAt("OmnitideUSD", shareOft!.proxy);
  const p = { dstEid: CHAINS[peer].eid, to: ethers.zeroPadValue(signer.address, 32), amountLD: AMOUNT, minAmountLD: AMOUNT, extraOptions: "0x", composeMsg: "0x", oftCmd: "0x" };
  console.log(`htdUSD ${key} → ${peer}: ${ethers.formatEther((await oft.quoteSend(p, false)).nativeFee)} ${CHAINS[key].nativeSymbol}`);
}
if (here.OmnitideTideReader) {
  const reader = await ethers.getContractAt("OmnitideTideReader", here.OmnitideTideReader.proxy);
  console.log(`lzRead quote ${ethers.formatEther(await reader.quote())} ${CHAINS[key].nativeSymbol}`);
}
