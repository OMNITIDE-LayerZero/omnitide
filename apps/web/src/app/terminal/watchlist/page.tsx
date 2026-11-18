"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { MARKETS } from "@omnitide/contracts/markets";
import { usePrices } from "@/lib/hooks";
import { PriceChart } from "@/components/terminal/chart";
import { LivePrice } from "@/components/live-price";
import { Change } from "@/components/change";

const KEY = "omnitide-watchlist";
const DEFAULT = ["BTC", "ETH", "NVDA", "HOOD"];

export default function Watchlist() {
  const [list, setList] = useState<string[]>(DEFAULT);
  const { data } = usePrices();

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as string[] | null;
      if (Array.isArray(saved) && saved.length) setList(saved);
    } catch {
      // storage blocked: the default list stays
    }
  }, []);

  function toggle(sym: string) {
    setList((cur) => {
      const next = cur.includes(sym) ? cur.filter((s) => s !== sym) : [...cur, sym];
      const safe = next.length ? next : DEFAULT;
      try {
        localStorage.setItem(KEY, JSON.stringify(safe));
      } catch {
        // per-viewer convenience only
      }
      return safe;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl border border-line bg-card p-5">
        <p className="tag text-ink-3">Kept in this browser</p>
        <h1 className="display mt-2 text-[44px] text-ink">Watchlist</h1>
        <div className="mt-4 flex flex-wrap gap-1">
          {MARKETS.map((m) => {
            const on = list.includes(m.symbol);
            return (
              <button key={m.feed} type="button" aria-pressed={on} onClick={() => toggle(m.symbol)} className={`btn btn-sm ${on ? "bg-raised text-ink" : "btn-ghost"}`}>
                <Star size={14} strokeWidth={1.5} className={on ? "fill-current text-accent-ink" : ""} />
                {m.symbol}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {list.map((sym) => {
          const m = MARKETS.find((x) => x.symbol === sym);
          if (!m) return null;
          const p = data?.[m.feed];
          return (
            <article key={sym} className="rounded-2xl border border-line bg-card">
              <header className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
                <div>
                  <span className="text-[16px] font-medium">{m.symbol}</span>
                  <span className="ml-2 text-[13px] text-ink-3">{m.name}</span>
                </div>
                <div className="flex items-center gap-4 text-[14px]">
                  <LivePrice value={p?.price} className="font-medium" />
                  <Change value={p?.change24h} />
                  <Link href={`/terminal/trade?m=${m.symbol}`} className="btn btn-secondary btn-sm">
                    Trade
                  </Link>
                </div>
              </header>
              <div className="h-56 p-2">
                <PriceChart feed={m.feed} interval={900} />
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
