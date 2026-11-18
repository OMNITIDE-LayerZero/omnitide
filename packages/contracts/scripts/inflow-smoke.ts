import { network } from "hardhat";
import { CHAINS } from "../chains.js";
import { chainKeyById, deployerSigner, loadDeployments } from "./lib.js";

// Testnet smoke: drip tdUSD on a spoke and Inflow it into the hub clearinghouse (OFT + lzCompose).
const AMOUNT = 100n * 10n ** 6n;
const { ethers } = await network.create();
const signer = await deployerSigner(ethers);
const key = chainKeyById(Number((await ethers.provider.getNetwork()).chainId));
const all = loadDeployments();
const usd = await ethers.getContractAt("OmnitideUSD", all[key]!.OmnitideUSD!.proxy);
if ((await usd.balanceOf(signer.address)) < AMOUNT) await (await usd.drip()).wait();
const p = {
  dstEid: CHAINS.robinhoodTestnet.eid,
  to: ethers.zeroPadValue(all.robinhoodTestnet!.OmnitideClearinghouse!.proxy, 32),
  amountLD: AMOUNT,
  minAmountLD: AMOUNT,
  extraOptions: "0x",
  composeMsg: ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signer.address]),
  oftCmd: "0x",
};
const q = await usd.quoteSend(p, false);
const tx = await usd.send(p, { nativeFee: q.nativeFee, lzTokenFee: 0n }, signer.address, { value: q.nativeFee });
await tx.wait();
console.log(`inflow ${key} → hub · fee ${ethers.formatEther(q.nativeFee)} · tx ${tx.hash}`);
