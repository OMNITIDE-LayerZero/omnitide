"use client";

import Link from "next/link";
import { MARKETS } from "@omnitide/contracts/markets";
import { usePrices, useStats } from "@/lib/hooks";
import { leverage, moneyCompact, wad } from "@/lib/format";
import { LivePrice } from "../live-price";
import { Change } from "../change";

export function MarketsBoard({ compact = false }: { compact?: boolean }) {
  const { data } = usePrices();
  const { data: stats } = useStats();
  const vol = new Map(stats?.markets.map((m) => [m.id, wad(m.volumeUsd)]));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left">
        <thead>
          <tr className="text-[12px] text-ink-3">
            <th className="py-2 pr-4 font-normal">Market</th>
            <th className="py-2 pr-4 text-right font-normal">Price</th>
            <th className="py-2 pr-4 text-right font-normal">24h</th>
            <th className="py-2 pr-4 text-right font-normal">Max leverage</th>
            {!compact && <th className="py-2 pr-4 text-right font-normal">Maintenance</th>}
            {!compact && <th className="py-2 pr-4 text-right font-normal">Open interest cap</th>}
            <th className="py-2 pr-4 text-right font-normal">Volume</th>
            <th className="py-2 text-right font-normal">
              <span className="sr-only">Trade</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {MARKETS.map((m) => {
            const p = data?.[m.feed];
            const v = vol.get(m.id);
            return (
              <tr key={m.feed} className="group border-t border-line transition-colors hover:bg-raised/60">
                <td className="py-3 pr-4">
                  <span className="font-medium">{m.symbol}</span>
                  <span className="ml-2 text-[13px] text-ink-3">{m.name}</span>
                  <span className="tag ml-2 text-ink-3">{m.kind === "stock" ? "US stock" : "crypto"}</span>
                </td>
                <td className="py-3 pr-4 text-right">
                  <LivePrice value={p?.price} />
                </td>
                <td className="py-3 pr-4 text-right text-[14px]">
                  <Change value={p?.change24h} />
                </td>
                <td className="py-3 pr-4 text-right num">{leverage(m.initialMarginBps)}</td>
                {!compact && <td className="py-3 pr-4 text-right num text-ink-2">{(m.maintenanceMarginBps / 100).toFixed(m.maintenanceMarginBps % 100 ? 1 : 0)}%</td>}
                {!compact && <td className="py-3 pr-4 text-right num text-ink-2">{moneyCompact(m.maxOpenInterestUsd)}</td>}
                <td className="py-3 pr-4 text-right num text-ink-2">{v && v > 0 ? moneyCompact(v) : <span className="text-ink-3">—</span>}</td>
                <td className="py-3 text-right">
                  <Link href={`/terminal/trade?m=${m.symbol}`} className="btn btn-ghost btn-sm">
                    Trade
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
