"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { MARKETS } from "@omnitide/contracts/markets";
import { HUB } from "@/lib/chains";
import { CLEARINGHOUSE, CH_ABI } from "@/lib/contracts";
import { fetchReports, feedsFor, useHubAccount } from "@/lib/account";
import { useIndexer, usePriceMap } from "@/lib/hooks";
import { accountHealth, liquidationPrice } from "@/lib/margin";
import { ago, money, price, signedMoney, wad } from "@/lib/format";
import { useTx } from "@/lib/tx";

interface OrderRow {
  id: string;
  marketId: number;
  kind: number;
  sizeDelta: string;
  triggerPrice: string;
  reduceOnly: boolean;
  status: string;
  placedAt: number;
}
const KIND = ["Limit", "Stop-loss", "Take-profit"];

export function PositionsPanel() {
  const [tab, setTab] = useState<"positions" | "orders">("positions");
  const { address, isConnected } = useAccount();
  const { data: acct } = useHubAccount();
  const { data: orders } = useIndexer<OrderRow[]>("orders", address?.toLowerCase(), !!address);
  const prices = usePriceMap();
  const { send, busy } = useTx();
  const positions = acct?.positions ?? [];
  const open = (orders ?? []).filter((o) => o.status === "open");
  const h = accountHealth(acct?.collateral ?? 0, positions, prices);

  async function close(marketId: number, sizeRaw: bigint) {
    const m = MARKETS[marketId]!;
    const px = prices[m.feed];
    if (!px) return;
    const reports = await fetchReports(feedsFor(positions));
    const limit = BigInt(Math.round(px * (sizeRaw > 0n ? 0.99 : 1.01) * 1e8)) * 10n ** 10n;
    await send(`Close ${m.symbol}`, { chainId: HUB.chainId, address: CLEARINGHOUSE, abi: CH_ABI, functionName: "trade", args: [marketId, -sizeRaw, limit, reports] });
  }

  return (
    <div>
      <div className="flex items-center gap-1 border-b border-line px-2" role="tablist">
        {(["positions", "orders"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`relative h-10 px-3 text-[14px] transition-colors ${tab === t ? "text-ink" : "text-ink-3 hover:text-ink-2"}`}>
            {t === "positions" ? "Positions" : "Open orders"}
            {(t === "positions" ? positions.length : open.length) > 0 && <span className="num ml-2 text-[12px] text-ink-3">{t === "positions" ? positions.length : open.length}</span>}
            {tab === t && <span className="absolute inset-x-3 -bottom-px h-px bg-accent" />}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        {tab === "positions" ? (
          positions.length === 0 ? (
            <p className="px-4 py-8 text-[14px] text-ink-2">{isConnected ? "No open positions. Pick a side in the ticket and your first fill lands here." : "Connect a wallet to see your positions."}</p>
          ) : (
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <thead className="text-[12px] text-ink-3">
                <tr>
                  {["Market", "Size", "Entry", "Mark", "Unrealized PnL", "Liquidation", ""].map((c) => (
                    <th key={c} className="px-4 py-2 font-normal">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const m = MARKETS[p.marketId]!;
                  const mark = prices[m.feed];
                  const pnl = mark ? p.size * (mark - p.entry) : undefined;
                  const liq = liquidationPrice(p.size > 0 ? 1 : -1, p.size, p.entry, h.equity - (pnl ?? 0), m.maintenanceMarginBps);
                  return (
                    <tr key={p.marketId} className="border-t border-line">
                      <td className="px-4 py-3">
                        <span className="font-medium">{m.symbol}</span>
                        <span className={`ml-2 ${p.size > 0 ? "text-flood" : "text-ebb"}`}>{p.size > 0 ? "Long" : "Short"}</span>
                      </td>
                      <td className="num px-4 py-3">
                        {Math.abs(p.size).toPrecision(5)} <span className="text-ink-3">{mark ? money(Math.abs(p.size) * mark) : ""}</span>
                      </td>
                      <td className="num px-4 py-3">{price(p.entry)}</td>
                      <td className="num px-4 py-3">{mark ? price(mark) : ""}</td>
                      <td className={`num px-4 py-3 ${pnl !== undefined && pnl >= 0 ? "text-flood" : "text-ebb"}`}>{pnl !== undefined ? signedMoney(pnl) : ""}</td>
                      <td className="num px-4 py-3 text-ink-2">{liq ? price(liq) : "—"}</td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" disabled={busy} onClick={() => void close(p.marketId, p.sizeRaw).catch(() => {})} className="btn btn-secondary btn-sm">
                          Close
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : open.length === 0 ? (
          <p className="px-4 py-8 text-[14px] text-ink-2">No resting orders. Limit, stop-loss and take-profit orders wait here until the keeper fills them.</p>
        ) : (
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="text-[12px] text-ink-3">
              <tr>
                {["Market", "Type", "Size", "Trigger", "Placed", ""].map((c) => (
                  <th key={c} className="px-4 py-2 font-normal">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {open.map((o) => {
                const m = MARKETS[o.marketId]!;
                const size = wad(o.sizeDelta);
                return (
                  <tr key={o.id} className="border-t border-line">
                    <td className="px-4 py-3 font-medium">{m.symbol}</td>
                    <td className="px-4 py-3">
                      {KIND[o.kind]} <span className={size > 0 ? "text-flood" : "text-ebb"}>{size > 0 ? "buy" : "sell"}</span>
                    </td>
                    <td className="num px-4 py-3">{Math.abs(size).toPrecision(5)}</td>
                    <td className="num px-4 py-3">{price(wad(o.triggerPrice))}</td>
                    <td className="px-4 py-3 text-ink-3">{ago(o.placedAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" disabled={busy} className="btn btn-ghost btn-sm" onClick={() => void send(`Cancel order #${o.id}`, { chainId: HUB.chainId, address: CLEARINGHOUSE, abi: CH_ABI, functionName: "cancelOrder", args: [BigInt(o.id)] }).catch(() => {})}>
                        Cancel
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
