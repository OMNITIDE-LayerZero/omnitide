import { network } from "hardhat";
import { CHAINS } from "../chains.js";
import { chainKeyById, deployerSigner, loadDeployments } from "./lib.js";

// Testnet smoke: drip tdUSD on a spoke and Inflow it into the hub clearinghouse (OFT + lzCompose).
// INFLOW_VIA=sepolia ferries to the deployer on Sepolia instead, for spokes without a hub lane (Monad, Arc).
const AMOUNT = BigInt(process.env.AMOUNT ?? "100") * 10n ** 6n;
const via = process.env.INFLOW_VIA as keyof typeof CHAINS | undefined;
const { ethers } = await network.create();
const signer = await deployerSigner(ethers);
const key = chainKeyById(Number((await ethers.provider.getNetwork()).chainId));
const all = loadDeployments();
const usd = await ethers.getContractAt("OmnitideUSD", all[key]!.OmnitideUSD!.proxy);
if ((await usd.balanceOf(signer.address)) < AMOUNT) await (await usd.drip()).wait();
console.log(`signer ${signer.address} · chain ${key} (${CHAINS[key].chainId})`);
const p = {
  dstEid: CHAINS[via ?? "robinhoodTestnet"].eid,
  to: ethers.zeroPadValue(via ? signer.address : all.robinhoodTestnet!.OmnitideClearinghouse!.proxy, 32),
  amountLD: AMOUNT,
  minAmountLD: AMOUNT,
  extraOptions: "0x",
  composeMsg: via ? "0x" : ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signer.address]),
  oftCmd: "0x",
};
const q = await usd.quoteSend(p, false);
const tx = await usd.send(p, { nativeFee: q.nativeFee, lzTokenFee: 0n }, signer.address, { value: q.nativeFee });
await tx.wait();
console.log(`inflow ${key} → ${via ?? "hub"} · fee ${ethers.formatEther(q.nativeFee)} · tx ${tx.hash}`);
