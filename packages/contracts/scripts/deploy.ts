import hre, { network } from "hardhat";
import { upgrades } from "@openzeppelin/hardhat-upgrades";
import type { BaseContract } from "ethers";
import { SCRIPT_CHAINS as CHAINS } from "../chains.js";
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
// mainnet ships per version: OMNITIDE_VERSION=1 deploys V1.0 only, 2 adds V2 Current, 3 adds V3 Deep Water, 4 adds Lending
const VERSION = Number(process.env.OMNITIDE_VERSION ?? 4);
// mainnet open-interest cap per market (USD), sized to the Tide Pool; testnet keeps markets.ts
const oiCap = (usd: number) => (process.env.MAX_OI_USD ? Number(process.env.MAX_OI_USD) : usd);

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
    await (await ch.setMarket(m.id, ethers.encodeBytes32String(m.feed), m.initialMarginBps, m.maintenanceMarginBps, ethers.parseEther(String(oiCap(m.maxOpenInterestUsd))), true)).wait();
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

// tdUSD backed 1:1 by this chain's stablecoin
if (chain.stable && !dep.OmnitidePort) {
  const port = await up.deployProxy(await ethers.getContractFactory("OmnitidePort"), [DEPLOYER, DEPLOYER, chain.stable.address, dep.OmnitideUSD!.proxy], { kind: "uups" });
  await port.waitForDeployment();
  dep.OmnitidePort = await record(port);
  saveDeployments(all);
  console.log("OmnitidePort", dep.OmnitidePort.proxy, `(${chain.stable.symbol})`);
}
if (dep.OmnitidePort) {
  const usd = await ethers.getContractAt("OmnitideUSD", dep.OmnitideUSD!.proxy);
  if (!(await usd.minters(dep.OmnitidePort.proxy))) await (await usd.setMinter(dep.OmnitidePort.proxy, true)).wait();
}

// mainnet Tide Pool seed: POOL_SEED stablecoin → Port → tdUSD → pool (once, while the pool is empty)
if (chain.hub && dep.OmnitidePort && process.env.POOL_SEED) {
  const ch = await ethers.getContractAt("OmnitideClearinghouse", dep.OmnitideClearinghouse!.proxy);
  if ((await ch.poolBalance()) === 0n) {
    const seed = ethers.parseUnits(process.env.POOL_SEED, 6);
    const stable = new ethers.Contract(chain.stable!.address, ["function approve(address,uint256) returns (bool)"], signer);
    const usd = await ethers.getContractAt("OmnitideUSD", dep.OmnitideUSD!.proxy);
    const port = await ethers.getContractAt("OmnitidePort", dep.OmnitidePort.proxy);
    await (await stable.getFunction("approve")(dep.OmnitidePort.proxy, seed)).wait();
    await (await port.deposit(seed, DEPLOYER)).wait();
    await (await usd.approve(dep.OmnitideClearinghouse!.proxy, seed)).wait();
    await (await ch.fundPool(seed)).wait();
    console.log(`Tide Pool seeded with ${process.env.POOL_SEED} ${chain.stable!.symbol}-backed tdUSD`);
  }
}

// ───────── V2 Current: Harbor OVault on the hub, its share OFT and the lzRead Tide reader on Arbitrum ─────────
const lzOpts = { kind: "uups" as const, constructorArgs: [chain.endpoint], unsafeAllow: [...OFT_UNSAFE_ALLOW] };

