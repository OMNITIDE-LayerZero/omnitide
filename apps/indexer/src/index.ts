import { and, eq } from "ponder";
import { zeroAddress, zeroHash } from "viem";
import { ponder } from "ponder:registry";
import {
  badge,
  beam,
  beamSent,
  bridge,
  copyFlow,
  copyPending,
  copyVault,
  deepNote,
  flow,
  harborFlow,
  lendingFlow,
  inletFlow,
  liquidation,
  market,
  order,
  position,
  proposal,
  sealedOrder,
  stake,
  stats,
  tideRead,
  trade,
  trader,
  vote,
} from "ponder:schema";

const HUB_EID = 40451;
const abs = (x: bigint) => (x < 0n ? -x : x);
const EMPTY_STATS = { id: "global", trades: 0, volumeUsd: 0n, feesPaid: 0n, inflows: 0, ebbs: 0, bridged: 0n, drips: 0, liquidations: 0 };

type Db = Parameters<Parameters<typeof ponder.on>[1]>[0]["context"]["db"];
async function bump(db: Db, patch: (s: typeof EMPTY_STATS) => Partial<typeof EMPTY_STATS>) {
  await db.insert(stats).values({ ...EMPTY_STATS, ...patch(EMPTY_STATS) }).onConflictDoUpdate((row) => patch(row as typeof EMPTY_STATS));
}

ponder.on("OmnitideUSD:OFTSent", async ({ event, context }) => {
  const { guid, dstEid, fromAddress, amountSentLD } = event.args;
  const sent = { srcChainId: context.chain.id, dstEid, from: fromAddress, amount: amountSentLD, sentAt: Number(event.block.timestamp), sentTx: event.transaction.hash };
  await context.db.insert(bridge).values({ guid, ...sent }).onConflictDoUpdate(sent);
  await bump(context.db, (s) => ({ bridged: s.bridged + amountSentLD }));
});

ponder.on("OmnitideUSD:OFTReceived", async ({ event, context }) => {
  const { guid, toAddress, amountReceivedLD } = event.args;
  const received = { dstChainId: context.chain.id, to: toAddress, receivedAt: Number(event.block.timestamp), receivedTx: event.transaction.hash };
  await context.db.insert(bridge).values({ guid, amount: amountReceivedLD, ...received }).onConflictDoUpdate(received);
});

ponder.on("OmnitideUSD:Dripped", async ({ context }) => {
  await bump(context.db, (s) => ({ drips: s.drips + 1 }));
});

ponder.on("OmnitideClearinghouse:MarketSet", async ({ event, context }) => {
  const a = event.args;
  const cfg = {
    feed: Buffer.from(a.feed.slice(2), "hex").toString("utf8").replace(/\0+$/, ""),
    initialMarginBps: a.initialMarginBps,
    maintenanceMarginBps: a.maintenanceMarginBps,
    maxOpenInterestUsd: a.maxOpenInterestUsd,
    active: a.active,
  };
  await context.db.insert(market).values({ id: a.id, volumeUsd: 0n, trades: 0, ...cfg }).onConflictDoUpdate(cfg);
});

ponder.on("OmnitideClearinghouse:Traded", async ({ event, context }) => {
  const a = event.args;
  const ts = Number(event.block.timestamp);
  const notionalUsd = (abs(a.sizeDelta) * a.price) / 10n ** 18n;
  await context.db.insert(trade).values({
    id: event.id,
    account: a.account,
    marketId: a.marketId,
    sizeDelta: a.sizeDelta,
    price: a.price,
    newSize: a.newSize,
    entryPrice: a.entryPrice,
    realizedPnl: a.realizedPnl,
    fee: a.fee,
    notionalUsd,
    viaOrder: false,
    timestamp: ts,
    tx: event.transaction.hash,
  });
  await context.db
    .insert(position)
    .values({ account: a.account, marketId: a.marketId, size: a.newSize, entryPrice: a.entryPrice, updatedAt: ts })
    .onConflictDoUpdate({ size: a.newSize, entryPrice: a.entryPrice, updatedAt: ts });
  await context.db.update(market, { id: a.marketId }).set((m) => ({ volumeUsd: m.volumeUsd + notionalUsd, trades: m.trades + 1 }));
  await context.db
    .insert(trader)
    .values({ account: a.account, trades: 1, volumeUsd: notionalUsd, realizedPnl: a.realizedPnl, fees: a.fee, firstSeen: ts, lastSeen: ts })
    .onConflictDoUpdate((t) => ({ trades: t.trades + 1, volumeUsd: t.volumeUsd + notionalUsd, realizedPnl: t.realizedPnl + a.realizedPnl, fees: t.fees + a.fee, lastSeen: ts }));
  await bump(context.db, (s) => ({ trades: s.trades + 1, volumeUsd: s.volumeUsd + notionalUsd, feesPaid: s.feesPaid + a.fee }));
});

