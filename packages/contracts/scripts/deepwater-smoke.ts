import { network } from "hardhat";
import { SCRIPT_CHAINS as CHAINS, type ChainKey } from "../chains.js";
import { MARKETS } from "../markets.js";
import { DEEP_INTENT_TYPES, DEEP_MESSAGE, DEEP_WITHDRAWAL_TYPES, deepCommitment, deepId, deepIntentDomain, deriveDeepKeys, lighthouseMessage, open, randomSalt, seal, sealedOrderCommitment, type DeepBook } from "../deep.js";
import { chainKeyById, deployerSigner, loadDeployments } from "./lib.js";

// Live V3 smoke against the deployed stack and the public site API (OMNITIDE_ENV=testnet|mainnet).
// STEP: deep | deep-wide | deep-arb | sealed | lighthouse | badge | gov-move | council-arb | council | vote-arb | copy | copy-arb
// Spoke steps (deep-arb, council-arb, vote-arb, copy-arb) run with --network on that spoke.
const STEP = process.env.STEP ?? "deep";
const MAINNET = !!process.env.OMNITIDE_ENV?.startsWith("mainnet");
const SITE = process.env.SITE ?? (MAINNET ? "https://omnitide.trade" : "https://testnet.omnitide.trade");
const S = MAINNET ? 0.1 : 1; // mainnet runs the same flows at a tenth of the size, under the per-market OI caps
const { ethers } = await network.create();
const signer = await deployerSigner(ethers);
const chainId = Number((await ethers.provider.getNetwork()).chainId);
const key = chainKeyById(chainId);
const all = loadDeployments();
const hubKey = (Object.keys(CHAINS) as ChainKey[]).find((k) => CHAINS[k].hub)!;
const hub = all[hubKey]!;
// spokes carrying the V3 OApps; TARGET narrows Lighthouse / badge / proposal sends to one of them
const spokes = (Object.keys(CHAINS) as ChainKey[]).filter((k) => !CHAINS[k].hub && all[k]?.OmnitideCouncil && (!process.env.TARGET || k === process.env.TARGET));
const firstSpoke = spokes[0]!;
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

/** tdUSD on this chain: testnet faucet, mainnet minted 1:1 through the stablecoin Port. */
async function tdusd(need: bigint) {
  const t = await ethers.getContractAt("OmnitideUSD", all[key]!.OmnitideUSD!.proxy);
  const have = await t.balanceOf(signer.address);
  if (have >= need) return t;
  if (!MAINNET) {
    await (await t.drip()).wait();
    return t;
  }
  const port = await ethers.getContractAt("OmnitidePort", all[key]!.OmnitidePort!.proxy);
  const stable = await ethers.getContractAt("OmnitideUSD", CHAINS[key].stable!.address); // any ERC-20 surface
  const mint = need - have;
  await (await stable.approve(await port.getAddress(), mint)).wait();
  const tx = await port.deposit(mint, signer.address);
  await tx.wait();
  log(`minted ${Number(mint) / 1e6} tdUSD from ${CHAINS[key].stable!.symbol} · ${tx.hash}`);
  return t;
}

async function px(feed: string) {
  return Number((await api<{ prices: { feed: string; price: string }[] }>("/api/prices")).prices.find((p) => p.feed === feed)!.price);
}
const sizeFor = (dollars: number, price: number) => BigInt(Math.round((dollars / price) * 1e12)) * 10n ** 6n;
const limitFor = (price: number, up: boolean) => BigInt(Math.round(price * (up ? 1.02 : 0.98) * 1e8)) * 10n ** 10n;