if (VERSION >= 2 && chain.hub) {
  const chAddr = dep.OmnitideClearinghouse!.proxy;
  const CH = await ethers.getContractFactory("OmnitideClearinghouse");
  if (dep.OmnitideClearinghouse!.implementation !== (await up.erc1967.getImplementationAddress(chAddr)) || !(await hasHarborReserve(chAddr))) {
    await up.upgradeProxy(chAddr, CH, { kind: "uups" });
    dep.OmnitideClearinghouse!.implementation = await up.erc1967.getImplementationAddress(chAddr);
    saveDeployments(all);
    console.log("OmnitideClearinghouse upgraded →", dep.OmnitideClearinghouse!.implementation);
  }
  if (!dep.OmnitideHarbor) {
    const harbor = await up.deployProxy(await ethers.getContractFactory("OmnitideHarbor"), [DEPLOYER, DEPLOYER, chAddr], { kind: "uups" });
    await harbor.waitForDeployment();
    dep.OmnitideHarbor = await record(harbor);
    saveDeployments(all);
    console.log("OmnitideHarbor", dep.OmnitideHarbor.proxy);
  }
  if (!dep.OmnitideHarborShareAdapter) {
    const adapter = await up.deployProxy(await ethers.getContractFactory("OmnitideHarborShareAdapter"), [DEPLOYER], {
      ...lzOpts,
      constructorArgs: [dep.OmnitideHarbor.proxy, chain.endpoint],
    });
    await adapter.waitForDeployment();
    dep.OmnitideHarborShareAdapter = await record(adapter);
    saveDeployments(all);
    console.log("OmnitideHarborShareAdapter", dep.OmnitideHarborShareAdapter.proxy);
  }
  const harbor = await ethers.getContractAt("OmnitideHarbor", dep.OmnitideHarbor.proxy);
  if ((await harbor.shareOFT()) !== dep.OmnitideHarborShareAdapter.proxy) await (await harbor.setShareOFT(dep.OmnitideHarborShareAdapter.proxy)).wait();

  // hand the Tide Pool to Harbor: the deployer withdraws the seed and deposits it back as Harbor's first LP
  const ch = await ethers.getContractAt("OmnitideClearinghouse", chAddr);
  if ((await ch.harbor()) === ethers.ZeroAddress) {
    const pool = await ch.poolBalance();
    if (pool > 0n) await (await ch.defundPool(pool, DEPLOYER)).wait();
    await (await ch.setHarbor(dep.OmnitideHarbor.proxy)).wait();
    if (pool > 0n) {
      const usd = await ethers.getContractAt("OmnitideUSD", dep.OmnitideUSD!.proxy);
      await (await usd.approve(dep.OmnitideHarbor.proxy, pool)).wait();
      await (await harbor.deposit(pool, DEPLOYER)).wait();
    }
    console.log(`Tide Pool (${ethers.formatUnits(pool, 6)} tdUSD) now owned by Harbor`);
  }
} else if (VERSION >= 2) {
  if (chain.harborShares && !dep.OmnitideHarborShare) {
    const share = await up.deployProxy(await ethers.getContractFactory("OmnitideHarborShare"), [DEPLOYER], lzOpts);
    await share.waitForDeployment();
    dep.OmnitideHarborShare = await record(share);
    saveDeployments(all);
    console.log("OmnitideHarborShare", dep.OmnitideHarborShare.proxy);
  }
  if (chain.lzRead && !dep.OmnitideTideReader) {
    const targets = chain.lzRead.map((k) => ({ eid: CHAINS[k].eid, token: all[k]!.OmnitideUSD!.proxy }));
    const reader = await up.deployProxy(await ethers.getContractFactory("OmnitideTideReader"), [DEPLOYER, targets], lzOpts);
    await reader.waitForDeployment();
    dep.OmnitideTideReader = await record(reader);
    saveDeployments(all);
    console.log("OmnitideTideReader", dep.OmnitideTideReader.proxy, "reads", chain.lzRead.join(", "));
  }
}

// ───────── V3 Deep Water: Sealed Orders, Deep Pool, Lighthouse, Arena Badges, TIDE + Council, copy vaults ─────────
const BADGE_URI = process.env.BADGE_BASE_URI ?? (process.env.OMNITIDE_ENV?.startsWith("mainnet") ? "https://omnitide.trade/api/badge/" : "https://testnet.omnitide.trade/api/badge/");
const VOTING_PERIOD = isTestnet ? 2 * 86_400 : 7 * 86_400;
const PROPOSAL_THRESHOLD = ethers.parseEther("1000");