ponder.on("OmnitideClearinghouse:OrderPlaced", async ({ event, context }) => {
  const a = event.args;
  await context.db.insert(order).values({
    id: a.id,
    account: a.account,
    marketId: a.marketId,
    kind: a.kind,
    sizeDelta: a.sizeDelta,
    triggerPrice: a.triggerPrice,
    reduceOnly: a.reduceOnly,
    status: "open",
    placedAt: Number(event.block.timestamp),
  });
});

ponder.on("OmnitideClearinghouse:OrderCancelled", async ({ event, context }) => {
  await context.db.update(order, { id: event.args.id }).set({ status: "cancelled", closedAt: Number(event.block.timestamp) });
});

ponder.on("OmnitideClearinghouse:OrderExecuted", async ({ event, context }) => {
  await context.db.update(order, { id: event.args.id }).set({ status: "filled", fillPrice: event.args.price, closedAt: Number(event.block.timestamp) });
  // the fill's Traded log shares this tx (one executeOrder per tx)
  await context.db.sql
    .update(trade)
    .set({ viaOrder: true })
    .where(and(eq(trade.tx, event.transaction.hash), eq(trade.account, event.args.account)));
});

ponder.on("OmnitideClearinghouse:Deposited", async ({ event, context }) => {
  const a = event.args;
  const inflow = a.srcEid !== HUB_EID;
  await context.db.insert(flow).values({
    id: event.id,
    account: a.account,
    kind: inflow ? "inflow" : "deposit",
    amount: a.amount,
    eid: a.srcEid,
    guid: inflow ? a.guid : null,
    timestamp: Number(event.block.timestamp),
    tx: event.transaction.hash,
  });
  if (inflow) await bump(context.db, (s) => ({ inflows: s.inflows + 1 }));
});

ponder.on("OmnitideClearinghouse:Withdrawn", async ({ event, context }) => {
  const a = event.args;
  const ebb = a.dstEid !== HUB_EID;
  await context.db.insert(flow).values({
    id: event.id,
    account: a.account,
    kind: ebb ? "ebb" : "withdraw",
    amount: a.amount,
    eid: a.dstEid,
    guid: ebb ? a.guid : null,
    timestamp: Number(event.block.timestamp),
    tx: event.transaction.hash,
  });
  if (ebb) await bump(context.db, (s) => ({ ebbs: s.ebbs + 1 }));
});

ponder.on("OmnitideClearinghouse:Liquidated", async ({ event, context }) => {
  const a = event.args;
  await context.db.insert(liquidation).values({
    id: event.id,
    account: a.account,
    liquidator: a.liquidator,
    notionalUsd: a.notional,
    penalty: a.penalty,
    badDebt: a.badDebt,
    timestamp: Number(event.block.timestamp),
    tx: event.transaction.hash,
  });
  await bump(context.db, (s) => ({ liquidations: s.liquidations + 1 }));
});

// Harbor: local ERC-4626 deposits/redeems here; cross-chain ones are logged once, from Composed.
ponder.on("OmnitideHarbor:Deposit", async ({ event, context }) => {
  const a = event.args;
  if (a.sender.toLowerCase() === event.log.address.toLowerCase()) return;
  await context.db.insert(harborFlow).values({ id: event.id, account: a.owner, kind: "deposit", assets: a.assets, shares: a.shares, srcEid: HUB_EID, dstEid: HUB_EID, delivered: true, timestamp: Number(event.block.timestamp), tx: event.transaction.hash });
});

