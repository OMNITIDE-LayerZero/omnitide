import { network } from "hardhat";
import { CHAINS } from "../chains.js";
import { chainKeyById, deployerSigner, loadDeployments } from "./lib.js";

// Testnet smoke for the Harbor OVault from a spoke. HARBOR_STEP=deposit sends tdUSD in and gets htdUSD back here;
// HARBOR_STEP=redeem sends htdUSD home and gets tdUSD back here. The return leg is prepaid as compose value.
const STEP = process.env.HARBOR_STEP ?? "deposit";
const AMOUNT = BigInt(process.env.AMOUNT ?? "100") * 10n ** 6n;
const { ethers } = await network.create();
const signer = await deployerSigner(ethers);
const key = chainKeyById(Number((await ethers.provider.getNetwork()).chainId));
const all = loadDeployments();
const hub = all.robinhoodTestnet!;
const here = CHAINS[key];

const hubProvider = new ethers.JsonRpcProvider(CHAINS.robinhoodTestnet.rpc);
const back = { dstEid: here.eid, to: ethers.zeroPadValue(signer.address, 32), amountLD: AMOUNT, minAmountLD: AMOUNT, extraOptions: "0x", composeMsg: "0x", oftCmd: "0x" };
const returnOft = STEP === "deposit" ? hub.OmnitideHarborShareAdapter!.proxy : hub.OmnitideUSD!.proxy;
const returnFee = (await (await ethers.getContractAt("OmnitideUSD", returnOft)).connect(hubProvider).quoteSend(back, false)).nativeFee;
const value = (returnFee * 15n) / 10n;

// compose option (index 0) carrying the return-leg fee as native value on the hub
const hex = (n: bigint, b: number) => n.toString(16).padStart(b * 2, "0");
const extraOptions = `0x0003010023030000${hex(50_000n, 16)}${hex(value, 16)}`;

const oft = await ethers.getContractAt("OmnitideUSD", STEP === "deposit" ? all[key]!.OmnitideUSD!.proxy : all[key]!.OmnitideHarborShare!.proxy);
if (STEP === "deposit" && (await oft.balanceOf(signer.address)) < AMOUNT) await (await oft.drip()).wait();
const minOut = (AMOUNT * 99n) / 100n;
const p = {
  dstEid: CHAINS.robinhoodTestnet.eid,
  to: ethers.zeroPadValue(hub.OmnitideHarbor!.proxy, 32),
  amountLD: AMOUNT,
  minAmountLD: AMOUNT,
  extraOptions,
  composeMsg: ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint32", "uint256"], [signer.address, here.eid, minOut]),
  oftCmd: "0x",
};
const q = await oft.quoteSend(p, false);
const tx = await oft.send(p, { nativeFee: q.nativeFee, lzTokenFee: 0n }, signer.address, { value: q.nativeFee });
await tx.wait();
console.log(`harbor ${STEP} ${key} → hub → ${key} · return fee ${ethers.formatEther(value)} ETH (hub) · LZ fee ${ethers.formatEther(q.nativeFee)} · tx ${tx.hash}`);
