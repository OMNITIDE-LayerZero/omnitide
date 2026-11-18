"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAccount } from "wagmi";
import { MARKETS, type MarketConfig } from "@omnitide/contracts/markets";
import { marketBySymbol } from "@/lib/contracts";
import { useHubAccount } from "@/lib/account";
import { useIndexer, usePriceMap, usePrices } from "@/lib/hooks";
import { accountHealth, liquidationPrice } from "@/lib/margin";
import { leverage, wad } from "@/lib/format";
import { PriceChart, type ChartLine } from "./chart";
import { MarketRail } from "./market-rail";
import { Ticket } from "./ticket";
import { PositionsPanel } from "./positions";
import { MarketSpec } from "./market-spec";
import { LivePrice } from "../live-price";
import { Change } from "../change";

const INTERVALS = [
  { v: 60, label: "1m" },
  { v: 900, label: "15m" },
  { v: 3600, label: "1h" },
] as const;

export function TradeView() {
  const params = useSearchParams();
  const router = useRouter();
  const market = marketBySymbol(params.get("m") ?? "BTC") ?? MARKETS[0]!;
  const [interval, setInterval] = useState<60 | 900 | 3600>(900);
  const { data: prices } = usePrices();
  const priceMap = usePriceMap();
  const { address } = useAccount();
  const { data: acct } = useHubAccount();
  const { data: orders } = useIndexer<{ marketId: number; triggerPrice: string; status: string; kind: number }[]>("orders", address?.toLowerCase(), !!address);
  const p = prices?.[market.feed];

  const pick = (m: MarketConfig) => router.replace(`/terminal/trade?m=${m.symbol}`, { scroll: false });

  // the chart carries the account's story: entry, liquidation, resting triggers
  const lines: ChartLine[] = [];
  const pos = acct?.positions.find((x) => x.marketId === market.id);
  if (pos && acct) {
    lines.push({ price: pos.entry, label: `Entry ${pos.size > 0 ? "long" : "short"}`, tone: "accent" });
    const h = accountHealth(acct.collateral, acct.positions, priceMap);
    const mark = priceMap[market.feed];
    const liq = mark ? liquidationPrice(pos.size > 0 ? 1 : -1, pos.size, pos.entry, h.equity - pos.size * (mark - pos.entry), market.maintenanceMarginBps) : null;
    if (liq) lines.push({ price: liq, label: "Liquidation", tone: "ebb" });
  }
  for (const o of orders ?? []) if (o.status === "open" && o.marketId === market.id) lines.push({ price: wad(o.triggerPrice), label: ["Limit", "Stop", "TP"][o.kind]!, tone: "muted" });

  return (
    <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_340px]">
      <aside className="hidden rounded-2xl border border-line bg-card p-2 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:block">
        <MarketRail active={market} onPick={pick} />
      </aside>

      <section className="min-w-0 lg:col-start-2 lg:row-start-1">
        <div className="rounded-2xl border border-line bg-card">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-line px-4 py-3">
            <div className="flex items-center gap-3">
              <select className="field h-9 w-auto pr-8 font-medium lg:hidden" value={market.symbol} onChange={(e) => pick(marketBySymbol(e.target.value)!)} aria-label="Market">
                {MARKETS.map((m) => (
                  <option key={m.feed}>{m.symbol}</option>
                ))}
              </select>
              <h1 className="hidden text-[20px] font-medium lg:block">{market.symbol}-PERP</h1>
              <span className="text-[13px] text-ink-3">{market.name}</span>
            </div>
            <LivePrice value={p?.price} className="text-[24px] leading-8 font-medium" />
            <dl className="flex gap-6 text-[13px]">
              <div>
                <dt className="text-[12px] text-ink-3">24h</dt>
                <dd>
                  <Change value={p?.change24h} />
                </dd>
              </div>
              <div>
                <dt className="text-[12px] text-ink-3">Max leverage</dt>
                <dd className="num">{leverage(market.initialMarginBps)}</dd>
              </div>
              <div>
                <dt className="text-[12px] text-ink-3">Source</dt>
                <dd>{market.kind === "crypto" ? "Coinbase" : "Nasdaq"}</dd>
              </div>
            </dl>
            <div className="ml-auto flex gap-1" role="tablist" aria-label="Candle interval">
              {INTERVALS.map((i) => (
                <button key={i.v} type="button" role="tab" aria-selected={interval === i.v} onClick={() => setInterval(i.v)} className={`btn btn-sm ${interval === i.v ? "bg-raised text-ink" : "btn-ghost"}`}>
                  {i.label}
                </button>
              ))}
            </div>
          </div>
          <div className="h-[clamp(340px,52vh,560px)] p-2">
            <PriceChart feed={market.feed} interval={interval} lines={lines} />
          </div>
        </div>
      </section>

      <aside className="flex flex-col gap-3 lg:sticky lg:top-[72px] lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:self-start">
        <div className="rounded-2xl border border-line bg-card p-4">
          <Ticket market={market} />
        </div>
        <MarketSpec market={market} />
      </aside>

      <section className="min-w-0 rounded-2xl border border-line bg-card lg:col-start-2 lg:row-start-2">
        <PositionsPanel />
      </section>
    </div>
  );
}