ponder.on("OmnitideHarbor:Withdraw", async ({ event, context }) => {
  const a = event.args;
  if (a.owner.toLowerCase() === event.log.address.toLowerCase()) return;
  await context.db.insert(harborFlow).values({ id: event.id, account: a.owner, kind: "redeem", assets: a.assets, shares: a.shares, srcEid: HUB_EID, dstEid: HUB_EID, delivered: true, timestamp: Number(event.block.timestamp), tx: event.transaction.hash });
});

ponder.on("OmnitideHarbor:Composed", async ({ event, context }) => {
  const a = event.args;
  await context.db.insert(harborFlow).values({
    id: event.id,
    account: a.receiver,
    kind: a.deposit ? "deposit" : "redeem",
    assets: a.deposit ? a.amountIn : a.amountOut,
    shares: a.deposit ? a.amountOut : a.amountIn,
    srcEid: a.srcEid,
    dstEid: a.dstEid,
    delivered: a.delivered,
    timestamp: Number(event.block.timestamp),
    tx: event.transaction.hash,
  });
});

ponder.on("OmnitideTideReader:TideRequested", async ({ event, context }) => {
  const a = event.args;
  const req = { requestedBy: a.by, fee: a.fee, readAt: Number(a.readAt), requestTx: event.transaction.hash };
  await context.db.insert(tideRead).values({ guid: a.guid, ...req }).onConflictDoUpdate(req);
});

ponder.on("OmnitideTideReader:TideRead", async ({ event, context }) => {
  const a = event.args;
  const got = { readAt: Number(a.readAt), eids: [...a.eids], supplies: [...a.supplies], receivedAt: Number(event.block.timestamp), receivedTx: event.transaction.hash };
  await context.db.insert(tideRead).values({ guid: a.guid, ...got }).onConflictDoUpdate(got);
});

// ───────── V3 Deep Water ─────────

ponder.on("OmnitideClearinghouse:SealedOrderPlaced", async ({ event, context }) => {
  const a = event.args;
  await context.db.insert(sealedOrder).values({ id: a.id, account: a.account, commitment: a.commitment, ciphertext: a.ciphertext, status: "open", placedAt: Number(event.block.timestamp) });
});

ponder.on("OmnitideClearinghouse:SealedOrderCancelled", async ({ event, context }) => {
  await context.db.update(sealedOrder, { id: event.args.id }).set({ status: "cancelled", closedAt: Number(event.block.timestamp) });
});

ponder.on("OmnitideClearinghouse:SealedOrderExecuted", async ({ event, context }) => {
  const a = event.args;
  await context.db
    .update(sealedOrder, { id: a.id })
    .set({ status: "filled", marketId: a.marketId, kind: a.kind, sizeDelta: a.sizeDelta, triggerPrice: a.triggerPrice, fillPrice: a.price, closedAt: Number(event.block.timestamp) });
  await context.db.sql.update(trade).set({ viaOrder: true }).where(and(eq(trade.tx, event.transaction.hash), eq(trade.account, a.account)));
});

const note = (event: { id: string; block: { timestamp: bigint }; transaction: { hash: `0x${string}` } }) => ({ id: event.id, timestamp: Number(event.block.timestamp), tx: event.transaction.hash });

ponder.on("OmnitideDeepPool:DeepDeposit", async ({ event, context }) => {
  await context.db.insert(deepNote).values({ ...note(event), deepId: event.args.id, kind: "deposit", amount: event.args.amount, eid: event.args.srcEid });
});

ponder.on("OmnitideDeepPool:Sealed", async ({ event, context }) => {
  const a = event.args;
  await context.db.insert(deepNote).values({ ...note(event), deepId: a.id, kind: "seal", nonce: Number(a.nonce), commitment: a.commitment, ciphertext: a.ciphertext });
});

