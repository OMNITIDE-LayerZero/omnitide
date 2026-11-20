import { network } from "hardhat";
import { CHAINS } from "../chains.js";
import { MARKETS } from "../markets.js";
import { DEEP_INTENT_TYPES, DEEP_MESSAGE, DEEP_WITHDRAWAL_TYPES, deepCommitment, deepId, deepIntentDomain, deriveDeepKeys, lighthouseMessage, open, randomSalt, seal, sealedOrderCommitment, type DeepBook } from "../deep.js";
import { chainKeyById, deployerSigner, loadDeployments } from "./lib.js";

// Live V3 smoke against the deployed stack and the public site API.
// STEP: deep | sealed | lighthouse | badge | council-arb | council | vote-arb | copy | copy-arb
const STEP = process.env.STEP ?? "deep";
const SITE = process.env.SITE ?? "https://omnitide-testnet.vercel.app";
const { ethers } = await network.create();
const signer = await deployerSigner(ethers);
const chainId = Number((await ethers.provider.getNetwork()).chainId);
const key = chainKeyById(chainId);
const all = loadDeployments();
const hub = all.robinhoodTestnet!;
const usd = (n: number) => BigInt(Math.round(n * 1e6));
const log = (m: string) => console.log(`[${STEP}] ${m}`);
log(`signer ${signer.address.slice(0, 6)}… on ${key} (${chainId})`);

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${SITE}${path}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)) });
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`${path} ${res.status}: ${json.error}`);
  return json;
}

async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 240_000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5_000));
  }
}

async function reportsFor(account: string, extra?: string) {
  const ch = await ethers.getContractAt("OmnitideClearinghouse", hub.OmnitideClearinghouse!.proxy);
  const open = (await ch.openMarkets(account)) as bigint[];
  const feeds = [...new Set([...open.map((id) => MARKETS[Number(id)]!.feed), ...(extra ? [extra] : [])])];
  if (!feeds.length) return [];
  return (await api<{ reports: { feed: string; price: string; timestamp: number; signature: string }[] }>(`/api/reports?feeds=${feeds.join(",")}`)).reports;
}

async function tdusd() {
  const t = await ethers.getContractAt("OmnitideUSD", all[key]!.OmnitideUSD!.proxy);
  if ((await t.balanceOf(signer.address)) < usd(300)) await (await t.drip()).wait();
  return t;
}

const keys = deriveDeepKeys((await signer.signMessage(DEEP_MESSAGE)) as `0x${string}`);
const id = deepId(signer.address as `0x${string}`, keys.salt);

async function latestBook() {
  const notes = await api<{ kind: string; ciphertext: `0x${string}` | null; commitment: string }[]>(`/api/indexer/deep/${id}?limit=50`);
  const s = notes.find((n) => n.kind === "seal" && n.ciphertext);
  const text = s ? open(keys.viewPrivate, s.ciphertext!) : null;
  if (!text) return null;
  const book = JSON.parse(text) as DeepBook;
  if (deepCommitment(book) !== s!.commitment) throw new Error("seal does not match its commitment");
  return book;
}