async function deployOnce(name: "OmnitideDeepPool" | "OmnitideToken" | "OmnitideLighthouse" | "OmnitideBadge" | "OmnitideCouncil", fn: () => Promise<BaseContract>) {
  if (dep[name]) return;
  const c = await fn();
  await c.waitForDeployment();
  dep[name] = await record(c);
  saveDeployments(all);
  console.log(name, await c.getAddress());
}

if (VERSION >= 3 && (chain.hub || chain.deepWater)) {
  const F = (n: string) => ethers.getContractFactory(n);
  if (chain.hub) {
    const chAddr = dep.OmnitideClearinghouse!.proxy;
    // positionCap(address) arrived with the Deep pool cap; older builds lack Sealed Orders and/or it
    if (!(await hasFn(chAddr, "positionCap(address)", ethers.ZeroHash))) {
      await up.upgradeProxy(chAddr, await F("OmnitideClearinghouse"), { kind: "uups" });
      dep.OmnitideClearinghouse!.implementation = await up.erc1967.getImplementationAddress(chAddr);
      saveDeployments(all);
      console.log("OmnitideClearinghouse upgraded (Sealed Orders, position caps) →", dep.OmnitideClearinghouse!.implementation);
    }
    await deployOnce("OmnitideDeepPool", async () => up.deployProxy(await F("OmnitideDeepPool"), [DEPLOYER, DEPLOYER, DEPLOYER, chAddr], { kind: "uups" }));
    const ch = await ethers.getContractAt("OmnitideClearinghouse", chAddr);
    const cap = await ch.marketCount(); // the Deep pool is one account for every Deep book: let it hold every listed market
    if ((await ch.positionCap(dep.OmnitideDeepPool!.proxy)) !== cap) {
      await (await ch.setPositionCap(dep.OmnitideDeepPool!.proxy, cap)).wait();
      console.log("Deep pool position cap →", cap);
    }
    if (dep.OmnitideCopyVaultFactory && !(await hasFn(dep.OmnitideCopyVaultFactory.vaultImplementation, "feeBps()"))) {
      const impl = await (await F("OmnitideCopyVault")).deploy();
      await impl.waitForDeployment();
      const beacon = await ethers.getContractAt(["function upgradeTo(address)"], dep.OmnitideCopyVaultFactory.beacon);
      await (await beacon.getFunction("upgradeTo")(await impl.getAddress())).wait();
      await up.upgradeProxy(dep.OmnitideCopyVaultFactory.proxy, await F("OmnitideCopyVaultFactory"), { kind: "uups" });
      dep.OmnitideCopyVaultFactory = {
        ...dep.OmnitideCopyVaultFactory,
        implementation: await up.erc1967.getImplementationAddress(dep.OmnitideCopyVaultFactory.proxy),
        vaultImplementation: await impl.getAddress(),
      };
      saveDeployments(all);
      console.log("copy vaults upgraded (leader fee) → vault impl", dep.OmnitideCopyVaultFactory.vaultImplementation);
    }
    if (!dep.OmnitideCopyVaultFactory) {
      const impl = await (await F("OmnitideCopyVault")).deploy();
      await impl.waitForDeployment();
      const minSeed = ethers.parseUnits(isTestnet ? "100" : "10", 6);
      const factory = await up.deployProxy(await F("OmnitideCopyVaultFactory"), [DEPLOYER, chAddr, await impl.getAddress(), minSeed], { kind: "uups" });
      await factory.waitForDeployment();
      dep.OmnitideCopyVaultFactory = { ...(await record(factory)), beacon: await (await ethers.getContractAt("OmnitideCopyVaultFactory", await factory.getAddress())).beacon(), vaultImplementation: await impl.getAddress() };
      saveDeployments(all);
      console.log("OmnitideCopyVaultFactory", dep.OmnitideCopyVaultFactory.proxy);
    }
  }
  if (chain.govToken) {
    if (!dep.OmnitideTokenAdapter) {
      const adapter = await up.deployProxy(await F("OmnitideTokenAdapter"), [DEPLOYER], { ...lzOpts, constructorArgs: [chain.govToken, chain.endpoint] });
      await adapter.waitForDeployment();
      dep.OmnitideTokenAdapter = { ...(await record(adapter)), token: chain.govToken };
      saveDeployments(all);
      console.log("OmnitideTokenAdapter", dep.OmnitideTokenAdapter.proxy);
    }
  } else await deployOnce("OmnitideToken", async () => up.deployProxy(await F("OmnitideToken"), [DEPLOYER, isTestnet ? "TIDE" : "OMNITIDE", isTestnet], lzOpts));
  await deployOnce("OmnitideLighthouse", async () => up.deployProxy(await F("OmnitideLighthouse"), [DEPLOYER, DEPLOYER], lzOpts));
  await deployOnce("OmnitideBadge", async () => up.deployProxy(await F("OmnitideBadge"), [DEPLOYER, DEPLOYER, !!chain.hub, BADGE_URI], lzOpts));
  const hubEid = Object.values(CHAINS).find((c) => c.hub)!.eid;
  await deployOnce("OmnitideCouncil", async () => up.deployProxy(await F("OmnitideCouncil"), [DEPLOYER, chain.govToken ?? dep.OmnitideToken!.proxy, hubEid, VOTING_PERIOD, PROPOSAL_THRESHOLD], lzOpts));
}

