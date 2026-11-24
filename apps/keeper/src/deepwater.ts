import { z } from "zod";
import {
  concat,
  getAddress,
  keccak256,
  parseEventLogs,
  recoverTypedDataAddress,
  toHex,
  verifyMessage,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import type { createDb } from "@omnitide/db";
import { omnitideClearinghouseAbi, omnitideCopyVaultAbi, omnitideDeepPoolAbi } from "@omnitide/contracts/abi";
import {
  BADGES,
  BEAM_TYPES,
  CLAIM_TYPES,
  DEEP_INTENT_TYPES,
  DEEP_WITHDRAWAL_TYPES,
  applyFill,
  bookMargin,
  deepCommitment,
  deepId,
  deepIntentDomain,
  emptyBook,
  lighthouseMessage,
  open,
  seal,
  tradeFee,
  x25519Public,
  type DeepBook,
  type SealedOrderPlain,
} from "@omnitide/contracts/deep";
import { MARKETS } from "@omnitide/contracts/markets";
import { SCENARIOS, bookRank, radar, stressAccount } from "@omnitide/contracts/risk";
import type { Pos } from "@omnitide/contracts/margin";
import type { Env } from "./env.js";
import type { SignedReport } from "./reports.js";

type Db = ReturnType<typeof createDb>;
const LOG_CHUNK = 20_000n;
const SEAL_BATCH = 20;
const GRADES = ["A", "B", "C", "D"] as const;
const PARAMS = Object.fromEntries(MARKETS.map((m) => [m.id, m]));
const lower = (a: string) => a.toLowerCase();

export interface DeepWaterDeps {
  env: Env;
  db: Db;
  hub: PublicClient<Transport, Chain>;
  wallet: WalletClient<Transport, Chain, Account>;
  keeperKey: Hex;
  hubEid: number;
  clearinghouse: Address;
  pool: Address;
  poolBlock: bigint;
  badge: Address;
  lighthouses: Record<number, Address>; // chainId → OmnitideLighthouse
  reports: (feeds: string[]) => Promise<SignedReport[]>;
  priceOf: (feed: string) => number | undefined;
  log: (m: string) => void;
}

const reportArgs = (rs: SignedReport[]) => rs.map((r) => ({ feed: r.feed, price: BigInt(r.price), timestamp: BigInt(r.timestamp), signature: r.signature }));

/** V3 Deep Water: the sealed ledger behind Deep Mode, Sealed Order fills, Lighthouse and Arena attestations, copy-vault settlement. */
export function createDeepWater(d: DeepWaterDeps) {
  const { db, hub, wallet, log } = d;
  // a dedicated x25519 key, derived so it needs no extra secret on the VPS
  const deepSecret = keccak256(concat([d.keeperKey, toHex("omnitide-deep-keeper")]));
  const keeperPublic = x25519Public(deepSecret);
  const chainId = hub.chain.id;

  // keeper writes go one at a time so the deep pool never races its own nonce
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T,>(fn: () => Promise<T>) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  const ch = <T,>(functionName: string, args: unknown[]) =>
    hub.readContract({ address: d.clearinghouse, abi: omnitideClearinghouseAbi, functionName: functionName as never, args: args as never }) as Promise<T>;

  async function openMarketsOf(account: Address) {
    return (await ch<readonly number[]>("openMarkets", [account])).map(Number);
  }

  async function reportsFor(marketIds: number[]) {
    const feeds = [...new Set(marketIds.map((id) => MARKETS[id]!.feed))];
    return feeds.length ? d.reports(feeds) : [];
  }

  async function send(fn: () => Promise<Hex>) {
    return serial(async () => {
      const hash = await fn();
      const receipt = await hub.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`tx reverted ${hash}`);
      return receipt;
    });
  }

  const pricesWad = (rs: SignedReport[]) => {
    const byFeed = new Map(rs.map((r) => [r.feed, BigInt(r.price)]));
    return Object.fromEntries(MARKETS.flatMap((m) => {
      const p = byFeed.get(toHex(m.feed, { size: 32 }));
      return p ? [[m.id, p]] : [];
    })) as Record<number, bigint>;
  };

  const loadBook = (row: { book: unknown }) => row.book as unknown as DeepBook;
  const saveBook = (id: string, book: DeepBook, extra: Record<string, unknown> = {}) =>
    db.deepBook.update({ where: { id }, data: { book: book as never, dirty: true, ...extra } });

  // ───────── registration ─────────

  const Register = z.object({
    owner: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    id: z.string().regex(/^0x[0-9a-f]{64}$/),
    salt: z.string().regex(/^0x[0-9a-f]{64}$/),
    viewKey: z.string().regex(/^0x[0-9a-f]{64}$/),
    signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  });

  async function register(raw: unknown) {
    const r = Register.parse(raw);
    const owner = getAddress(r.owner);
    if (deepId(owner, r.salt as Hex) !== r.id) return { status: 400, body: { error: "id does not match owner and salt" } };
    const signer = await recoverTypedDataAddress({ domain: deepIntentDomain(chainId), types: DEEP_INTENT_TYPES, primaryType: "DeepRegister", message: { id: r.id as Hex, salt: r.salt as Hex, viewKey: r.viewKey as Hex }, signature: r.signature as Hex });
    if (signer !== owner) return { status: 401, body: { error: "signature is not from the owner" } };
    const existing = await db.deepBook.findUnique({ where: { id: r.id } });
    if (existing?.owner && existing.owner !== lower(owner)) return { status: 409, body: { error: "id already registered" } };
    await db.deepBook.upsert({
      where: { id: r.id },
      create: { id: r.id, owner: lower(owner), salt: r.salt, viewKey: r.viewKey, book: emptyBook(r.id as Hex) as never, dirty: true },
      update: { owner: lower(owner), salt: r.salt, viewKey: r.viewKey, dirty: true },
    });
    return { status: 200, body: { ok: true, keeperKey: keeperPublic } };
  }

  // ───────── deposits from chain ─────────

  async function cursor(name: string, from: bigint) {
    return (await db.cursor.findUnique({ where: { name } }))?.block ?? from;
  }

  async function syncDeposits() {
    const head = await hub.getBlockNumber();
    let from = await cursor("deep-deposits", d.poolBlock);
    let credited = 0;
    while (from <= head) {
      const to = from + LOG_CHUNK - 1n < head ? from + LOG_CHUNK - 1n : head;
      const logs = parseEventLogs({ abi: omnitideDeepPoolAbi, eventName: ["DeepDeposit", "Exited"], logs: await hub.getLogs({ address: d.pool, fromBlock: from, toBlock: to }) });
      for (const l of logs) {
        const key = `${l.transactionHash}:${l.logIndex}`;
        const id = l.args.id.toLowerCase();
        const at = Math.floor(Date.now() / 1000);
        await db.$transaction(async (tx) => {
          if (await tx.appliedEvent.findUnique({ where: { key } })) return;
          const row = await tx.deepBook.findUnique({ where: { id } });
          const book = row ? loadBook(row) : emptyBook(id as Hex);
          // the escape hatch paid out the whole flat book without us
          const exited = l.eventName === "Exited";
          const next: DeepBook = {
            ...book,
            collateral: exited ? "0" : (BigInt(book.collateral) + l.args.amount).toString(),
            updatedAt: at,
            history: [{ at, kind: exited ? ("withdraw" as const) : ("deposit" as const), amount: l.args.amount.toString(), tx: l.transactionHash }, ...book.history].slice(0, 100),
          };
          await tx.deepBook.upsert({ where: { id }, create: { id, book: next as never, dirty: true }, update: { book: next as never, dirty: true } });
          await tx.appliedEvent.create({ data: { key } });
          credited++;
        });
      }
      from = to + 1n;
      await db.cursor.upsert({ where: { name: "deep-deposits" }, create: { name: "deep-deposits", block: from }, update: { block: from } });
    }
    return { deepCredited: credited };
  }

  // ───────── intents ─────────

  const Trade = z.object({
    id: z.string().regex(/^0x[0-9a-f]{64}$/),
    marketId: z.number().int().min(0).max(MARKETS.length - 1),
    sizeDelta: z.string().regex(/^-?\d+$/),
    priceLimit: z.string().regex(/^\d+$/),
    nonce: z.number().int().positive(),
    deadline: z.number().int().positive(),
    signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  });

  async function trade(raw: unknown) {
    const t = Trade.parse(raw);
    const sizeDelta = BigInt(t.sizeDelta);
    const priceLimit = BigInt(t.priceLimit);
    if (sizeDelta === 0n) return { status: 400, body: { error: "size is zero" } };
    if (t.deadline < Date.now() / 1000) return { status: 400, body: { error: "intent expired" } };
    const signer = await recoverTypedDataAddress({
      domain: deepIntentDomain(chainId),
      types: DEEP_INTENT_TYPES,
      primaryType: "DeepTrade",
      message: { id: t.id as Hex, marketId: t.marketId, sizeDelta, priceLimit, nonce: BigInt(t.nonce), deadline: BigInt(t.deadline) },
      signature: t.signature as Hex,
    });
    return serialBook(t.id, async (row) => {
      if (row.owner !== lower(signer)) return { status: 401, body: { error: "not the owner of this Deep book" } };
      if (t.nonce <= row.intentNonce) return { status: 409, body: { error: "intent already used" } };
      const book = loadBook(row);
      const poolOpen = await openMarketsOf(d.pool);
      const cap = Number(await ch<number>("positionCap", [d.pool])) || 8;
      if (!poolOpen.includes(t.marketId) && poolOpen.length >= cap) return { status: 409, body: { error: `the Deep pool already holds ${cap} markets; pick an open one` } };
      const rs = await reportsFor([...poolOpen, t.marketId, ...book.positions.map((p) => p.marketId)]);
      const prices = pricesWad(rs);
      const price = prices[t.marketId]!;
      if (sizeDelta > 0n ? price > priceLimit : price < priceLimit) return { status: 409, body: { error: "price moved past your limit" } };
      const feeBps = BigInt(await ch<number>("feeBps", []));
      const before = BigInt(book.positions.find((p) => p.marketId === t.marketId)?.size ?? "0");
      const after = before + sizeDelta;
      const increases = after !== 0n && (before === 0n || (after > 0n) !== (before > 0n) || (after < 0n ? -after : after) > (before < 0n ? -before : before));
      const { book: next } = applyFill(book, t.marketId, sizeDelta, price, tradeFee(sizeDelta, price, feeBps), Math.floor(Date.now() / 1000));
      if (increases) {
        const m = bookMargin(next, prices, PARAMS);
        if (m.equity < m.im) return { status: 409, body: { error: "not enough Deep collateral for this size" } };
      }
      const receipt = await send(() =>
        wallet.writeContract({ address: d.pool, abi: omnitideDeepPoolAbi, functionName: "trade", args: [t.marketId, sizeDelta, priceLimit, reportArgs(rs)], chain: wallet.chain, account: wallet.account }),
      );
      next.history[0] = { ...next.history[0]!, tx: receipt.transactionHash };
      await saveBook(t.id, next, { intentNonce: t.nonce });
      return { status: 200, body: { ok: true, tx: receipt.transactionHash } };
    });
  }

  const Withdraw = z.object({
    w: z.object({
      owner: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      salt: z.string().regex(/^0x[0-9a-f]{64}$/),
      amount: z.string().regex(/^\d+$/),
      dstEid: z.number().int(),
      receiver: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      deadline: z.number().int(),
    }),
    signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  });

  async function withdraw(raw: unknown) {
    const { w, signature } = Withdraw.parse(raw);
    const owner = getAddress(w.owner);
    const id = deepId(owner, w.salt as Hex);
    const amount = BigInt(w.amount);
    if (w.dstEid !== d.hubEid) return { status: 400, body: { error: "Deep withdrawals land on Robinhood Chain; Ebb onward from there" } };
    const message = { salt: w.salt as Hex, amount, dstEid: w.dstEid, receiver: getAddress(w.receiver), deadline: BigInt(w.deadline) };
    const signer = await recoverTypedDataAddress({ domain: { name: "OMNITIDE Deep Pool", version: "1", chainId, verifyingContract: d.pool }, types: DEEP_WITHDRAWAL_TYPES, primaryType: "DeepWithdrawal", message, signature: signature as Hex });
    if (signer !== owner) return { status: 401, body: { error: "signature is not from the owner" } };
    return serialBook(id, async (row) => {
      if (row.owner !== lower(owner) || !row.viewKey) return { status: 401, body: { error: "unknown Deep book" } };
      const book = loadBook(row);
      if (amount === 0n || amount > BigInt(book.collateral)) return { status: 409, body: { error: "more than this Deep book holds" } };
      const poolOpen = await openMarketsOf(d.pool);
      const rs = await reportsFor([...poolOpen, ...book.positions.map((p) => p.marketId)]);
      const at = Math.floor(Date.now() / 1000);
      const [, nonce] = await hub.readContract({ address: d.pool, abi: omnitideDeepPoolAbi, functionName: "notes", args: [id] });
      const next: DeepBook = {
        ...book,
        nonce: Number(nonce) + 1,
        collateral: (BigInt(book.collateral) - amount).toString(),
        updatedAt: at,
        history: [{ at, kind: "withdraw" as const, amount: amount.toString() }, ...book.history].slice(0, 100),
      };
      if (next.positions.length) {
        const m = bookMargin(next, pricesWad(rs), PARAMS);
        if (m.equity < m.im) return { status: 409, body: { error: "that would leave open positions under-margined" } };
      }
      const receipt = await send(() =>
        wallet.writeContract({
          address: d.pool,
          abi: omnitideDeepPoolAbi,
          functionName: "withdraw",
          args: [{ ...message, owner, amount, dstEid: w.dstEid }, signature as Hex, reportArgs(rs), deepCommitment(next), seal([row.viewKey as Hex, keeperPublic], JSON.stringify(next))],
          chain: wallet.chain,
          account: wallet.account,
        }),
      );
      next.history[0] = { ...next.history[0]!, tx: receipt.transactionHash };
      await db.deepBook.update({ where: { id }, data: { book: next as never, dirty: false } });
      return { status: 200, body: { ok: true, tx: receipt.transactionHash } };
    });
  }

  // one book at a time: a trade and a withdrawal for the same id never interleave
  const locks = new Map<string, Promise<unknown>>();
  async function serialBook(id: string, fn: (row: NonNullable<Awaited<ReturnType<typeof db.deepBook.findUnique>>>) => Promise<{ status: number; body: object }>): Promise<{ status: number; body: object }> {
    const prev = locks.get(id) ?? Promise.resolve();
    const run = prev.then(async () => {
      const row = await db.deepBook.findUnique({ where: { id } });
      if (!row) return { status: 404, body: { error: "unknown Deep book" } };
      return fn(row);
    });
    locks.set(id, run.catch(() => undefined));
    return run;
  }

  // ───────── sealing and Deep liquidations ─────────

  async function sealDirty() {
    const rows = await db.deepBook.findMany({ where: { dirty: true, viewKey: { not: null } }, take: SEAL_BATCH, orderBy: { updatedAt: "asc" } });
    if (!rows.length) return { deepSealed: 0 };
    const sealed = await Promise.all(
      rows.map(async (row) => {
        const [, nonce] = await hub.readContract({ address: d.pool, abi: omnitideDeepPoolAbi, functionName: "notes", args: [row.id as Hex] });
        const book: DeepBook = { ...loadBook(row), nonce: Number(nonce) + 1 };
        return { id: row.id as Hex, book, commitment: deepCommitment(book), box: seal([row.viewKey as Hex, keeperPublic], JSON.stringify(book)), stamp: row.updatedAt };
      }),
    );
    await send(() =>
      wallet.writeContract({ address: d.pool, abi: omnitideDeepPoolAbi, functionName: "seal", args: [sealed.map((s) => s.id), sealed.map((s) => s.commitment), sealed.map((s) => s.box)], chain: wallet.chain, account: wallet.account }),
    );
    // a book touched again while we sealed stays dirty for the next round
    for (const s of sealed) await db.deepBook.updateMany({ where: { id: s.id, updatedAt: s.stamp }, data: { book: s.book as never, dirty: false } });
    return { deepSealed: sealed.length };
  }

  async function liquidateDeep() {
    const rows = await db.deepBook.findMany({ where: { owner: { not: null } } });
    let liquidated = 0;
    for (const row of rows) {
      const book = loadBook(row);
      if (!book.positions.length) continue;
      const prices = Object.fromEntries(book.positions.map((p) => [p.marketId, d.priceOf(MARKETS[p.marketId]!.feed)]));
      if (Object.values(prices).some((p) => p === undefined)) continue;
      const m = bookMargin(book, Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, BigInt(Math.round(v! * 1e6)) * 10n ** 12n])), PARAMS);
      if (m.equity >= m.mm) continue;
      await serialBook(row.id, async (fresh) => {
        let b = loadBook(fresh);
        const poolOpen = await openMarketsOf(d.pool);
        const rs = await reportsFor(poolOpen);
        const px = pricesWad(rs);
        const check = bookMargin(b, px, PARAMS);
        if (check.equity >= check.mm) return { status: 200, body: { ok: true } };
        const feeBps = BigInt(await ch<number>("feeBps", []));
        let notional = 0n;
        for (const p of [...b.positions]) {
          const delta = -BigInt(p.size);
          const price = px[p.marketId]!;
          const receipt = await send(() =>
            wallet.writeContract({ address: d.pool, abi: omnitideDeepPoolAbi, functionName: "trade", args: [p.marketId, delta, delta > 0n ? price * 2n : 0n, reportArgs(rs)], chain: wallet.chain, account: wallet.account }),
          );
          notional += ((delta < 0n ? -delta : delta) * price) / 10n ** 18n;
          b = applyFill(b, p.marketId, delta, price, tradeFee(delta, price, feeBps), Math.floor(Date.now() / 1000), receipt.transactionHash).book;
        }
        // same 1% penalty as a public liquidation; it stays in the pool account
        const penalty = notional / 100n / 10n ** 12n;
        const collateral = BigInt(b.collateral) > penalty ? BigInt(b.collateral) - penalty : 0n;
        b = { ...b, collateral: collateral.toString(), history: [{ at: Math.floor(Date.now() / 1000), kind: "liquidation" as const, amount: penalty.toString() }, ...b.history].slice(0, 100) };
        await saveBook(row.id, b);
        liquidated++;
        log(`deep book ${row.id.slice(0, 10)}… liquidated`);
        return { status: 200, body: { ok: true } };
      });
    }
    return { deepLiquidated: liquidated };
  }

  // ───────── Sealed Orders ─────────

  const sealedBook = new Map<bigint, { account: Address; plain: SealedOrderPlain }>();
  let sealedCursor = d.poolBlock;

  async function syncSealed() {
    const head = await hub.getBlockNumber();
    while (sealedCursor <= head) {
      const to = sealedCursor + LOG_CHUNK - 1n < head ? sealedCursor + LOG_CHUNK - 1n : head;
      const logs = parseEventLogs({ abi: omnitideClearinghouseAbi, logs: await hub.getLogs({ address: d.clearinghouse, fromBlock: sealedCursor, toBlock: to }) });
      for (const l of logs) {
        if (l.eventName === "SealedOrderPlaced") {
          const text = open(deepSecret, l.args.ciphertext);
          const plain = text ? (JSON.parse(text) as SealedOrderPlain) : null;
          if (plain) sealedBook.set(l.args.id, { account: l.args.account, plain });
          else log(`sealed order ${l.args.id} not readable by the keeper`);
        } else if (l.eventName === "SealedOrderCancelled" || l.eventName === "SealedOrderExecuted") {
          sealedBook.delete(l.args.id);
        }
      }
      sealedCursor = to + 1n;
    }
  }

  async function fillSealed() {
    await syncSealed();
    let filled = 0;
    for (const [id, o] of sealedBook) {
      const m = MARKETS[o.plain.marketId];
      const px = m && d.priceOf(m.feed);
      if (!px) continue;
      const trigger = Number(BigInt(o.plain.triggerPrice)) / 1e18;
      const buy = BigInt(o.plain.sizeDelta) > 0n;
      const met = o.plain.kind === 1 ? (buy ? px >= trigger : px <= trigger) : buy ? px <= trigger : px >= trigger;
      if (!met) continue;
      try {
        const rs = await reportsFor([...(await openMarketsOf(o.account)), o.plain.marketId]);
        await send(() =>
          wallet.writeContract({
            address: d.clearinghouse,
            abi: omnitideClearinghouseAbi,
            functionName: "executeSealedOrder",
            args: [id, o.plain.marketId, o.plain.kind, BigInt(o.plain.sizeDelta), BigInt(o.plain.triggerPrice), o.plain.salt, reportArgs(rs)],
            chain: wallet.chain,
            account: wallet.account,
          }),
        );
        sealedBook.delete(id);
        filled++;
      } catch (e) {
        log(`sealed order ${id}: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    return { sealedOpen: sealedBook.size, sealedFilled: filled };
  }

  // ───────── Lighthouse and Arena attestations ─────────

  async function publicPositions(account: Address) {
    const open = await openMarketsOf(account);
    const [bal, positions] = await Promise.all([
      ch<bigint>("balances", [account]),
      Promise.all(open.map(async (id) => {
        const [size, entry] = await ch<readonly [bigint, bigint]>("positions", [account, id]);
        return { marketId: id, size: Number(size) / 1e18, entry: Number(entry) / 1e18 };
      })),
    ]);
    return { collateral: Number(bal) / 1e6, positions };
  }

  async function combinedBook(account: Address) {
    const pub = await publicPositions(account);
    const deep = await db.deepBook.findFirst({ where: { owner: lower(account) } });
    const book = deep ? loadBook(deep) : null;
    const positions: Pos[] = [
      ...pub.positions,
      ...(book?.positions ?? []).map((p) => ({ marketId: p.marketId, size: Number(BigInt(p.size)) / 1e18, entry: Number(BigInt(p.entry)) / 1e18 })),
    ];
    return { collateral: pub.collateral + (book ? Number(book.collateral) / 1e6 : 0), positions, deep: !!book && BigInt(book.collateral) > 0n };
  }

  const priceMap = () => Object.fromEntries(MARKETS.flatMap((m) => (d.priceOf(m.feed) ? [[m.feed, d.priceOf(m.feed)!]] : [])));

  const LighthouseReq = z.object({ account: z.string().regex(/^0x[0-9a-fA-F]{40}$/), chainId: z.number().int(), issuedAt: z.string(), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) });

  async function attestBeam(raw: unknown) {
    const r = LighthouseReq.parse(raw);
    const lighthouse = d.lighthouses[r.chainId];
    if (!lighthouse) return { status: 400, body: { error: "no Lighthouse on that chain" } };
    if (Math.abs(Date.now() - Date.parse(r.issuedAt)) > 10 * 60_000) return { status: 400, body: { error: "request expired, sign again" } };
    const account = getAddress(r.account);
    if (!(await verifyMessage({ address: account, message: lighthouseMessage(account, r.chainId, r.issuedAt), signature: r.signature as Hex })))
      return { status: 401, body: { error: "signature is not from this account" } };
    const book = await combinedBook(account);
    if (!book.positions.length) return { status: 409, body: { error: "open a position first; a flat book has nothing to score" } };
    const prices = priceMap();
    const rank = bookRank(radar(book.collateral, book.positions, prices), SCENARIOS.map((s) => !stressAccount(book.collateral, book.positions, prices, s).liquidated));
    const now = Math.floor(Date.now() / 1000);
    const beam = { account, score: Math.round(rank.score), grade: GRADES.indexOf(rank.grade as (typeof GRADES)[number]), issuedAt: BigInt(now), expiry: BigInt(now + 7 * 86_400) };
    const signature = await wallet.account.signTypedData!({ domain: { name: "OMNITIDE Lighthouse", version: "1", chainId: r.chainId, verifyingContract: lighthouse }, types: BEAM_TYPES, primaryType: "Beam", message: beam });
    return { status: 200, body: { beam: { ...beam, issuedAt: now, expiry: now + 7 * 86_400 }, signature } };
  }

  async function badgeOffers(account: Address) {
    const res = await fetch(`${d.env.INDEXER_URL}/eligibility?account=${lower(account)}`);
    if (!res.ok) throw new Error(`indexer /eligibility ${res.status}`);
    const e = z.object({ trades: z.number(), inflows: z.number(), harbor: z.number(), votes: z.number(), beams: z.number() }).parse(await res.json());
    const book = await combinedBook(account);
    const prices = priceMap();
    const open = book.positions.length > 0;
    const rank = open ? bookRank(radar(book.collateral, book.positions, prices), SCENARIOS.map((s) => !stressAccount(book.collateral, book.positions, prices, s).liquidated)) : null;
    const swan = SCENARIOS.find((s) => s.id === "swan")!;
    const eligible = [
      e.trades > 0,
      e.inflows > 0,
      e.harbor > 0,
      rank?.grade === "A",
      open && !stressAccount(book.collateral, book.positions, prices, swan).liquidated,
      book.deep,
      e.votes > 0,
      e.beams > 0,
    ];
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3_600);
    return Promise.all(
      BADGES.map(async (b) => ({
        kind: b.kind,
        eligible: eligible[b.kind]!,
        deadline: Number(deadline),
        signature: eligible[b.kind]
          ? await wallet.account.signTypedData!({ domain: { name: "OMNITIDE Arena", version: "1", chainId, verifyingContract: d.badge }, types: CLAIM_TYPES, primaryType: "Claim", message: { to: account, kind: b.kind, deadline } })
          : null,
      })),
    );
  }

  // ───────── copy vaults: price queued omnichain deposits ─────────

  async function settleCopy() {
    const res = await fetch(`${d.env.INDEXER_URL}/copy/pending`);
    if (!res.ok) throw new Error(`indexer /copy/pending ${res.status}`);
    const pending = z.array(z.object({ vault: z.string(), accounts: z.array(z.string()) })).parse(await res.json());
    let settled = 0;
    for (const p of pending) {
      const vault = getAddress(p.vault);
      const rs = await reportsFor(await openMarketsOf(vault));
      await send(() => wallet.writeContract({ address: vault, abi: omnitideCopyVaultAbi, functionName: "settle", args: [p.accounts.map((a) => getAddress(a)), reportArgs(rs)], chain: wallet.chain, account: wallet.account }));
      settled += p.accounts.length;
    }
    return { copySettled: settled };
  }

  async function status(id: string) {
    const row = await db.deepBook.findUnique({ where: { id: id.toLowerCase() } });
    return { registered: !!row?.owner, sealing: !!row?.dirty, intentNonce: row?.intentNonce ?? 0 };
  }

  return { keeperPublic, register, trade, withdraw, syncDeposits, sealDirty, liquidateDeep, fillSealed, attestBeam, badgeOffers, settleCopy, status };
}