if (STEP === "deep") {
  const pool = await ethers.getContractAt("OmnitideDeepPool", hub.OmnitideDeepPool!.proxy);
  const reg = await signer.signTypedData(deepIntentDomain(chainId), { DeepRegister: [...DEEP_INTENT_TYPES.DeepRegister] }, { id, salt: keys.salt, viewKey: keys.viewPublic });
  await api("/api/keeper/deep/register", { owner: signer.address, id, salt: keys.salt, viewKey: keys.viewPublic, signature: reg });
  log(`registered ${id.slice(0, 10)}…`);
  const existing = await latestBook().catch(() => null);
  if (!existing || BigInt(existing.collateral) < usd(50)) {
    const t = await tdusd();
    await (await t.approve(await pool.getAddress(), usd(50))).wait();
    const dep = await pool.deposit(id, usd(50));
    await dep.wait();
    log(`deposit 50 tdUSD · ${dep.hash}`);
  }
  const funded = await until("first seal", async () => {
    const b = await latestBook();
    return b && BigInt(b.collateral) >= usd(50) ? b : null;
  });
  log(`sealed + verified · collateral ${Number(funded.collateral) / 1e6}`);

  const btc = await api<{ prices: { feed: string; price: string }[] }>("/api/prices");
  const px = Number(btc.prices.find((p) => p.feed === "BTC-USD")!.price);
  const size = BigInt(Math.round((100 / px) * 1e12)) * 10n ** 6n;
  async function intent(sizeDelta: bigint) {
    const { intentNonce } = await api<{ intentNonce: number }>(`/api/keeper/deep/status?id=${id}`);
    const limit = BigInt(Math.round(px * (sizeDelta > 0n ? 1.02 : 0.98) * 1e8)) * 10n ** 10n;
    const msg = { id, marketId: 0, sizeDelta, priceLimit: limit, nonce: BigInt(intentNonce + 1), deadline: BigInt(Math.floor(Date.now() / 1000) + 120) };
    const signature = await signer.signTypedData(deepIntentDomain(chainId), { DeepTrade: [...DEEP_INTENT_TYPES.DeepTrade] }, msg);
    return api<{ tx: string }>("/api/keeper/deep/trade", { ...msg, nonce: Number(msg.nonce), deadline: Number(msg.deadline), signature });
  }
  log(`deep long BTC $100 · ${(await intent(size)).tx}`);
  await until("position seal", async () => ((await latestBook())?.positions.length ? true : null));
  log("position sealed + verified");
  log(`deep close BTC · ${(await intent(-size)).tx}`);
  const flat = await until("flat seal", async () => {
    const b = await latestBook();
    return b && b.positions.length === 0 && b.history.filter((h) => h.kind === "trade").length >= 2 ? b : null;
  });
  log(`flat · realized ${Number(flat.realized) / 1e6} · fees ${Number(flat.fees) / 1e6}`);

  const w = { owner: signer.address, salt: keys.salt, amount: usd(20), dstEid: CHAINS.robinhoodTestnet.eid, receiver: signer.address, deadline: BigInt(Math.floor(Date.now() / 1000) + 600) };
  const wsig = await signer.signTypedData({ name: "OMNITIDE Deep Pool", version: "1", chainId, verifyingContract: await pool.getAddress() }, { DeepWithdrawal: [...DEEP_WITHDRAWAL_TYPES.DeepWithdrawal] }, { salt: w.salt, amount: w.amount, dstEid: w.dstEid, receiver: w.receiver, deadline: w.deadline });
  log(`withdraw 20 tdUSD · ${(await api<{ tx: string }>("/api/keeper/deep/withdraw", { w: { ...w, deadline: Number(w.deadline) }, signature: wsig })).tx}`);
  const after = await until("withdraw seal", async () => {
    const b = await latestBook();
    return b && b.history[0]?.kind === "withdraw" ? b : null;
  });
  log(`after withdraw · collateral ${Number(after.collateral) / 1e6} · verified against chain`);
}

if (STEP === "sealed") {
  const ch = await ethers.getContractAt("OmnitideClearinghouse", hub.OmnitideClearinghouse!.proxy);
  const t = await tdusd();
  if ((await ch.balances(signer.address)) < usd(20)) {
    await (await t.approve(await ch.getAddress(), usd(30))).wait();
    await (await ch.deposit(usd(30))).wait();
  }
  const prices = await api<{ prices: { feed: string; price: string }[] }>("/api/prices");
  const px = Number(prices.prices.find((p) => p.feed === "ETH-USD")!.price);
  const size = BigInt(Math.round((60 / px) * 1e12)) * 10n ** 6n;
  const buy = await ch.trade(1, size, BigInt(Math.round(px * 1.02 * 1e8)) * 10n ** 10n, await reportsFor(signer.address, "ETH-USD"));
  await buy.wait();
  log(`public ETH long $60 · ${buy.hash}`);
  // stop-loss just above the mark: already triggered, so the keeper must decrypt and fill it
  const plain = { marketId: 1, kind: 1 as const, sizeDelta: (-size).toString(), triggerPrice: (BigInt(Math.round(px * 1.01 * 1e8)) * 10n ** 10n).toString(), salt: randomSalt() };
  const { keeperKey } = await api<{ keeperKey: `0x${string}` }>("/api/keeper/deep/key");
  const placed = await ch.placeSealedOrder(sealedOrderCommitment(signer.address as `0x${string}`, plain), seal([keeperKey, keys.viewPublic], JSON.stringify(plain)));
  await placed.wait();
  log(`sealed stop placed · ${placed.hash}`);
  const filled = await until("sealed fill", async () => {
    const rows = await api<{ id: string; status: string; fillPrice: string | null }[]>(`/api/indexer/sealed?account=${signer.address}`);
    return rows.find((r) => r.status === "filled") ?? null;
  });
  log(`sealed order #${filled.id} filled at ${Number(BigInt(filled.fillPrice!)) / 1e18}`);
}

