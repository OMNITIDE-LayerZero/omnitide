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

  async function send(functionName: "executeOrder" | "liquidate", args: readonly unknown[]) {
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

  return {
    async tick() {
      await scanTraders();
      await fillOrders();
      await liquidateUnderwater();
      return { traders: traders.size, orderCursor: orderCursor.toString(), block: logCursor.toString() };
    },
  };
}
