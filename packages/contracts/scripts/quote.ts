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

// V3 OApps: governance token, Lighthouse, Badge, Council (vote only from spokes, proposals only from the hub)
const d = all[key]!;
if (d.OmnitideCouncil) {
  const peers = (Object.keys(CHAINS) as ChainKey[]).filter((k) => k !== key && all[k]?.OmnitideCouncil);
  const eids = peers.map((k) => CHAINS[k].eid);
  const fmt = (v: bigint) => `${ethers.formatEther(v)} ${CHAINS[key].nativeSymbol}`;
  const tryQ = async (label: string, fn: () => Promise<bigint>) => {
    try {
      console.log(`${key} ${label}: ${fmt(await fn())}`);
    } catch (e) {
      console.log(`${key} ${label}: FAILED ${(e as Error).message.slice(0, 160)}`);
    }
  };
  const gov = await ethers.getContractAt("OmnitideToken", (d.OmnitideTokenAdapter ?? d.OmnitideToken)!.proxy);
  for (const k of peers) {
    const p = { dstEid: CHAINS[k].eid, to: ethers.zeroPadValue(who, 32), amountLD: 10n ** 18n, minAmountLD: 10n ** 18n, extraOptions: "0x", composeMsg: "0x", oftCmd: "0x" };
    await tryQ(`gov token → ${k}`, async () => (await gov.quoteSend(p, false)).nativeFee);
  }
  const lh = await ethers.getContractAt("OmnitideLighthouse", d.OmnitideLighthouse!.proxy);
  const now = BigInt(Math.floor(Date.now() / 1000));
  await tryQ(`lighthouse → ${peers.join("+")}`, () => lh.quoteShine({ account: who, score: 80, grade: 1, issuedAt: now, expiry: now + 604_800n }, eids));
  const council = await ethers.getContractAt("OmnitideCouncil", d.OmnitideCouncil.proxy);
  if (CHAINS[key].hub) await tryQ(`council propose → ${peers.join("+")}`, () => council.quotePropose(eids));
  else await tryQ("council vote → hub", () => council.quoteVote(1n, 1, who));
}
