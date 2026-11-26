"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { MARKETS } from "@omnitide/contracts/markets";
import { accountHealth, liquidationPrice } from "@/lib/margin";
import { FEE_BPS } from "@/lib/contracts";
import { price as fmtPrice, moneyCompact } from "@/lib/format";
import { TideGauge } from "../tide-gauge";

const PICKS = ["BTC", "ETH", "NVDA", "BABA"].map((s) => MARKETS.find((m) => m.symbol === s)!);
const MARGINS = [250, 1_000, 5_000];

/** A dry-run ticket in the hero: same margin math as the terminal, no wallet. Leverage drives the wave's swell through onLeverage. */
export function HeroTicket({ prices, onLeverage }: { prices: Record<string, number | undefined>; onLeverage: (share: number) => void }) {
  const [market, setMarket] = useState(PICKS[0]!);
  const [side, setSide] = useState<1 | -1>(1);
  const [margin, setMargin] = useState(1_000);
  const max = 10_000 / market.initialMarginBps;
  const [lev, setLev] = useState(5);
  const L = Math.min(lev, max);
  const px = prices[market.feed];

  const notional = margin * L;
  const fee = (notional * FEE_BPS) / 10_000;
  const size = px ? notional / px : 0;
  const liq = px ? liquidationPrice(side, size, px, margin - fee, market.maintenanceMarginBps) : null;
  const level = px ? accountHealth(margin - fee, [{ marketId: market.id, size: side * size, entry: px }], { [market.feed]: px }).level : 1;

  const pickLev = (v: number) => {
    setLev(v);
    onLeverage((v - 1) / Math.max(1, max - 1));
  };

  return (
    <div className="flex h-full flex-col gap-3 rounded-t-2xl border border-b-0 border-line bg-card/95 p-4 shadow-md backdrop-blur-sm sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="tag text-ink-3">Try a ticket · no wallet</span>
        <div role="radiogroup" aria-label="Margin" className="flex">
          {MARGINS.map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={margin === v}
              onClick={() => setMargin(v)}
              className={`rounded-md px-2 py-0.5 text-[12px] num transition-colors ${margin === v ? "bg-raised text-ink" : "text-ink-3 hover:text-ink"}`}
            >
              {moneyCompact(v).replace(".00", "")}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          {PICKS.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={market.id === m.id}
              onClick={() => setMarket(m)}
              className={`rounded-md border px-2 py-1 text-[12px] transition-colors ${market.id === m.id ? "border-accent bg-sky text-accent-ink" : "border-line text-ink-2 hover:border-line-strong hover:text-ink"}`}
            >
              {m.symbol}
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label="Side" className="flex rounded-md border border-line p-0.5">
          {([1, -1] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={side === s}
              onClick={() => setSide(s)}
              className={`rounded px-2 py-0.5 text-[12px] font-medium transition-colors ${side === s ? (s === 1 ? "bg-flood text-white" : "bg-ebb text-white") : "text-ink-3 hover:text-ink"}`}
            >
              {s === 1 ? "Long" : "Short"}
            </button>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-3">
        <span className="tag w-14 shrink-0 text-ink-3">Leverage</span>
        <input type="range" min={1} max={max} step={max % 1 ? 0.1 : 1} value={L} onChange={(e) => pickLev(Number(e.target.value))} className="h-1 w-full cursor-pointer accent-[var(--accent)]" aria-label="Leverage" />
        <span className="w-10 shrink-0 text-right text-[14px] font-medium num">{Number(L.toFixed(1))}×</span>
      </label>

      <div className="mt-auto flex items-end gap-4">
        <dl className="grid flex-1 grid-cols-2 gap-x-4 text-[13px]">
          <dt className="text-ink-3">Position</dt>
          <dd className="text-right num">{moneyCompact(notional)}</dd>
          <dt className="text-ink-3">Liquidation</dt>
          <dd className="text-right num">{liq ? fmtPrice(liq) : "Reading price"}</dd>
        </dl>
        <TideGauge level={level} label={`Margin health at ${Number(L.toFixed(1))}× ${market.symbol}`} />
      </div>
      <Link href={`/terminal/trade?m=${market.symbol}`} className="btn btn-primary btn-sm group w-full">
        {side === 1 ? "Long" : "Short"} {market.symbol} in the terminal
        <ArrowRight size={14} strokeWidth={1.5} className="transition-transform duration-200 ease-[var(--ease-tide)] group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}
