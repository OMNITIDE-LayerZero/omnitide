"use client";

import { GROUPS, MARKETS, groupOf, type MarketConfig } from "@omnitide/contracts/markets";
import { usePrices } from "@/lib/hooks";
import { LivePrice } from "../live-price";
import { pct } from "@/lib/format";

export function MarketRail({ active, onPick }: { active: MarketConfig; onPick: (m: MarketConfig) => void }) {
  const { data } = usePrices();
  return (
    <div className="flex flex-col">
      {GROUPS.map((g) => (
        <div key={g.id} className="mb-3">
          <p className="px-3 pt-2 pb-2 text-[12px] text-ink-3">{g.label}</p>
          <ul className="flex flex-col gap-0.5">
            {MARKETS.filter((m) => groupOf(m) === g.id).map((m) => {
              const p = data?.[m.feed];
              const on = m.id === active.id;
              return (
                <li key={m.feed}>
                  <button
                    type="button"
                    onClick={() => onPick(m)}
                    aria-pressed={on}
                    className={`flex h-10 w-full items-center justify-between rounded-lg px-3 text-left transition-colors ${on ? "bg-raised" : "hover:bg-raised/60"}`}
                  >
                    <span className="text-[14px] font-medium">{m.symbol}</span>
                    <span className="flex flex-col items-end">
                      <LivePrice value={p?.price} className="text-[13px] leading-4" />
                      {p?.change24h != null && <span className={`num text-[11px] leading-4 ${p.change24h >= 0 ? "text-flood" : "text-ebb"}`}>{pct(p.change24h)}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
