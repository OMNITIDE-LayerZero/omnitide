import type { Address, Chain, Account, PublicClient, Transport, WalletClient } from "viem";
import { omnitideInletAbi as abi } from "@omnitide/contracts/abi";

type Wallet = WalletClient<Transport, Chain, Account>;
const WATCH_MS = 3 * 3_600_000; // 1Click settles in minutes; refunds and slow BTC deposits get hours
const MAX_WATCHES = 1_000;
const MIN_DOLLARS = 10_000n; // 0.01 tdUSD, below that a sweep costs more than it moves
const MIN_ETH = 10n ** 13n;

/** Worth a keeper transaction: enough dollars or ETH waiting. */
export const worthSweeping = (dollars: bigint, eth: bigint) => dollars >= MIN_DOLLARS || eth >= MIN_ETH;

/** Keeper side of the Inlet: watches boxes the web hands it after a NEAR Intents quote and sweeps them once funds land. */
export function createInlet(opts: { pub: PublicClient; wallet: Wallet; inlet: Address; log: (m: string) => void }) {
  const { pub, wallet, inlet: address, log } = opts;
  // shortcut: watches live in memory and die with a restart; the panel's Sweep button covers that, persist them if volume grows
  const watches = new Map<string, { account: Address; route: number; until: number }>();
  let swept = 0;

  function watch(account: Address, route: number) {
    if (watches.size >= MAX_WATCHES) for (const [k, w] of watches) if (w.until < Date.now()) watches.delete(k);
    if (watches.size >= MAX_WATCHES) return false;
    watches.set(`${account.toLowerCase()}:${route}`, { account, route, until: Date.now() + WATCH_MS });
    return true;
  }

  async function tick() {
    for (const [k, w] of watches) {
      if (w.until < Date.now()) {
        watches.delete(k);
        continue;
      }
      try {
        const [dollars, eth] = await pub.readContract({ address, abi, functionName: "pending", args: [w.account, w.route] });
        if (!worthSweeping(dollars, eth)) continue;
        const { request } = await pub.simulateContract({ address, abi, functionName: "sweep", args: [w.account, w.route], account: wallet.account });
        const hash = await wallet.writeContract(request);
        await pub.waitForTransactionReceipt({ hash });
        swept++;
        log(`inlet: swept ${w.account} route ${w.route} (${dollars} usd, ${eth} wei) ${hash}`);
      } catch (e) {
        log(`inlet: ${w.account} ${(e as Error).message.split("\n")[0]}`);
      }
    }
    return { inletWatching: watches.size, inletSwept: swept };
  }

  return { watch, tick };
}
