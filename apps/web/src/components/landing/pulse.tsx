"use client";

import { useSeaWall, useStats } from "@/lib/hooks";
import { money, moneyCompact, units6, wad } from "@/lib/format";
import { FEATURES } from "@/lib/contracts";

/** Protocol figures straight from the indexer and chain. The two deepest figures lead; zero-valued figures are left out, not shown as 0. */
export function Pulse() {
  const { data: stats } = useStats();
  const { data: wall } = useSeaWall();
  const g = stats?.global;
  const lead = [
    { label: "Tide Pool depth", note: FEATURES.harbor ? "Harbor OVault · the other side of every fill" : "Clearinghouse pool · the other side of every fill", value: wall ? units6(wall.reserves.pool) : 0, fmt: moneyCompact },
    { label: "Collateral in the book", note: "tdUSD margin on Robinhood Chain", value: wall ? units6(wall.reserves.collateral) : 0, fmt: money },
  ].filter((f) => f.value > 0);
  const rest = [
    { label: "Bridged through LayerZero", value: g ? units6(g.bridged) : 0, fmt: moneyCompact },
    { label: "Volume traded", value: g ? wad(g.volumeUsd) : 0, fmt: moneyCompact },
    { label: "Fills", value: g?.trades ?? 0, fmt: (v: number) => v.toLocaleString("en-US") },
    { label: "Inflows settled", value: g?.inflows ?? 0, fmt: (v: number) => v.toLocaleString("en-US") },
  ].filter((f) => f.value > 0);
  if (lead.length + rest.length === 0) return null;
  return (
    <div className="@container">
      <div className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line @3xl:grid-cols-[1.25fr_1fr]">
        {lead.length > 0 && (
          <dl className={`grid gap-px bg-line ${lead.length > 1 ? "@md:grid-cols-2" : ""}`}>
            {lead.map((f) => (
              <div key={f.label} className="bg-card p-6">
                <dt className="text-[13px] text-ink-2">{f.label}</dt>
                <dd className="display mt-3 text-[clamp(40px,5vw,60px)] text-ink num">{f.fmt(f.value)}</dd>
                <dd className="tag mt-3 text-ink-3">{f.note}</dd>
              </div>
            ))}
          </dl>
        )}
        {rest.length > 0 && (
          <dl className="grid grid-cols-2 gap-px bg-line">
            {rest.map((f, i) => (
              <div key={f.label} className={`bg-card p-5 ${rest.length % 2 && i === rest.length - 1 ? "col-span-2" : ""}`}>
                <dt className="text-[13px] text-ink-3">{f.label}</dt>
                <dd className="mt-2 text-[22px] leading-7 font-medium num">{f.fmt(f.value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