ponder.on("OmnitideDeepPool:DeepWithdraw", async ({ event, context }) => {
  await context.db.insert(deepNote).values({ ...note(event), deepId: event.args.id, kind: "withdraw", amount: event.args.amount, eid: event.args.dstEid });
});

ponder.on("OmnitideDeepPool:ExitRequested", async ({ event, context }) => {
  await context.db.insert(deepNote).values({ ...note(event), deepId: event.args.id, kind: "exit-request", amount: event.args.amount });
});

ponder.on("OmnitideDeepPool:Exited", async ({ event, context }) => {
  await context.db.insert(deepNote).values({ ...note(event), deepId: event.args.id, kind: "exit", amount: event.args.amount });
});

ponder.on("OmnitideLighthouse:BeamLit", async ({ event, context }) => {
  const a = event.args;
  const row = { score: a.score, grade: a.grade, issuedAt: Number(a.issuedAt), expiry: Number(a.expiry), srcEid: a.srcEid, tx: event.transaction.hash };
  await context.db.insert(beam).values({ chainId: context.chain.id, account: a.account, ...row }).onConflictDoUpdate(row);
});

ponder.on("OmnitideLighthouse:BeamSent", async ({ event, context }) => {
  const a = event.args;
  await context.db.insert(beamSent).values({ guid: a.guid, account: a.account, srcChainId: context.chain.id, dstEid: a.dstEid, timestamp: Number(event.block.timestamp) });
});

ponder.on("OmnitideBadge:Transfer", async ({ event, context }) => {
  const { from, to, tokenId } = event.args;
  const key = { chainId: context.chain.id, tokenId };
  const at = Number(event.block.timestamp);
  if (to === zeroAddress) await context.db.delete(badge, key);
  else if (from === zeroAddress) await context.db.insert(badge).values({ ...key, owner: to, updatedAt: at }).onConflictDoUpdate({ owner: to, updatedAt: at });
  else await context.db.update(badge, key).set({ owner: to, updatedAt: at });
});

ponder.on("OmnitideBadge:BadgeClaimed", async ({ event, context }) => {
  await context.db.update(badge, { chainId: context.chain.id, tokenId: event.args.tokenId }).set({ kind: event.args.kind });
});

ponder.on("OmnitideBadge:BadgeReceived", async ({ event, context }) => {
  await context.db.update(badge, { chainId: context.chain.id, tokenId: event.args.tokenId }).set({ kind: event.args.kind });
});

ponder.on("OmnitideBadge:BadgeSent", async () => {
  // the burn's Transfer already removed it here; the arrival mints it on the other chain
});

// chains are indexed independently, so a spoke's mirror can land before the hub's proposal
const EMPTY_PROPOSAL = { proposer: zeroAddress, title: "", body: "", start: 0, end: 0, forVotes: 0n, againstVotes: 0n, abstainVotes: 0n, voters: 0, mirroredTo: [] as number[] };

ponder.on("OmnitideCouncil:ProposalCreated", async ({ event, context }) => {
  const a = event.args;
  const row = { proposer: a.proposer, title: a.title, body: a.body, start: Number(a.start), end: Number(a.end), tx: event.transaction.hash };
  await context.db.insert(proposal).values({ ...EMPTY_PROPOSAL, id: a.id, ...row }).onConflictDoUpdate(row);
});

ponder.on("OmnitideCouncil:ProposalMirrored", async ({ event, context }) => {
  const chainId = context.chain.id;
  await context.db
    .insert(proposal)
    .values({ ...EMPTY_PROPOSAL, id: event.args.id, start: Number(event.args.start), end: Number(event.args.end), mirroredTo: [chainId], tx: event.transaction.hash })
    .onConflictDoUpdate((p) => ({ mirroredTo: p.mirroredTo.includes(chainId) ? p.mirroredTo : [...p.mirroredTo, chainId] }));
});

