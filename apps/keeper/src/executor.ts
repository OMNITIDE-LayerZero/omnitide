import { parseAbiItem, type Address, type PublicClient, type WalletClient, type Chain, type Account, type Transport } from "viem";
import { omnitideClearinghouseAbi as abi } from "@omnitide/contracts/abi";
import { MARKETS } from "@omnitide/contracts/markets";
import type { SignedReport } from "./reports.js";

type Wallet = WalletClient<Transport, Chain, Account>;
type ReportFn = (feeds: string[]) => Promise<SignedReport[]>;
type PriceFn = (feed: string) => number | undefined;

const tradedEvent = parseAbiItem(
  "event Traded(address indexed account, uint8 indexed marketId, int256 sizeDelta, uint256 price, int256 newSize, uint256 entryPrice, int256 realizedPnl, uint256 fee)",
);
const LOG_CHUNK = 20_000n;
const OrderKind = { Limit: 0, StopLoss: 1, TakeProfit: 2 } as const;
const MARK_EVERY_MS = 60_000;
const ZERO = "0x0000000000000000000000000000000000000000";

/** Open trader PnL in tdUSD units (6 dp) from per-market net size, cost basis and price, as OmnitideClearinghouse.traderPnl. */
export function traderPnlUnits(legs: { net: bigint; costBasis: bigint; price: bigint }[]): bigint {
  return legs.reduce((sum, l) => sum + l.net * l.price - l.costBasis, 0n) / 10n ** 30n;
}

/** Re-mark when the on-chain reserve drifts more than 1% of the pool (or 0.01 tdUSD) from live prices. */
export function needsMark(live: bigint, onChain: bigint, pool: bigint): boolean {
  const drift = live > onChain ? live - onChain : onChain - live;
  const floor = pool / 100n > 10_000n ? pool / 100n : 10_000n;
  return drift > floor;
}

/** Would this order fill at `price`? Mirrors OmnitideClearinghouse.executeOrder. */
export function orderTriggered(kind: number, sizeDelta: bigint, trigger: bigint, price: bigint): boolean {
  const buy = sizeDelta > 0n;
  if (kind === OrderKind.StopLoss) return buy ? price >= trigger : price <= trigger;
  return buy ? price <= trigger : price >= trigger;
}

export function createExecutor(opts: { pub: PublicClient; wallet: Wallet; clearinghouse: Address; fromBlock: bigint; reports: ReportFn; price: PriceFn; log: (m: string) => void }) {
  const { pub, wallet, clearinghouse: address, reports, price, log } = opts;
  let orderCursor = 0n;
  let logCursor = opts.fromBlock;
  const traders = new Set<Address>();
  let lastMark = 0;

  async function send(functionName: "executeOrder" | "liquidate" | "markPrices", args: readonly unknown[]) {
    const { request } = await pub.simulateContract({ address, abi, functionName, args, account: wallet.account } as never);
    const hash = await wallet.writeContract(request as never);
    await pub.waitForTransactionReceipt({ hash });
    return hash;
  }

  async function fillOrders() {
    const next = await pub.readContract({ address, abi, functionName: "nextOrderId" });
    let firstActive: bigint | null = null;
    for (let id = orderCursor; id < next; id++) {
      const [account, marketId, kind, , active, sizeDelta, trigger] = await pub.readContract({ address, abi, functionName: "orders", args: [id] });
      if (!active) continue;
      firstActive ??= id;
      const feed = MARKETS[marketId]?.feed;
      const p = feed ? price(feed) : undefined;
      if (!feed || p === undefined) continue;
      if (!orderTriggered(kind, sizeDelta, trigger, BigInt(Math.round(p * 1e8)) * 10n ** 10n)) continue;
      try {
        const hash = await send("executeOrder", [id, await reports([feed])]);
        log(`order ${id} filled for ${account.slice(0, 8)} · ${hash}`);
      } catch (e) {
        log(`order ${id} not filled: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    orderCursor = firstActive ?? next;
  }

  async function scanTraders() {
    const head = await pub.getBlockNumber();
    while (logCursor <= head) {
      const to = logCursor + LOG_CHUNK - 1n < head ? logCursor + LOG_CHUNK - 1n : head;
      const logs = await pub.getLogs({ address, event: tradedEvent, fromBlock: logCursor, toBlock: to });
      for (const l of logs) if (l.args.account) traders.add(l.args.account);
      logCursor = to + 1n;
    }
  }

  async function liquidateUnderwater() {
    for (const account of traders) {
      const open = await pub.readContract({ address, abi, functionName: "openMarkets", args: [account] });
      if (open.length === 0) continue;
      const feeds = open.map((id) => MARKETS[id]!.feed);
      const signed = await reports(feeds);
      const [equity, , mm] = await pub.readContract({ address, abi, functionName: "accountMargin", args: [account, signed as never] });
      if (equity >= BigInt(mm)) continue;
      try {
        const hash = await send("liquidate", [account, signed]);
        log(`liquidated ${account.slice(0, 8)} · ${hash}`);
      } catch (e) {
        log(`liquidation of ${account.slice(0, 8)} skipped: ${(e as Error).message.split("\n")[0]}`);
      }
    }
  }

  // keeps Harbor's reserve for open trader PnL in step with the market
  async function markHarbor() {
    if (Date.now() - lastMark < MARK_EVERY_MS) return;
    lastMark = Date.now();
    if ((await pub.readContract({ address, abi, functionName: "harbor" })) === ZERO) return;
    const count = await pub.readContract({ address, abi, functionName: "marketCount" });
    const legs: { net: bigint; costBasis: bigint; price: bigint }[] = [];
    const feeds: string[] = [];
    let unmarked = false;
    for (let id = 0; id < count; id++) {
      const m = await pub.readContract({ address, abi, functionName: "markets", args: [id] });
      const net = m[5] - m[6];
      if (net === 0n && m[5] === 0n) continue;
      const feed = MARKETS[id]?.feed;
      const p = feed ? price(feed) : undefined;
      if (!feed || p === undefined) return; // no live price: leave the last marks alone
      legs.push({ net, costBasis: await pub.readContract({ address, abi, functionName: "costBasis", args: [id] }), price: BigInt(Math.round(p * 1e8)) * 10n ** 10n });
      unmarked ||= (await pub.readContract({ address, abi, functionName: "markPrice", args: [id] })) === 0n;
      feeds.push(feed);
    }
    if (feeds.length === 0) return;
    const [onChain, pool] = await Promise.all([
      pub.readContract({ address, abi, functionName: "traderPnl" }),
      pub.readContract({ address, abi, functionName: "poolBalance" }),
    ]);
    if (!unmarked && !needsMark(traderPnlUnits(legs), onChain, pool > 0n ? pool : 0n)) return;
    try {
      const hash = await send("markPrices", [await reports(feeds)]);
      log(`harbor marks refreshed (${feeds.length} markets) · ${hash}`);
    } catch (e) {
      log(`harbor mark skipped: ${(e as Error).message.split("\n")[0]}`);
    }
  }

  return {
    async tick() {
      await scanTraders();
      await fillOrders();
      await liquidateUnderwater();
      await markHarbor();
      return { traders: traders.size, orderCursor: orderCursor.toString(), block: logCursor.toString() };
    },
  };
}
