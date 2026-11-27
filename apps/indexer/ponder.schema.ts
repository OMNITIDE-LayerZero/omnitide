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

// V4 Lending: lender supply/exit, ETH collateral, borrows, repayments and liquidations on the hub.
export const lendingFlow = onchainTable(
  "lending_flow",
  (t) => ({
    id: t.text().primaryKey(),
    account: t.hex().notNull(),
    kind: t.text().notNull(), // supply | withdraw | lock | unlock | borrow | repay | liquidation | bad_debt
    amount: t.bigint().notNull(), // tdUSD units; ETH wei for lock/unlock
    seized: t.bigint(), // liquidation: ETH wei taken
    price: t.bigint(), // liquidation: ETH price, 1e18
    actor: t.hex(), // who paid or received when it is not the account
    toMargin: t.boolean(),
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

// V3 Deep Water. Deep books only ever show up here as commitments and ciphertext.
export const deepNote = onchainTable(
  "deep_note",
  (t) => ({
    id: t.text().primaryKey(),
    deepId: t.hex().notNull(),
    kind: t.text().notNull(), // deposit | seal | withdraw | exit-request | exit
    amount: t.bigint(),
    eid: t.integer(),
    nonce: t.integer(),
    commitment: t.hex(),
    ciphertext: t.hex(),
    timestamp: t.integer().notNull(),
    tx: t.hex().notNull(),
  }),
  (t) => ({ byDeep: index().on(t.deepId, t.timestamp) }),
);

export const sealedOrder = onchainTable(
  "sealed_order",
  (t) => ({
    id: t.bigint().primaryKey(),
    account: t.hex().notNull(),
    commitment: t.hex().notNull(),
    ciphertext: t.hex().notNull(),
    status: t.text().notNull(), // open | filled | cancelled
    marketId: t.integer(), // revealed on fill
    kind: t.integer(),
    sizeDelta: t.bigint(),
    triggerPrice: t.bigint(),
    fillPrice: t.bigint(),
    placedAt: t.integer().notNull(),
    closedAt: t.integer(),
  }),
  (t) => ({ byAccount: index().on(t.account, t.status) }),
);

export const beam = onchainTable(
  "beam",
  (t) => ({
    chainId: t.integer().notNull(),
    account: t.hex().notNull(),
    score: t.integer().notNull(),
    grade: t.integer().notNull(),
    issuedAt: t.integer().notNull(),
    expiry: t.integer().notNull(),
    srcEid: t.integer().notNull(),
    tx: t.hex().notNull(),
  }),
  (t) => ({ pk: primaryKey({ columns: [t.chainId, t.account] }) }),
);

export const beamSent = onchainTable("beam_sent", (t) => ({
  guid: t.hex().primaryKey(),
  account: t.hex().notNull(),
  srcChainId: t.integer().notNull(),
  dstEid: t.integer().notNull(),
  timestamp: t.integer().notNull(),
}));

export const badge = onchainTable(
  "badge",
  (t) => ({
    chainId: t.integer().notNull(),
    tokenId: t.bigint().notNull(),
    owner: t.hex().notNull(),
    kind: t.integer(),
    updatedAt: t.integer().notNull(),
  }),
  (t) => ({ pk: primaryKey({ columns: [t.chainId, t.tokenId] }), byOwner: index().on(t.owner) }),
);

export const proposal = onchainTable("proposal", (t) => ({
  id: t.bigint().primaryKey(),
  proposer: t.hex().notNull(),
  title: t.text().notNull(),
  body: t.text().notNull(),
  start: t.integer().notNull(),
  end: t.integer().notNull(),
  forVotes: t.bigint().notNull(),
  againstVotes: t.bigint().notNull(),
  abstainVotes: t.bigint().notNull(),
  voters: t.integer().notNull(),
  mirroredTo: t.integer().array().notNull(), // chain ids
  tx: t.hex().notNull(),
}));

export const vote = onchainTable(
  "vote",
  (t) => ({
    id: t.text().primaryKey(), // proposal:voter:origin eid, stake on each chain votes once
    proposalId: t.bigint().notNull(),
    voter: t.hex().notNull(),
    eid: t.integer().notNull(),
    support: t.integer().notNull(),
    weight: t.bigint().notNull(),
    chainId: t.integer().notNull(),
    tallied: t.boolean().notNull(),
    timestamp: t.integer().notNull(),
    tx: t.hex().notNull(),
  }),
  (t) => ({ byProposal: index().on(t.proposalId), byVoter: index().on(t.voter) }),
);

export const stake = onchainTable(
  "stake",
  (t) => ({
    chainId: t.integer().notNull(),
    account: t.hex().notNull(),
    amount: t.bigint().notNull(),
    updatedAt: t.integer().notNull(),
  }),
  (t) => ({ pk: primaryKey({ columns: [t.chainId, t.account] }) }),
);

export const copyVault = onchainTable("copy_vault", (t) => ({
  address: t.hex().primaryKey(),
  leader: t.hex().notNull(),
  name: t.text().notNull(),
  seed: t.bigint().notNull(),
  deposited: t.bigint().notNull(),
  redeemed: t.bigint().notNull(),
  deposits: t.integer().notNull(),
  leaderTrades: t.integer().notNull(),
  createdAt: t.integer().notNull(),
  tx: t.hex().notNull(),
}));

export const copyFlow = onchainTable(
  "copy_flow",
  (t) => ({
    id: t.text().primaryKey(),
    vault: t.hex().notNull(),
    account: t.hex().notNull(),
    kind: t.text().notNull(), // deposit | queued | redeem | fee (leader, high-water mark)
    assets: t.bigint().notNull(),
    shares: t.bigint(),
    eid: t.integer(),
    timestamp: t.integer().notNull(),
    tx: t.hex().notNull(),
  }),
  (t) => ({ byVault: index().on(t.vault, t.timestamp), byAccount: index().on(t.account) }),
);

export const copyPending = onchainTable(
  "copy_pending",
  (t) => ({
    vault: t.hex().notNull(),
    account: t.hex().notNull(),
    assets: t.bigint().notNull(),
  }),
  (t) => ({ pk: primaryKey({ columns: [t.vault, t.account] }) }),
);