async function intent(marketId: number, sizeDelta: bigint, price: number) {
  const { intentNonce } = await api<{ intentNonce: number }>(`/api/keeper/deep/status?id=${id}`);
  const msg = { id, marketId, sizeDelta, priceLimit: limitFor(price, sizeDelta > 0n), nonce: BigInt(intentNonce + 1), deadline: BigInt(Math.floor(Date.now() / 1000) + 120) };
  const signature = await signer.signTypedData(deepIntentDomain(chainId), { DeepTrade: [...DEEP_INTENT_TYPES.DeepTrade] }, msg);
  return api<{ tx: string }>("/api/keeper/deep/trade", { ...msg, nonce: Number(msg.nonce), deadline: Number(msg.deadline), signature });
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
  const want = usd(50 * S);
  if (!existing || BigInt(existing.collateral) < want) {
    const t = await tdusd(want);
    await (await t.approve(await pool.getAddress(), want)).wait();
    const dep = await pool.deposit(id, want);
    await dep.wait();
    log(`deposit ${50 * S} tdUSD · ${dep.hash}`);
  }
  const funded = await until("first seal", async () => {
    const b = await latestBook();
    return b && BigInt(b.collateral) >= want ? b : null;
  });
  log(`sealed + verified · collateral ${Number(funded.collateral) / 1e6}`);

  const btc = await px("BTC-USD");
  const size = sizeFor(100 * S, btc);
  log(`deep long BTC $${100 * S} · ${(await intent(0, size, btc)).tx}`);
  await until("position seal", async () => ((await latestBook())?.positions.length ? true : null));
  log("position sealed + verified");
  log(`deep close BTC · ${(await intent(0, -size, btc)).tx}`);
  const flat = await until("flat seal", async () => {
    const b = await latestBook();
    return b && b.positions.length === 0 && b.history.filter((h) => h.kind === "trade").length >= 2 ? b : null;
  });
  log(`flat · realized ${Number(flat.realized) / 1e6} · fees ${Number(flat.fees) / 1e6}`);

  const w = { owner: signer.address, salt: keys.salt, amount: usd(20 * S), dstEid: CHAINS[hubKey].eid, receiver: signer.address, deadline: BigInt(Math.floor(Date.now() / 1000) + 600) };
  const wsig = await signer.signTypedData({ name: "OMNITIDE Deep Pool", version: "1", chainId, verifyingContract: await pool.getAddress() }, { DeepWithdrawal: [...DEEP_WITHDRAWAL_TYPES.DeepWithdrawal] }, { salt: w.salt, amount: w.amount, dstEid: w.dstEid, receiver: w.receiver, deadline: w.deadline });
  log(`withdraw ${20 * S} tdUSD · ${(await api<{ tx: string }>("/api/keeper/deep/withdraw", { w: { ...w, deadline: Number(w.deadline) }, signature: wsig })).tx}`);
  const after = await until("withdraw seal", async () => {
    const b = await latestBook();
    return b && b.history[0]?.kind === "withdraw" ? b : null;
  });
  log(`after withdraw · collateral ${Number(after.collateral) / 1e6} · verified against chain`);
}

if (STEP === "deep-wide") {
  // more markets than one account may hold (8): the Deep pool's raised cap lets the book spread across nine
  const ch = await ethers.getContractAt("OmnitideClearinghouse", hub.OmnitideClearinghouse!.proxy);
  log(`pool cap ${await ch.positionCap(hub.OmnitideDeepPool!.proxy)} · pool holds ${((await ch.openMarkets(hub.OmnitideDeepPool!.proxy)) as bigint[]).length} markets`);
  const legs = MARKETS.slice(0, 9);
  const sizes: bigint[] = [];
  for (const m of legs) {
    const p = await px(m.feed);
    sizes.push(sizeFor(20 * S, p));
    log(`deep long ${m.symbol} $${20 * S} · ${(await intent(m.id, sizes.at(-1)!, p)).tx}`);
  }
  const held = ((await ch.openMarkets(hub.OmnitideDeepPool!.proxy)) as bigint[]).length;
  if (held < 9) throw new Error(`pool holds ${held} markets, expected ≥ 9`);
  log(`pool now holds ${held} markets on-chain`);
  await until("nine-leg seal", async () => ((await latestBook())?.positions.length === 9 ? true : null));
  log("nine positions sealed + verified");
  for (const [i, m] of legs.entries()) log(`deep close ${m.symbol} · ${(await intent(m.id, -sizes[i]!, await px(m.feed))).tx}`);
  await until("flat seal", async () => ((await latestBook())?.positions.length === 0 ? true : null));
  log("flat again, sealed + verified");
}

