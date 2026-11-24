// After the Harbor-reserve upgrade: rebuilds costBasis for every market with open interest from Traded history, then marks prices.
import { network } from "hardhat";
import { chainKeyById, deployerSigner, loadDeployments } from "./lib.js";

const conn = await network.create();
const { ethers } = conn;
await deployerSigner(ethers);
const key = chainKeyById(Number((await ethers.provider.getNetwork()).chainId));
const rec = loadDeployments()[key]!.OmnitideClearinghouse!;
const ch = await ethers.getContractAt("OmnitideClearinghouse", rec.proxy);

const accounts = new Map<number, Set<string>>();
const head = await ethers.provider.getBlockNumber();
const STEP = 50_000;
for (let from = rec.block; from <= head; from += STEP) {
  for (const l of await ch.queryFilter(ch.filters.Traded(), from, Math.min(from + STEP - 1, head))) {
    const [account, marketId] = (l as unknown as { args: [string, bigint] }).args;
    const set = accounts.get(Number(marketId)) ?? new Set<string>();
    set.add(account);
    accounts.set(Number(marketId), set);
  }
}

for (let id = 0; id < Number(await ch.marketCount()); id++) {
  const m = await ch.markets(id);
  if (m.longSize === 0n && m.shortSize === 0n) continue;
  const open = [];
  for (const a of accounts.get(id) ?? []) if ((await ch.positions(a, id)).size !== 0n) open.push(a);
  await (await ch.syncCostBasis(id, open)).wait();
  console.log(`market ${id}: ${open.length} open positions, costBasis ${await ch.costBasis(id)}`);
}
console.log("traderPnl at last marks", (await ch.traderPnl()).toString(), "· keeper re-marks within a minute");
