"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GROUPS, MARKETS, groupOf, type MarketGroup } from "@omnitide/contracts/markets";
import { usePrices, useSparks, useStats } from "@/lib/hooks";
import { leverage, moneyCompact, wad } from "@/lib/format";
import { SESSION_LABEL, usSession, type Session } from "@/lib/landing";
import { LivePrice } from "../live-price";
import { Change } from "../change";
import { Spark } from "./spark";

const FILTERS: { id: MarketGroup | "all"; label: string }[] = [{ id: "all", label: "All" }, ...GROUPS];
const TAG = Object.fromEntries(GROUPS.map((g) => [g.id, g.tag])) as Record<MarketGroup, string>;

/** The market list. `landing` adds kind filters, the NYSE session and a 24h sparkline in place of volume. */
export function MarketsBoard({ compact = false, landing = false }: { compact?: boolean; landing?: boolean }) {
  const { data } = usePrices();
  const { data: stats } = useStats();
  const { data: sparks } = useSparks(landing);
  const [kind, setKind] = useState<MarketGroup | "all">("all");
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    if (!landing) return;
    const tick = () => setSession(usSession());
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [landing]);
  const vol = new Map(stats?.markets.map((m) => [m.id, wad(m.volumeUsd)]));
  const rows = MARKETS.filter((m) => kind === "all" || groupOf(m) === kind);

  return (
    <div>
      {landing && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Market kind" className="inline-flex rounded-lg border border-line bg-raised/60 p-0.5">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={kind === f.id}
                onClick={() => setKind(f.id)}
                className={`h-8 rounded-md px-3 text-[13px] transition-colors ${kind === f.id ? "bg-card text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}
              >
                {f.label}
                <span className="tag ml-1.5 text-ink-3">{f.id === "all" ? MARKETS.length : MARKETS.filter((m) => groupOf(m) === f.id).length}</span>
              </button>
            ))}
          </div>
          <p className="tag flex items-center gap-2 text-[12px] text-ink-2">
            {session && (
              <>
                <span className={`size-1.5 rounded-full ${session === "open" ? "bg-flood" : session === "closed" ? "bg-ink-3" : "bg-warn"}`} aria-hidden />
                US and China stocks · {SESSION_LABEL[session]}
              </>
            )}
            <span className="hidden text-ink-3 sm:inline">· crypto 24/7 · every price EIP-712 signed</span>
          </p>
        </div>
      )}
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[640px] text-left">
          <thead>
            <tr className="text-[12px] text-ink-3">
              <th className="py-2 pr-4 font-normal">Market</th>
              <th className="py-2 pr-4 text-right font-normal">Price</th>
              <th className="py-2 pr-4 text-right font-normal">24h</th>
              {landing && <th className="hidden py-2 pr-4 text-right font-normal sm:table-cell">Last 24h · 1h closes</th>}
              <th className="py-2 pr-4 text-right font-normal">Max leverage</th>
              {!compact && <th className="py-2 pr-4 text-right font-normal">Maintenance</th>}
              {!compact && <th className="py-2 pr-4 text-right font-normal">Open interest cap</th>}
              {!landing && <th className="py-2 pr-4 text-right font-normal">Volume</th>}
              <th className="py-2 text-right font-normal">
                <span className="sr-only">Trade</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const p = data?.[m.feed];
              const v = vol.get(m.id);
              return (
                <tr key={m.feed} data-market={m.symbol} className="group border-t border-line transition-colors hover:bg-raised/60">
                  <td className="py-3 pr-4">
                    <span className="font-medium">{m.symbol}</span>
                    <span className="ml-2 text-[13px] text-ink-3">{m.name}</span>
                    <span className="tag ml-2 text-ink-3">{TAG[groupOf(m)]}</span>
                  </td>
                  <td className={`py-3 pr-4 text-right ${landing ? "flash" : ""}`}>
                    <LivePrice value={p?.price} />
                  </td>
                  <td className="py-3 pr-4 text-right text-[14px]">
                    <Change value={p?.change24h} />
                  </td>
                  {landing && (
                    <td className="hidden py-2 pr-4 text-right sm:table-cell">
                      <Spark closes={sparks?.[m.feed]} live={p?.price} label={`${m.symbol} price`} />
                    </td>
                  )}
                  <td className="py-3 pr-4 text-right num">{leverage(m.initialMarginBps)}</td>
                  {!compact && <td className="py-3 pr-4 text-right num text-ink-2">{(m.maintenanceMarginBps / 100).toFixed(m.maintenanceMarginBps % 100 ? 1 : 0)}%</td>}
                  {!compact && <td className="py-3 pr-4 text-right num text-ink-2">{moneyCompact(m.maxOpenInterestUsd)}</td>}
                  {!landing && <td className="py-3 pr-4 text-right num text-ink-2">{v && v > 0 ? moneyCompact(v) : <span className="text-[13px] text-ink-3">Awaiting first fill</span>}</td>}
                  <td className="py-3 text-right">
                    <Link href={`/terminal/trade?m=${m.symbol}`} className={`btn btn-ghost btn-sm ${landing ? "group-hover:bg-accent group-hover:text-on-accent" : ""}`}>
                      Trade
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