if (STEP === "deep-arb") {
  // private Inflow: tdUSD from a spoke lands in the Deep pool and lzCompose credits the Deep id, not a public account
  const before = BigInt((await latestBook())?.collateral ?? "0");
  const amount = usd(15 * S);
  const t = await tdusd(amount);
  const p = { dstEid: CHAINS[hubKey].eid, to: ethers.zeroPadValue(hub.OmnitideDeepPool!.proxy, 32), amountLD: amount, minAmountLD: amount, extraOptions: "0x", composeMsg: ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [id]), oftCmd: "0x" };
  const q = await t.quoteSend(p, false);
  const tx = await t.send(p, { nativeFee: q.nativeFee, lzTokenFee: 0n }, signer.address, { value: q.nativeFee });
  await tx.wait();
  log(`private Inflow ${15 * S} tdUSD from ${key} · fee ${ethers.formatEther(q.nativeFee)} · ${tx.hash}`);
  const b = await until("Deep credit sealed", async () => {
    const x = await latestBook();
    return x && BigInt(x.collateral) >= before + amount ? x : null;
  }, 900_000);
  log(`Deep book credited · collateral ${Number(b.collateral) / 1e6} · verified against chain`);
}

if (STEP === "sealed") {
  const ch = await ethers.getContractAt("OmnitideClearinghouse", hub.OmnitideClearinghouse!.proxy);
  if ((await ch.balances(signer.address)) < usd(20 * S)) {
    const t = await tdusd(usd(30 * S));
    await (await t.approve(await ch.getAddress(), usd(30 * S))).wait();
    await (await ch.deposit(usd(30 * S))).wait();
  }
  const eth = await px("ETH-USD");
  const size = sizeFor(60 * S, eth);
  const buy = await ch.trade(1, size, limitFor(eth, true), await reportsFor(signer.address, "ETH-USD"));
  await buy.wait();
  log(`public ETH long $${60 * S} · ${buy.hash}`);
  // stop-loss just above the mark: already triggered, so the keeper must decrypt and fill it
  const plain = { marketId: 1, kind: 1 as const, sizeDelta: (-size).toString(), triggerPrice: (BigInt(Math.round(eth * 1.01 * 1e8)) * 10n ** 10n).toString(), salt: randomSalt() };
  const { keeperKey } = await api<{ keeperKey: `0x${string}` }>("/api/keeper/deep/key");
  const sealedId = (await ch.nextSealedId()).toString();
  const placed = await ch.placeSealedOrder(sealedOrderCommitment(signer.address as `0x${string}`, plain), seal([keeperKey, keys.viewPublic], JSON.stringify(plain)));
  await placed.wait();
  log(`sealed stop placed · ${placed.hash}`);
  const filled = await until("sealed fill", async () => {
    const rows = await api<{ id: string; status: string; fillPrice: string | null }[]>(`/api/indexer/sealed?account=${signer.address}`);
    return rows.find((r) => r.id === sealedId && r.status === "filled") ?? null;
  });
  log(`sealed order #${filled.id} filled at ${Number(BigInt(filled.fillPrice!)) / 1e18}`);
}