if (STEP === "lighthouse") {
  const ch = await ethers.getContractAt("OmnitideClearinghouse", hub.OmnitideClearinghouse!.proxy);
  if (((await ch.openMarkets(signer.address)) as bigint[]).length === 0) {
    const px = Number((await api<{ prices: { feed: string; price: string }[] }>("/api/prices")).prices.find((p) => p.feed === "BTC-USD")!.price);
    const tx = await ch.trade(0, BigInt(Math.round((40 / px) * 1e12)) * 10n ** 6n, BigInt(Math.round(px * 1.02 * 1e8)) * 10n ** 10n, await reportsFor(signer.address, "BTC-USD"));
    await tx.wait();
    log(`public BTC long $40 to score · ${tx.hash}`);
  }
  const issuedAt = new Date().toISOString();
  const signature = await signer.signMessage(lighthouseMessage(signer.address, chainId, issuedAt));
  const r = await api<{ beam: { account: string; score: number; grade: number; issuedAt: number; expiry: number }; signature: string }>("/api/keeper/lighthouse", { account: signer.address, chainId, issuedAt, signature });
  const lh = await ethers.getContractAt("OmnitideLighthouse", hub.OmnitideLighthouse!.proxy);
  const eids = [CHAINS.arbitrumSepolia.eid];
  const fee = await lh.quoteShine(r.beam, eids);
  const tx = await lh.shine(r.beam, r.signature, eids, { value: (fee * 11n) / 10n });
  await tx.wait();
  log(`beam grade ${"ABCD"[r.beam.grade]} score ${r.beam.score} · LZ fee ${ethers.formatEther(fee)} · ${tx.hash}`);
  await until("beam on Arbitrum", async () => (await api<{ chainId: number }[]>(`/api/indexer/lighthouse?account=${signer.address}`)).some((b) => b.chainId === CHAINS.arbitrumSepolia.chainId), 600_000);
  log("beam landed on Arbitrum");
}

if (STEP === "badge") {
  const { offers } = await api<{ offers: { kind: number; eligible: boolean; deadline: number; signature: string | null }[] }>(`/api/keeper/arena?account=${signer.address}`);
  const badge = await ethers.getContractAt("OmnitideBadge", hub.OmnitideBadge!.proxy);
  let sendId: bigint | null = null;
  for (const o of offers.filter((x) => x.eligible)) {
    if (await badge.claimed(signer.address, o.kind)) continue;
    const tx = await badge.claim(o.kind, o.deadline, o.signature!);
    const rc = await tx.wait();
    const ev = rc!.logs.map((l) => badge.interface.parseLog(l)).find((p) => p?.name === "BadgeClaimed");
    sendId ??= ev!.args.tokenId as bigint;
    log(`claimed kind ${o.kind} → token ${ev!.args.tokenId} · ${tx.hash}`);
  }
  if (sendId !== null) {
    const fee = await badge.quoteSend(CHAINS.arbitrumSepolia.eid, signer.address, sendId);
    const tx = await badge.send(CHAINS.arbitrumSepolia.eid, signer.address, sendId, { value: fee });
    await tx.wait();
    log(`badge ${sendId} → Arbitrum · fee ${ethers.formatEther(fee)} · ${tx.hash}`);
  }
}

async function stake(amount: bigint) {
  const tide = await ethers.getContractAt("OmnitideToken", all[key]!.OmnitideToken!.proxy);
  const council = await ethers.getContractAt("OmnitideCouncil", all[key]!.OmnitideCouncil!.proxy);
  if ((await tide.balanceOf(signer.address)) < amount) await (await tide.drip()).wait();
  await (await tide.approve(await council.getAddress(), amount)).wait();
  const tx = await council.stake(amount);
  await tx.wait();
  log(`staked ${ethers.formatEther(amount)} TIDE on ${key} · ${tx.hash}`);
  return council;
}

