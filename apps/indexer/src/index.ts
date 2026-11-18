import { and, eq } from "ponder";
import { ponder } from "ponder:registry";
import { bridge, flow, liquidation, market, order, position, stats, trade, trader } from "ponder:schema";

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
