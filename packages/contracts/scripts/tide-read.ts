import { network } from "hardhat";
import { chainKeyById, deployerSigner, loadDeployments } from "./lib.js";

// Pays for one lzRead of tdUSD supply on every readable chain (run on a chain that hosts OmnitideTideReader).
const { ethers } = await network.create();
await deployerSigner(ethers);
const key = chainKeyById(Number((await ethers.provider.getNetwork()).chainId));
const reader = await ethers.getContractAt("OmnitideTideReader", loadDeployments()[key]!.OmnitideTideReader!.proxy);
const fee = ((await reader.quote()) * 12n) / 10n;
const tx = await reader.refresh({ value: fee });
await tx.wait();
console.log(`lzRead requested on ${key} · fee ≤ ${ethers.formatEther(fee)} · tx ${tx.hash}`);