if (STEP === "lighthouse") {
  const ch = await ethers.getContractAt("OmnitideClearinghouse", hub.OmnitideClearinghouse!.proxy);
  if (((await ch.openMarkets(signer.address)) as bigint[]).length === 0) {
    const btc = await px("BTC-USD");
    const tx = await ch.trade(0, sizeFor(40 * S, btc), limitFor(btc, true), await reportsFor(signer.address, "BTC-USD"));
    await tx.wait();
    log(`public BTC long $${40 * S} to score · ${tx.hash}`);
  }
  const issuedAt = new Date().toISOString();
  const signature = await signer.signMessage(lighthouseMessage(signer.address, chainId, issuedAt));
  const r = await api<{ beam: { account: string; score: number; grade: number; issuedAt: number; expiry: number }; signature: string }>("/api/keeper/lighthouse", { account: signer.address, chainId, issuedAt, signature });
  const lh = await ethers.getContractAt("OmnitideLighthouse", hub.OmnitideLighthouse!.proxy);
  const eids = spokes.map((k) => CHAINS[k].eid);
  const fee = await lh.quoteShine(r.beam, eids);
  const tx = await lh.shine(r.beam, r.signature, eids, { value: (fee * 11n) / 10n });
  await tx.wait();
  log(`beam grade ${"ABCD"[r.beam.grade]} score ${r.beam.score} · LZ fee ${ethers.formatEther(fee)} · ${tx.hash}`);
  for (const k of spokes) {
    await until(`beam on ${k}`, async () => (await api<{ chainId: number }[]>(`/api/indexer/lighthouse?account=${signer.address}`)).some((b) => b.chainId === CHAINS[k].chainId), 600_000);
    log(`beam landed on ${k}`);
  }
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
    const fee = await badge.quoteSend(CHAINS[firstSpoke].eid, signer.address, sendId);
    const tx = await badge.send(CHAINS[firstSpoke].eid, signer.address, sendId, { value: fee });
    await tx.wait();
    log(`badge ${sendId} → ${firstSpoke} · fee ${ethers.formatEther(fee)} · ${tx.hash}`);
  }
}

// governance token: TIDE (faucet) on testnet; on the mainnet hub the launched $OMNITIDE, wrapped by OmnitideTokenAdapter
const adapter = all[key]!.OmnitideTokenAdapter;
const GOV = adapter || MAINNET ? "OMNITIDE" : "TIDE";
const govToken = () => ethers.getContractAt("OmnitideToken", adapter?.token ?? all[key]!.OmnitideToken!.proxy);
const govOft = () => ethers.getContractAt("OmnitideToken", adapter?.proxy ?? all[key]!.OmnitideToken!.proxy);

async function stake(target: bigint) {
  const tide = await govToken();
  const council = await ethers.getContractAt("OmnitideCouncil", all[key]!.OmnitideCouncil!.proxy);
  const amount = target - (await council.staked(signer.address)); // top up to the target only
  if (amount <= 0n) {
    log(`already staked ≥ ${ethers.formatEther(target)} ${GOV} on ${key}`);
    return council;
  }
  if ((await tide.balanceOf(signer.address)) < amount) {
    if (MAINNET) throw new Error(`needs ${ethers.formatEther(amount)} ${GOV} on ${key}`);
    await (await tide.drip()).wait();
  }
  await (await tide.approve(await council.getAddress(), amount)).wait();
  const tx = await council.stake(amount);
  await tx.wait();
  log(`staked ${ethers.formatEther(amount)} ${GOV} on ${key} · ${tx.hash}`);
  return council;
}

if (STEP === "gov-move") {
  // one supply over LayerZero: lock on the hub adapter (mainnet) or burn the OFT (testnet), mint on the spoke
  const amount = ethers.parseEther(process.env.AMOUNT ?? "600");
  const token = await govToken();
  const oft = await govOft();
  if ((await token.balanceOf(signer.address)) < amount && !MAINNET) await (await token.drip()).wait();
  if (adapter) await (await token.approve(await oft.getAddress(), amount)).wait();
  for (const k of spokes) {
    const share = amount / BigInt(spokes.length);
    const p = { dstEid: CHAINS[k].eid, to: ethers.zeroPadValue(signer.address, 32), amountLD: share, minAmountLD: share, extraOptions: "0x", composeMsg: "0x", oftCmd: "0x" };
    const q = await oft.quoteSend(p, false);
    const tx = await oft.send(p, { nativeFee: q.nativeFee, lzTokenFee: 0n }, signer.address, { value: q.nativeFee });
    await tx.wait();
    log(`${ethers.formatEther(share)} ${GOV} → ${k} · fee ${ethers.formatEther(q.nativeFee)} · ${tx.hash}`);
  }
}