// ───────── V4 Lending (Anchor): borrow tdUSD against ETH on the hub ─────────
if (VERSION >= 4 && chain.hub && chain.weth) {
  const chAddr = dep.OmnitideClearinghouse!.proxy;
  if (!(await implHas(chAddr, "depositFor(address,uint256)"))) {
    await up.upgradeProxy(chAddr, await ethers.getContractFactory("OmnitideClearinghouse"), { kind: "uups", redeployImplementation: "always" });
    dep.OmnitideClearinghouse!.implementation = await up.erc1967.getImplementationAddress(chAddr);
    saveDeployments(all);
    console.log("OmnitideClearinghouse upgraded (depositFor) →", dep.OmnitideClearinghouse!.implementation);
  }
  if (!dep.OmnitideLending) {
    // mainnet opens small: LENDING_CAP_USD caps both supply and borrow (default $100), raised later with setParams
    const cap = ethers.parseUnits(process.env.LENDING_CAP_USD ?? (isTestnet ? "250000" : "100"), 6);
    const params = {
      ltvBps: 7000,
      liquidationBps: 8000,
      bonusBps: 500,
      reserveBps: 1000,
      closeFactorBps: 5000,
      baseRate: 0n,
      kinkRate: ethers.parseEther("0.04"),
      maxRate: ethers.parseEther("0.6"),
      kinkBps: 8000,
      supplyCap: cap,
      borrowCap: cap,
      dustDebt: ethers.parseUnits(isTestnet ? "10" : "1", 6),
    };
    const lending = await up.deployProxy(
      await ethers.getContractFactory("OmnitideLending"),
      [DEPLOYER, DEPLOYER, chAddr, chain.weth, ethers.encodeBytes32String("ETH-USD"), params],
      { kind: "uups" },
    );
    await lending.waitForDeployment();
    dep.OmnitideLending = await record(lending);
    saveDeployments(all);
    console.log("OmnitideLending", dep.OmnitideLending.proxy);
  }
}

// true when the proxy's current implementation carries the function selector
async function implHas(proxy: string, sig: string) {
  const code = await ethers.provider.getCode(await up.erc1967.getImplementationAddress(proxy));
  return code.includes(ethers.id(sig).slice(2, 10));
}

async function hasFn(addr: string, sig: string, args = "0x") {
  return ethers.provider.call({ to: addr, data: ethers.id(sig).slice(0, 10) + args.slice(2) }).then(() => true, () => false);
}

// the Harbor build that reserves open trader PnL; older implementations lack poolAvailable()
async function hasHarborReserve(addr: string) {
  return ethers.provider.call({ to: addr, data: ethers.id("poolAvailable()").slice(0, 10) }).then(() => true, () => false);
}

const spent = startBalance - (await ethers.provider.getBalance(signer.address));
const nonce = await ethers.provider.getTransactionCount(signer.address);
console.log(`spent ${ethers.formatEther(spent)} ${chain.nativeSymbol} · nonce ${nonce}`);
