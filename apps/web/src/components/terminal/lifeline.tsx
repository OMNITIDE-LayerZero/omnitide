"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount, useConfig } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { parseUnits, type Address } from "viem";
import { LifeBuoy } from "lucide-react";
import { CHAINS, type ChainKey } from "@omnitide/contracts/chains";
import { CHAIN_KEYS, HUB, HUB_KEY, IS_MAINNET, SHORT, inflowRoute } from "@/lib/chains";
import { CLEARINGHOUSE, CH_ABI, omnitideUSDAbi, usdAddress } from "@/lib/contracts";
import { useHubAccount } from "@/lib/account";
import { usePriceMap } from "@/lib/hooks";
import { accountHealth } from "@/lib/margin";
import { money } from "@/lib/format";
import { useTx } from "@/lib/tx";
import { sendParam } from "./collateral";

/** Below this tide level the Lifeline surfaces. */
export const LIFELINE_LEVEL = 0.4;

/** tdUSD sitting in the wallet on every live chain, the raw material for a Lifeline. */
export function useWalletAcrossChains() {
  const { address } = useAccount();
  const config = useConfig();
  return useQuery({
    queryKey: ["wallet-across", address],
    enabled: !!address,
    refetchInterval: 15_000,
    queryFn: async () => {
      const rows = await Promise.allSettled(
        CHAIN_KEYS.map(async (k) => {
          const client = getPublicClient(config, { chainId: CHAINS[k].chainId });
          const raw = await client!.readContract({ address: usdAddress(k), abi: omnitideUSDAbi, functionName: "balanceOf", args: [address as Address] });
          return { chain: k, raw, balance: Number(raw) / 1e6 };
        }),
      );
      return rows.flatMap((r) => (r.status === "fulfilled" && r.value.raw > 0n ? [r.value] : [])).sort((a, b) => b.balance - a.balance);
    },
  });
}

/** Collateral that lifts the gauge back to 50%: equity' = 2 × maintenance. */
export const lifelineNeed = (equity: number, mm: number) => Math.max(0, 2 * mm - equity);

/** Lifeline: when the tide runs low, offer a top-up from whichever chain holds tdUSD, one transaction away. */
export function Lifeline({ always = false }: { always?: boolean }) {
  const { address } = useAccount();
  const { data: acct } = useHubAccount();
  const prices = usePriceMap();
  const { data: wallets } = useWalletAcrossChains();
  const { send, busy } = useTx();
  const config = useConfig();
  if (!acct || acct.positions.length === 0) return null;
  const h = accountHealth(acct.collateral, acct.positions, prices);
  if (!always && h.level >= LIFELINE_LEVEL) return null;
  const need = lifelineNeed(h.equity, h.mm);
  const sources = wallets ?? [];

  async function throwLine(from: ChainKey, balance: number) {
    if (!address) return;
    const amount = parseUnits(Math.min(balance, Math.max(need, 1)).toFixed(6), 6);
    if (from === HUB_KEY) {
      await send("Approve tdUSD", { chainId: HUB.chainId, address: usdAddress(HUB_KEY), abi: omnitideUSDAbi, functionName: "approve", args: [CLEARINGHOUSE, amount] });
      await send("Lifeline: deposit on Robinhood Chain", { chainId: HUB.chainId, address: CLEARINGHOUSE, abi: CH_ABI, functionName: "deposit", args: [amount] });
      return;
    }
    const hop = inflowRoute(from)[0]!;
    const direct = hop === HUB_KEY;
    const param = sendParam(hop, direct ? CLEARINGHOUSE : address, amount, direct ? address : null);
    const client = getPublicClient(config, { chainId: CHAINS[from].chainId });
    const q = await client!.readContract({ address: usdAddress(from), abi: omnitideUSDAbi, functionName: "quoteSend", args: [param, false] });
    await send(direct ? `Lifeline from ${SHORT[from]}` : `Lifeline: ferry to ${SHORT[hop]}`, {
      chainId: CHAINS[from].chainId,
      address: usdAddress(from),
      abi: omnitideUSDAbi,
      functionName: "send",
      args: [param, { nativeFee: q.nativeFee, lzTokenFee: 0n }, address],
      value: q.nativeFee,
    });
  }

  const low = h.level < LIFELINE_LEVEL;
  return (
    <section id="lifeline" className={`scroll-mt-20 rounded-2xl border p-4 ${low ? "border-ebb/50 bg-ebb/5" : "border-line bg-card"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <LifeBuoy size={20} strokeWidth={1.5} className={low ? "text-ebb" : "text-ink-3"} />
          <div>
            <p className="font-medium">{low ? `Lifeline · tide at ${Math.round(h.level * 100)}%` : "Lifeline"}</p>
            <p className="mt-1 max-w-xl text-[13px] leading-5 text-ink-2">
              {need > 0
                ? `${money(need)} lifts you back to 50% above the sea wall. Pull it from any chain: lzCompose credits it to this account in the same LayerZero delivery.`
                : "Margin is healthy. When it runs low, top up from any chain here in one transaction; lzCompose credits it on arrival."}
            </p>
          </div>
        </div>
      </div>
      {sources.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {sources.map((s) => (
            <button key={s.chain} type="button" disabled={busy} onClick={() => void throwLine(s.chain, s.balance).catch(() => {})} className="btn btn-secondary btn-sm">
              {money(Math.min(s.balance, Math.max(need, 1)))} from {SHORT[s.chain]}
              {inflowRoute(s.chain)[0] !== HUB_KEY && s.chain !== HUB_KEY && <span className="tag text-ink-3">2 hops</span>}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-ink-3">{IS_MAINNET ? "No spare tdUSD in this wallet on other chains yet. Inflow tops the book up straight from USDC on Arbitrum or HyperEVM." : "No spare tdUSD in this wallet on other chains yet. The Faucet tab collects 1,000 per chain per day."}</p>
      )}
    </section>
  );
}
