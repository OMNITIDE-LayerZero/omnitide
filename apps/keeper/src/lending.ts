import { erc20Abi, maxUint256, parseAbiItem, type Address, type Chain, type Account, type PublicClient, type Transport, type WalletClient } from "viem";
import { omnitideLendingAbi as abi } from "@omnitide/contracts/abi";
import type { SignedReport } from "./reports.js";

type Wallet = WalletClient<Transport, Chain, Account>;
const borrowedEvent = parseAbiItem("event Borrowed(address indexed account, address receiver, uint256 amount, bool toMargin)");
const LOG_CHUNK = 20_000n;
const WAD = 10n ** 18n;
const RESERVES_EVERY_MS = 6 * 3_600_000;
const MIN_RESERVES = 10_000n; // 0.01 tdUSD

/** tdUSD the keeper repays on one liquidation: the contract's cap (whole debt at dust size, else close factor), bounded by what the keeper holds. */
export function liquidationRepay(debt: bigint, dust: bigint, closeFactorBps: bigint, held: bigint): bigint {
  const max = debt <= dust ? debt : (debt * closeFactorBps) / 10_000n;
  return max < held ? max : held;
}

/** Keeper side of Lending: liquidates loans past 80% and sends accrued reserves to the Tide Pool. */
export function createLending(opts: { pub: PublicClient; wallet: Wallet; lending: Address; fromBlock: bigint; reports: (feeds: string[]) => Promise<SignedReport[]>; log: (m: string) => void }) {
  const { pub, wallet, lending: address, reports, log } = opts;
  const borrowers = new Set<Address>();
  let cursor = opts.fromBlock;
  let lastReserves = 0;
  let liquidated = 0;
  let approved = false;

  async function send(functionName: "liquidate" | "sendReserves", args: readonly unknown[]) {
    const { request } = await pub.simulateContract({ address, abi, functionName, args, account: wallet.account } as never);
    const hash = await wallet.writeContract(request as never);
    await pub.waitForTransactionReceipt({ hash });
    return hash;
  }

  async function scan() {
    const head = await pub.getBlockNumber();
    while (cursor <= head) {
      const to = cursor + LOG_CHUNK - 1n < head ? cursor + LOG_CHUNK - 1n : head;
      for (const l of await pub.getLogs({ address, event: borrowedEvent, fromBlock: cursor, toBlock: to })) if (l.args.account) borrowers.add(l.args.account);
      cursor = to + 1n;
    }
  }

  async function liquidate() {
    if (borrowers.size === 0) return;
    const [report] = await reports(["ETH-USD"]);
    if (!report) return;
    const token = (await pub.readContract({ address, abi, functionName: "asset" })) as Address;
    for (const account of borrowers) {
      const [, debt, , , health] = await pub.readContract({ address, abi, functionName: "positionOf", args: [account, BigInt(report.price)] });
      if (debt === 0n || health >= WAD) continue;
      const p = await pub.readContract({ address, abi, functionName: "params" });
      const held = await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [wallet.account.address] });
      const repay = liquidationRepay(debt, p[11], BigInt(p[4]), held);
      if (repay === 0n) {
        log(`lending: ${account.slice(0, 8)} is liquidatable but the keeper holds no tdUSD`);
        continue;
      }
      if (!approved) {
        const allowance = await pub.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [wallet.account.address, address] });
        if (allowance < repay) await pub.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [address, maxUint256] }) });
        approved = true;
      }
      try {
        const hash = await send("liquidate", [account, repay, wallet.account.address, report]);
        liquidated++;
        log(`lending: liquidated ${account.slice(0, 8)} for ${repay} · ${hash}`);
      } catch (e) {
        log(`lending: liquidation of ${account.slice(0, 8)} skipped: ${(e as Error).message.split("\n")[0]}`);
      }
    }
  }

  async function sendReserves() {
    if (Date.now() - lastReserves < RESERVES_EVERY_MS) return;
    lastReserves = Date.now();
    if ((await pub.readContract({ address, abi, functionName: "reserves" })) < MIN_RESERVES) return;
    log(`lending: reserves to the Tide Pool · ${await send("sendReserves", [])}`);
  }

  return {
    async tick() {
      await scan();
      await liquidate();
      await sendReserves().catch((e: Error) => log(`lending: reserves skipped: ${e.message.split("\n")[0]}`));
      return { lendingBorrowers: borrowers.size, lendingLiquidated: liquidated };
    },
  };
}
