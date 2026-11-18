import hre, { network } from "hardhat";
import { upgrades } from "@openzeppelin/hardhat-upgrades";
import type { BaseContract } from "ethers";
import { CHAINS } from "../chains.js";
import { MARKETS } from "../markets.js";
import { OFT_UNSAFE_ALLOW } from "../lz-options.js";
import { DEPLOYER, chainKeyById, deployerSigner, loadDeployments, saveDeployments, type ProxyRecord } from "./lib.js";

const conn = await network.create();
const { ethers } = conn;
const up = await upgrades(hre, conn);

const signer = await deployerSigner(ethers);
const { chainId } = await ethers.provider.getNetwork();
const key = chainKeyById(Number(chainId));
const chain = CHAINS[key];

const startBalance = await ethers.provider.getBalance(signer.address);
console.log(`network ${chain.name} (${chainId}) · deployer ${signer.address} · balance ${ethers.formatEther(startBalance)} ${chain.nativeSymbol}`);

const all = loadDeployments();
const dep = (all[key] ??= { chainId: chain.chainId, eid: chain.eid });
const isTestnet = (process.env.OMNITIDE_ENV ?? "testnet") === "testnet";

async function record(contract: BaseContract): Promise<ProxyRecord> {
  const proxy = await contract.getAddress();
  const tx = contract.deploymentTransaction();
  const receipt = tx ? await tx.wait() : null;
  return {
    proxy,
    implementation: await up.erc1967.getImplementationAddress(proxy),
    deployTx: tx?.hash ?? "",
    block: receipt?.blockNumber ?? 0,
  };
}

if (!dep.OmnitideUSD) {
  const USD = await ethers.getContractFactory("OmnitideUSD");
  const usd = await up.deployProxy(USD, [DEPLOYER, DEPLOYER, isTestnet], {
    kind: "uups",
    constructorArgs: [chain.endpoint],
    unsafeAllow: [...OFT_UNSAFE_ALLOW],
  });
  await usd.waitForDeployment();
  dep.OmnitideUSD = await record(usd);
  saveDeployments(all);
  console.log("OmnitideUSD", dep.OmnitideUSD.proxy);
}

if (chain.hub) {
  if (!dep.OmnitideOracle) {
    const Oracle = await ethers.getContractFactory("OmnitideOracle");
    const oracle = await up.deployProxy(Oracle, [DEPLOYER, DEPLOYER, 120], { kind: "uups" });
    await oracle.waitForDeployment();
    dep.OmnitideOracle = await record(oracle);
    saveDeployments(all);
    console.log("OmnitideOracle", dep.OmnitideOracle.proxy);
  }
  if (!dep.OmnitideClearinghouse) {
    const CH = await ethers.getContractFactory("OmnitideClearinghouse");
    const ch = await up.deployProxy(
      CH,
      [DEPLOYER, DEPLOYER, dep.OmnitideUSD!.proxy, dep.OmnitideOracle.proxy, 10, ethers.parseUnits("5000000", 6)],
      { kind: "uups" },
    );
    await ch.waitForDeployment();
    dep.OmnitideClearinghouse = await record(ch);
    saveDeployments(all);
    console.log("OmnitideClearinghouse", dep.OmnitideClearinghouse.proxy);
  }

  const ch = await ethers.getContractAt("OmnitideClearinghouse", dep.OmnitideClearinghouse.proxy);
  const listed = Number(await ch.marketCount());
  for (const m of MARKETS.filter((m) => m.id >= listed)) {
    await (await ch.setMarket(m.id, ethers.encodeBytes32String(m.feed), m.initialMarginBps, m.maintenanceMarginBps, ethers.parseEther(String(m.maxOpenInterestUsd)), true)).wait();
    console.log(`market ${m.id} ${m.symbol}`);
  }

  if ((await ch.poolBalance()) === 0n && isTestnet) {
    const usd = await ethers.getContractAt("OmnitideUSD", dep.OmnitideUSD!.proxy);
    const seed = ethers.parseUnits("250000", 6);
    await (await usd.faucetMint(DEPLOYER, seed)).wait();
    await (await usd.approve(dep.OmnitideClearinghouse.proxy, seed)).wait();
    await (await ch.fundPool(seed)).wait();
    console.log("Tide Pool seeded with 250,000 tdUSD (testnet)");
  }
}

const spent = startBalance - (await ethers.provider.getBalance(signer.address));
const nonce = await ethers.provider.getTransactionCount(signer.address);
console.log(`spent ${ethers.formatEther(spent)} ${chain.nativeSymbol} · nonce ${nonce}`);
