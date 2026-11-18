"use client";

import { parseUnits } from "viem";
import { useAccount } from "wagmi";
import Link from "next/link";
import { HUB } from "@/lib/chains";
import { CLEARINGHOUSE, CH_ABI, omnitideUSDAbi, usdAddress } from "@/lib/contracts";
import { useHubAccount } from "@/lib/account";
import { useTx } from "@/lib/tx";

/** Two taps from nothing to margin: faucet on the hub, then deposit into the book. */
export function QuickFund() {
  const { address } = useAccount();
  const { data } = useHubAccount();
  const { send, busy } = useTx();
  if (!address || !data) return null;
  const wallet = data.hubWallet;

  async function deposit() {
    const amount = parseUnits(wallet.toFixed(6), 6);
    await send("Approve tdUSD", { chainId: HUB.chainId, address: usdAddress("robinhoodTestnet"), abi: omnitideUSDAbi, functionName: "approve", args: [CLEARINGHOUSE, amount] });
    await send(`Deposit ${wallet.toLocaleString("en-US")} tdUSD`, { chainId: HUB.chainId, address: CLEARINGHOUSE, abi: CH_ABI, functionName: "deposit", args: [amount] });
  }

  return (
    <div className="rounded-xl border border-line bg-sky/50 p-4">
      <p className="text-[14px] font-medium">Fund your account</p>
      <p className="mt-1 text-[13px] leading-5 text-ink-2">
        {wallet >= 1 ? `${wallet.toLocaleString("en-US")} tdUSD is in your wallet on Robinhood Chain. Move it into the book to trade.` : "Collect 1,000 test tdUSD on Robinhood Chain, then deposit it as margin. Coming from another chain? Use Inflow."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {wallet >= 1 ? (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void deposit().catch(() => {})}>
            Deposit to margin
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void send("Collect 1,000 tdUSD", { chainId: HUB.chainId, address: usdAddress("robinhoodTestnet"), abi: omnitideUSDAbi, functionName: "drip" }).catch(() => {})}>
            Collect 1,000 tdUSD
          </button>
        )}
        <Link href="/terminal/portfolio#inflow" className="btn btn-secondary btn-sm">
          Inflow from another chain
        </Link>
      </div>
    </div>
  );
}
