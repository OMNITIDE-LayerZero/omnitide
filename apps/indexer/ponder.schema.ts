import { index, onchainTable, primaryKey } from "ponder";

// USD amounts are 1e18 fixed point, tdUSD amounts 1e6, sizes 1e18 base units.
export const market = onchainTable("market", (t) => ({
  id: t.integer().primaryKey(),
  feed: t.text().notNull(),
  initialMarginBps: t.integer().notNull(),
  maintenanceMarginBps: t.integer().notNull(),
  maxOpenInterestUsd: t.bigint().notNull(),
  active: t.boolean().notNull(),
  volumeUsd: t.bigint().notNull(),
  trades: t.integer().notNull(),
}));

export const trade = onchainTable(
  "trade",
  (t) => ({
    id: t.text().primaryKey(),
    account: t.hex().notNull(),
    marketId: t.integer().notNull(),
    sizeDelta: t.bigint().notNull(),
    price: t.bigint().notNull(),
    newSize: t.bigint().notNull(),
    entryPrice: t.bigint().notNull(),
    realizedPnl: t.bigint().notNull(),
    fee: t.bigint().notNull(),
    notionalUsd: t.bigint().notNull(),
    viaOrder: t.boolean().notNull(),
    timestamp: t.integer().notNull(),
    tx: t.hex().notNull(),
  }),
  (t) => ({ byAccount: index().on(t.account, t.timestamp), byMarket: index().on(t.marketId, t.timestamp) }),
);

export const position = onchainTable(
  "position",
  (t) => ({
    account: t.hex().notNull(),
    marketId: t.integer().notNull(),
    size: t.bigint().notNull(),
    entryPrice: t.bigint().notNull(),
    updatedAt: t.integer().notNull(),
  }),
  (t) => ({ pk: primaryKey({ columns: [t.account, t.marketId] }) }),
);

export const order = onchainTable(
  "order",
  (t) => ({
    id: t.bigint().primaryKey(),
    account: t.hex().notNull(),
    marketId: t.integer().notNull(),
    kind: t.integer().notNull(), // 0 limit, 1 stop-loss, 2 take-profit
    sizeDelta: t.bigint().notNull(),
    triggerPrice: t.bigint().notNull(),
    reduceOnly: t.boolean().notNull(),
    status: t.text().notNull(), // open | filled | cancelled
    fillPrice: t.bigint(),
    placedAt: t.integer().notNull(),
    closedAt: t.integer(),
  }),
  (t) => ({ byAccount: index().on(t.account, t.status) }),
);

export const flow = onchainTable(
  "flow",
  (t) => ({
    id: t.text().primaryKey(),
    account: t.hex().notNull(),
    kind: t.text().notNull(), // inflow | deposit | ebb | withdraw | liquidation
    amount: t.bigint().notNull(),
    eid: t.integer().notNull(),
    guid: t.hex(),
    timestamp: t.integer().notNull(),
    tx: t.hex().notNull(),
  }),
  (t) => ({ byAccount: index().on(t.account, t.timestamp) }),
);

export const bridge = onchainTable("bridge", (t) => ({
  guid: t.hex().primaryKey(),
  srcChainId: t.integer(),
  dstChainId: t.integer(),
  dstEid: t.integer(),
  from: t.hex(),
  to: t.hex(),
  amount: t.bigint().notNull(),
  sentAt: t.integer(),
  receivedAt: t.integer(),
  sentTx: t.hex(),
  receivedTx: t.hex(),
}));

export const liquidation = onchainTable("liquidation", (t) => ({
  id: t.text().primaryKey(),
  account: t.hex().notNull(),
  liquidator: t.hex().notNull(),
  notionalUsd: t.bigint().notNull(),
  penalty: t.bigint().notNull(),
  badDebt: t.bigint().notNull(),
  timestamp: t.integer().notNull(),
  tx: t.hex().notNull(),
}));

export const trader = onchainTable("trader", (t) => ({
  account: t.hex().primaryKey(),
  trades: t.integer().notNull(),
  volumeUsd: t.bigint().notNull(),
  realizedPnl: t.bigint().notNull(),
  fees: t.bigint().notNull(),
  firstSeen: t.integer().notNull(),
  lastSeen: t.integer().notNull(),
}));

export const stats = onchainTable("stats", (t) => ({
  id: t.text().primaryKey(), // "global"
  trades: t.integer().notNull(),
  volumeUsd: t.bigint().notNull(),
  feesPaid: t.bigint().notNull(),
  inflows: t.integer().notNull(),
  ebbs: t.integer().notNull(),
  bridged: t.bigint().notNull(),
  drips: t.integer().notNull(),
  liquidations: t.integer().notNull(),
}));

// V2 Current: Harbor vault flows (local and OVault compose) and lzRead Tide readings.
export const harborFlow = onchainTable(
  "harbor_flow",
  (t) => ({
    id: t.text().primaryKey(),
    account: t.hex().notNull(),
    kind: t.text().notNull(), // deposit | redeem
    assets: t.bigint().notNull(),
    shares: t.bigint().notNull(),
    srcEid: t.integer().notNull(),
    dstEid: t.integer().notNull(),
    delivered: t.boolean().notNull(),
    timestamp: t.integer().notNull(),
    tx: t.hex().notNull(),
  }),
  (t) => ({ byAccount: index().on(t.account, t.timestamp), byTime: index().on(t.timestamp) }),
);

export const tideRead = onchainTable("tide_read", (t) => ({
  guid: t.hex().primaryKey(),
  requestedBy: t.hex(),
  fee: t.bigint(),
  readAt: t.integer().notNull(),
  requestTx: t.hex(),
  eids: t.integer().array(),
  supplies: t.bigint().array(),
  receivedAt: t.integer(),
  receivedTx: t.hex(),
}));