if (STEP === "council-arb") await stake(ethers.parseEther("500"));

if (STEP === "council") {
  const council = await stake(ethers.parseEther("1000"));
  await new Promise((r) => setTimeout(r, 3_000)); // stake must be strictly older than the proposal
  const eids = [CHAINS.arbitrumSepolia.eid];
  const fee = await council.quotePropose(eids);
  const tx = await council.propose("Add DOGE-PERP to the book", "List DOGE-USD at 5× with a $50k open-interest cap.", eids, { value: (fee * 11n) / 10n });
  await tx.wait();
  log(`proposal ${await council.proposalCount()} · ${tx.hash}`);
  const v = await council.castVote(await council.proposalCount(), 1);
  await v.wait();
  log(`hub vote For · ${v.hash}`);
}

if (STEP === "vote-arb") {
  const council = await ethers.getContractAt("OmnitideCouncil", all[key]!.OmnitideCouncil!.proxy);
  const pid = BigInt(process.env.PROPOSAL ?? "1");
  await until("proposal mirrored to Arbitrum", async () => ((await council.proposals(pid)).start > 0n ? true : null), 600_000);
  const fee = await council.quoteVote(pid, 0, signer.address);
  const tx = await council.castVote(pid, 0, { value: (fee * 11n) / 10n });
  await tx.wait();
  log(`Arbitrum vote Against · fee ${ethers.formatEther(fee)} · ${tx.hash}`);
}

if (STEP === "copy") {
  const factory = await ethers.getContractAt("OmnitideCopyVaultFactory", hub.OmnitideCopyVaultFactory!.proxy);
  const t = await tdusd();
  let vault = process.env.VAULT;
  if (!vault) {
    await (await t.approve(await factory.getAddress(), usd(100))).wait();
    const tx = await factory.createVault("Riptide Capital", "cRIPTD", usd(100), []);
    await tx.wait();
    vault = await factory.vaults((await factory.vaultCount()) - 1n);
    log(`vault ${vault} · ${tx.hash}`);
  }
  const v = await ethers.getContractAt("OmnitideCopyVault", vault);
  const prices = await api<{ prices: { feed: string; price: string }[] }>("/api/prices");
  const px = Number(prices.prices.find((p) => p.feed === "BTC-USD")!.price);
  const tr = await v.trade(0, BigInt(Math.round((150 / px) * 1e12)) * 10n ** 6n, BigInt(Math.round(px * 1.02 * 1e8)) * 10n ** 10n, await reportsFor(vault, "BTC-USD"));
  await tr.wait();
  log(`leader long BTC $150 · ${tr.hash}`);
  await (await t.approve(vault, usd(25))).wait();
  const dep = await v.deposit(usd(25), signer.address, await reportsFor(vault));
  await dep.wait();
  log(`follow 25 tdUSD · ${dep.hash}`);
  const red = await v.redeem(usd(10), CHAINS.robinhoodTestnet.eid, signer.address, await reportsFor(vault));
  await red.wait();
  log(`redeem 10 shares · ${red.hash}`);
}

if (STEP === "copy-arb") {
  const vault = process.env.VAULT!;
  const t = await tdusd();
  const p = { dstEid: CHAINS.robinhoodTestnet.eid, to: ethers.zeroPadValue(vault, 32), amountLD: usd(15), minAmountLD: usd(15), extraOptions: "0x", composeMsg: ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signer.address]), oftCmd: "0x" };
  const q = await t.quoteSend(p, false);
  const tx = await t.send(p, { nativeFee: q.nativeFee, lzTokenFee: 0n }, signer.address, { value: q.nativeFee });
  await tx.wait();
  log(`omnichain follow 15 tdUSD from Arbitrum · fee ${ethers.formatEther(q.nativeFee)} · ${tx.hash}`);
  await until("keeper settle", async () => {
    const d = await api<{ flows: { kind: string; eid: number }[] }>(`/api/indexer/vaults/${vault.toLowerCase()}`);
    return d.flows.some((f) => f.kind === "deposit" && f.eid === 0) ? true : null;
  }, 900_000);
  log("queued deposit settled by the keeper");
}