if (STEP === "council-arb") await stake(ethers.parseEther(process.env.AMOUNT ?? "500"));

if (STEP === "council") {
  const council = await stake(ethers.parseEther("1000"));
  await new Promise((r) => setTimeout(r, 3_000)); // stake must be strictly older than the proposal
  const eids = spokes.map((k) => CHAINS[k].eid);
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
  await until(`proposal mirrored to ${key}`, async () => ((await council.proposals(pid)).start > 0n ? true : null), 600_000);
  const fee = await council.quoteVote(pid, 0, signer.address);
  const tx = await council.castVote(pid, 0, { value: (fee * 11n) / 10n });
  await tx.wait();
  log(`${key} vote Against · fee ${ethers.formatEther(fee)} · ${tx.hash}`);
}

if (STEP === "copy") {
  const factory = await ethers.getContractAt("OmnitideCopyVaultFactory", hub.OmnitideCopyVaultFactory!.proxy);
  const seed = (await factory.minSeed()) > usd(100 * S) ? await factory.minSeed() : usd(100 * S);
  const t = await tdusd(seed + usd(25 * S));
  let vault = process.env.VAULT;
  if (!vault) {
    await (await t.approve(await factory.getAddress(), seed)).wait();
    const tx = await factory.createVault(MAINNET ? "Riptide Capital" : "Undertow Fund", MAINNET ? "cRIPTD" : "cUNDTW", 1_000, seed, []);
    await tx.wait();
    vault = await factory.vaults((await factory.vaultCount()) - 1n);
    log(`vault ${vault} · 10% fee above the high-water mark · ${tx.hash}`);
  }
  const v = await ethers.getContractAt("OmnitideCopyVault", vault);
  const btc = await px("BTC-USD");
  const tr = await v.trade(0, sizeFor(150 * S, btc), limitFor(btc, true), await reportsFor(vault, "BTC-USD"));
  await tr.wait();
  log(`leader long BTC $${150 * S} · ${tr.hash}`);
  await (await t.approve(vault, usd(25 * S))).wait();
  const dep = await v.deposit(usd(25 * S), signer.address, await reportsFor(vault));
  await dep.wait();
  log(`follow ${25 * S} tdUSD · ${dep.hash}`);
  const red = await v.redeem(usd(10 * S), CHAINS[hubKey].eid, signer.address, await reportsFor(vault));
  await red.wait();
  log(`redeem ${10 * S} shares · ${red.hash}`);
  log(`fee ${Number(await v.feeBps()) / 100}% · high-water mark ${ethers.formatEther(await v.highWaterMark())} per share`);
}

if (STEP === "copy-arb") {
  const vault = process.env.VAULT!;
  const t = await tdusd(usd(15 * S));
  const p = { dstEid: CHAINS[hubKey].eid, to: ethers.zeroPadValue(vault, 32), amountLD: usd(15 * S), minAmountLD: usd(15 * S), extraOptions: "0x", composeMsg: ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signer.address]), oftCmd: "0x" };
  const q = await t.quoteSend(p, false);
  const tx = await t.send(p, { nativeFee: q.nativeFee, lzTokenFee: 0n }, signer.address, { value: q.nativeFee });
  await tx.wait();
  log(`omnichain follow ${15 * S} tdUSD from ${key} · fee ${ethers.formatEther(q.nativeFee)} · ${tx.hash}`);
  await until("keeper settle", async () => {
    const d = await api<{ flows: { kind: string; eid: number }[] }>(`/api/indexer/vaults/${vault.toLowerCase()}`);
    return d.flows.some((f) => f.kind === "deposit" && f.eid === 0) ? true : null;
  }, 900_000);
  log("queued deposit settled by the keeper");
}
