import { network } from "hardhat";
import { SCRIPT_CHAINS as CHAINS } from "../chains.js";
import { chainKeyById, deployerSigner, loadDeployments } from "./lib.js";

// V1 smoke on the hub: stablecoin → Port → tdUSD → clearinghouse → BTC long → close → withdraw → redeem.
// AMOUNT = stablecoin in (default 1), NOTIONAL = BTC position size in USD (default 5).
const { ethers } = await network.create();
const signer = await deployerSigner(ethers);
const chainId = Number((await ethers.provider.getNetwork()).chainId);
const key = chainKeyById(chainId);
const chain = CHAINS[key];
const dep = loadDeployments()[key]!;
if (!chain.hub || !chain.stable || !dep.OmnitidePort) throw new Error(`${key}: run on the hub after the Port is deployed`);

const amount = ethers.parseUnits(process.env.AMOUNT ?? "1", 6);
const notional = Number(process.env.NOTIONAL ?? 5);
const me = signer.address;
const stable = new ethers.Contract(chain.stable.address, ["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"], signer);
const usd = await ethers.getContractAt("OmnitideUSD", dep.OmnitideUSD!.proxy);
const port = await ethers.getContractAt("OmnitidePort", dep.OmnitidePort.proxy);
const ch = await ethers.getContractAt("OmnitideClearinghouse", dep.OmnitideClearinghouse!.proxy);
const oracle = await ethers.getContractAt("OmnitideOracle", dep.OmnitideOracle!.proxy);

async function step(label: string, tx: Promise<{ wait: () => Promise<{ hash: string; gasUsed: bigint } | null> }>) {
  const r = (await (await tx).wait())!;
  console.log(`${label.padEnd(22)} ${r.hash} gas ${r.gasUsed}`);
}

const spot = Number(((await (await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot")).json()) as { data: { amount: string } }).data.amount);
const price = BigInt(Math.round(spot * 1e8)) * 10n ** 10n;
async function reports() {
  const timestamp = (await ethers.provider.getBlock("latest"))!.timestamp;
  const domain = { name: "OmnitideOracle", version: "1", chainId, verifyingContract: await oracle.getAddress() };
  const types = { PriceReport: [{ name: "feed", type: "bytes32" }, { name: "price", type: "uint256" }, { name: "timestamp", type: "uint64" }] };
  const feed = ethers.encodeBytes32String("BTC-USD");
  return [{ feed, price, timestamp, signature: await signer.signTypedData(domain, types, { feed, price, timestamp }) }];
}

const stableBefore = (await stable.getFunction("balanceOf")(me)) as bigint;
console.log(`${key}: ${ethers.formatUnits(amount, 6)} ${chain.stable.symbol} in, BTC $${spot} long $${notional}`);
await step("approve stable", stable.getFunction("approve")(dep.OmnitidePort.proxy, amount));
await step("Port.deposit", port.deposit(amount, me));
await step("approve tdUSD", usd.approve(dep.OmnitideClearinghouse!.proxy, amount));
await step("Clearinghouse.deposit", ch.deposit(amount));
const size = BigInt(Math.round((notional / spot) * 1e12)) * 10n ** 6n;
await step("open BTC long", ch.trade(0, size, (price * 102n) / 100n, await reports()));
await step("close BTC long", ch.trade(0, -size, (price * 98n) / 100n, await reports()));
const left = await ch.balances(me);
await step("withdraw", ch.withdraw(left, await ch.hubEid(), me, []));
await step("Port.redeem", port.redeem(left, me));
const stableAfter = (await stable.getFunction("balanceOf")(me)) as bigint;
console.log(`round trip cost ${ethers.formatUnits(stableBefore - stableAfter, 6)} ${chain.stable.symbol} (fees to the Tide Pool) · pool ${ethers.formatUnits(await ch.poolBalance(), 6)} · reserve ${ethers.formatUnits(await port.reserve(), 6)}`);
if ((await ch.balances(me)) !== 0n || (await usd.balanceOf(me)) !== 0n) throw new Error("smoke left tdUSD behind");