ponder.on("OmnitideCouncil:VoteCast", async ({ event, context }) => {
  const a = event.args;
  const row = { support: a.support, weight: a.weight, chainId: context.chain.id, timestamp: Number(event.block.timestamp), tx: event.transaction.hash };
  await context.db.insert(vote).values({ id: `${a.id}:${a.voter.toLowerCase()}:${a.eid}`, proposalId: a.id, voter: a.voter, eid: a.eid, tallied: false, ...row }).onConflictDoUpdate(row);
});

// only the hub tallies; a spoke vote counts once its message lands here
ponder.on("OmnitideCouncil:VoteTallied", async ({ event, context }) => {
  const a = event.args;
  await context.db
    .insert(vote)
    .values({ id: `${a.id}:${a.voter.toLowerCase()}:${a.srcEid}`, proposalId: a.id, voter: a.voter, eid: a.srcEid, support: a.support, weight: a.weight, chainId: context.chain.id, tallied: true, timestamp: Number(event.block.timestamp), tx: event.transaction.hash })
    .onConflictDoUpdate({ tallied: true });
  await context.db.update(proposal, { id: a.id }).set((p) => ({
    forVotes: p.forVotes + (a.support === 1 ? a.weight : 0n),
    againstVotes: p.againstVotes + (a.support === 0 ? a.weight : 0n),
    abstainVotes: p.abstainVotes + (a.support === 2 ? a.weight : 0n),
    voters: p.voters + 1,
  }));
});

const setStake = async (context: { chain: { id: number }; db: Db }, account: `0x${string}`, amount: bigint, at: number) => {
  await context.db.insert(stake).values({ chainId: context.chain.id, account, amount, updatedAt: at }).onConflictDoUpdate({ amount, updatedAt: at });
};

ponder.on("OmnitideCouncil:Staked", async ({ event, context }) => setStake(context, event.args.account, event.args.total, Number(event.block.timestamp)));
ponder.on("OmnitideCouncil:Unstaked", async ({ event, context }) => setStake(context, event.args.account, event.args.total, Number(event.block.timestamp)));

// the seed's Deposited fires inside createVault, before the factory's VaultCreated, so every write upserts
const EMPTY_VAULT = { leader: zeroAddress as `0x${string}`, name: "", seed: 0n, deposited: 0n, redeemed: 0n, deposits: 0, leaderTrades: 0, createdAt: 0, tx: zeroHash as `0x${string}` };
type VaultRow = typeof EMPTY_VAULT;
async function touchVault(db: Db, address: `0x${string}`, first: Partial<VaultRow>, patch: (v: VaultRow) => Partial<VaultRow>) {
  await db.insert(copyVault).values({ ...EMPTY_VAULT, address, ...first }).onConflictDoUpdate((v) => patch(v as VaultRow));
}

ponder.on("OmnitideCopyVaultFactory:VaultCreated", async ({ event, context }) => {
  const a = event.args;
  const meta = { leader: a.leader, name: a.name, seed: a.seed, createdAt: Number(event.block.timestamp), tx: event.transaction.hash };
  await touchVault(context.db, a.vault, meta, () => meta);
});

ponder.on("OmnitideCopyVault:Deposited", async ({ event, context }) => {
  const a = event.args;
  const vault = event.log.address;
  await context.db.insert(copyFlow).values({ ...note(event), vault, account: a.account, kind: "deposit", assets: a.assets, shares: a.shares, eid: a.srcEid });
  await touchVault(context.db, vault, { deposited: a.assets, deposits: 1 }, (v) => ({ deposited: v.deposited + a.assets, deposits: v.deposits + 1 }));
  if (a.srcEid === 0) await context.db.delete(copyPending, { vault, account: a.account }); // settle() prices queued deposits
});

ponder.on("OmnitideCopyVault:Queued", async ({ event, context }) => {
  const a = event.args;
  const vault = event.log.address;
  await context.db.insert(copyFlow).values({ ...note(event), vault, account: a.account, kind: "queued", assets: a.assets, eid: a.srcEid });
  await context.db.insert(copyPending).values({ vault, account: a.account, assets: a.assets }).onConflictDoUpdate((p) => ({ assets: p.assets + a.assets }));
});

