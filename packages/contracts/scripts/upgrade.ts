// Upgrades one UUPS proxy to an implementation built from this repo, keeping the proxy address: CONTRACT=OmnitideHarbor
import hre, { network } from "hardhat";
import { upgrades } from "@openzeppelin/hardhat-upgrades";
import { SCRIPT_CHAINS as CHAINS } from "../chains.js";
import { chainKeyById, deployerSigner, loadDeployments, saveDeployments } from "./lib.js";

const name = process.env.CONTRACT as "OmnitideHarbor" | "OmnitideClearinghouse" | undefined;
if (!name) throw new Error("set CONTRACT=<proxy name from deployments>");

const conn = await network.create();
const { ethers } = conn;
const up = await upgrades(hre, conn);
const signer = await deployerSigner(ethers);
const key = chainKeyById(Number((await ethers.provider.getNetwork()).chainId));
const all = loadDeployments();
const rec = all[key]?.[name];
if (!rec) throw new Error(`${name} is not deployed on ${key}`);

// state that must survive the upgrade untouched
const snapshot = async () => {
  if (name === "OmnitideClearinghouse") {
    const ch = await ethers.getContractAt(name, rec.proxy);
    return { owner: await ch.owner(), pool: (await ch.poolBalance()).toString(), collateral: (await ch.totalCollateral()).toString(), markets: Number(await ch.marketCount()), harbor: await ch.harbor() };
  }
  const h = await ethers.getContractAt(name, rec.proxy);
  return { owner: await h.owner(), totalAssets: (await h.totalAssets()).toString(), totalSupply: (await h.totalSupply()).toString() };
};
const before = await snapshot();
console.log(`${CHAINS[key].name} · ${signer.address} · ${name} ${rec.proxy}`);
console.log("impl before", await up.erc1967.getImplementationAddress(rec.proxy), before);

// "always": OZ matches implementations by bytecode without metadata, so it would otherwise reuse the old one
await up.upgradeProxy(rec.proxy, await ethers.getContractFactory(name), { kind: "uups", redeployImplementation: "always" });
const impl = await up.erc1967.getImplementationAddress(rec.proxy);
const after = await snapshot();
console.log("impl after ", impl, after);
if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("state changed across the upgrade");

if (process.env.OMNITIDE_ENV !== "fork") {
  rec.implementation = impl;
  saveDeployments(all);
}