ponder.on("OmnitideCopyVault:Redeemed", async ({ event, context }) => {
  const a = event.args;
  const vault = event.log.address;
  await context.db.insert(copyFlow).values({ ...note(event), vault, account: a.account, kind: "redeem", assets: a.assets, shares: a.shares, eid: a.dstEid });
  await touchVault(context.db, vault, { redeemed: a.assets }, (v) => ({ redeemed: v.redeemed + a.assets }));
});

ponder.on("OmnitideCopyVault:FeeCharged", async ({ event, context }) => {
  const vault = event.log.address;
  const v = await context.db.find(copyVault, { address: vault });
  await context.db.insert(copyFlow).values({ ...note(event), vault, account: v?.leader ?? vault, kind: "fee", assets: event.args.assets, shares: event.args.shares });
});

ponder.on("OmnitideCopyVault:LeaderTrade", async ({ event, context }) => {
  await touchVault(context.db, event.log.address, { leaderTrades: 1 }, (v) => ({ leaderTrades: v.leaderTrades + 1 }));
});

// Lending: one row per money movement, keyed by the log
const lend = (event: { id: string; block: { timestamp: bigint }; transaction: { hash: `0x${string}` } }) => ({ id: event.id, timestamp: Number(event.block.timestamp), tx: event.transaction.hash });
ponder.on("OmnitideLending:Deposit", async ({ event, context }) => {
  await context.db.insert(lendingFlow).values({ ...lend(event), account: event.args.owner, kind: "supply", amount: event.args.assets, actor: event.args.sender });
});
ponder.on("OmnitideLending:Withdraw", async ({ event, context }) => {
  await context.db.insert(lendingFlow).values({ ...lend(event), account: event.args.owner, kind: "withdraw", amount: event.args.assets, actor: event.args.receiver });
});
ponder.on("OmnitideLending:CollateralDeposited", async ({ event, context }) => {
  await context.db.insert(lendingFlow).values({ ...lend(event), account: event.args.account, kind: "lock", amount: event.args.amount, actor: event.args.from });
});
ponder.on("OmnitideLending:CollateralWithdrawn", async ({ event, context }) => {
  await context.db.insert(lendingFlow).values({ ...lend(event), account: event.args.account, kind: "unlock", amount: event.args.amount, actor: event.args.receiver });
});
ponder.on("OmnitideLending:Borrowed", async ({ event, context }) => {
  await context.db.insert(lendingFlow).values({ ...lend(event), account: event.args.account, kind: "borrow", amount: event.args.amount, actor: event.args.receiver, toMargin: event.args.toMargin });
});
ponder.on("OmnitideLending:Repaid", async ({ event, context }) => {
  await context.db.insert(lendingFlow).values({ ...lend(event), account: event.args.account, kind: "repay", amount: event.args.amount, actor: event.args.from });
});
ponder.on("OmnitideLending:Liquidated", async ({ event, context }) => {
  const a = event.args;
  await context.db.insert(lendingFlow).values({ ...lend(event), account: a.account, kind: "liquidation", amount: a.repaid, seized: a.seized, price: a.price, actor: a.liquidator });
});
ponder.on("OmnitideLending:BadDebt", async ({ event, context }) => {
  await context.db.insert(lendingFlow).values({ ...lend(event), account: event.args.account, kind: "bad_debt", amount: event.args.amount });
});

ponder.on("OmnitideInlet:Swept", async ({ event, context }) => {
  const a = event.args;
  await context.db.insert(inletFlow).values({ ...lend(event), account: a.account, kind: "sweep", route: a.route, box: a.box, dollars: a.stableIn + a.usdIn, repaid: a.repaid, toMargin: a.toMargin, eth: a.ethIn });
});
ponder.on("OmnitideInlet:Rescued", async ({ event, context }) => {
  const a = event.args;
  const native = a.token === "0x0000000000000000000000000000000000000000";
  await context.db.insert(inletFlow).values({ ...lend(event), account: a.account, kind: "rescue", route: a.route, dollars: native ? 0n : a.amount, repaid: 0n, toMargin: 0n, eth: native ? a.amount : 0n, token: a.token });
});
