"use client";

import { useSeaWall, useStats } from "@/lib/hooks";
import { money, moneyCompact, units6, wad } from "@/lib/format";

/** Protocol figures straight from the indexer and chain. Zero-valued figures are left out, not shown as 0. */
export function Pulse() {
  const { data: stats } = useStats();
  const { data: wall } = useSeaWall();
  const g = stats?.global;
  const figures = [
    { label: "Volume traded", value: g ? wad(g.volumeUsd) : 0, fmt: moneyCompact },
    { label: "Fills", value: g?.trades ?? 0, fmt: (v: number) => v.toLocaleString("en-US") },
    { label: "Bridged through LayerZero", value: g ? units6(g.bridged) : 0, fmt: moneyCompact },
    { label: "Tide Pool depth", value: wall ? units6(wall.reserves.pool) : 0, fmt: moneyCompact },
    { label: "Collateral in the book", value: wall ? units6(wall.reserves.collateral) : 0, fmt: money },
    { label: "Inflows settled", value: g?.inflows ?? 0, fmt: (v: number) => v.toLocaleString("en-US") },
  ].filter((f) => f.value > 0);
  if (figures.length === 0) return null;
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3">
      {figures.map((f) => (
        <div key={f.label} className="bg-card p-5">
          <dt className="text-[13px] text-ink-3">{f.label}</dt>
          <dd className="mt-2 text-[28px] leading-8 font-medium num">{f.fmt(f.value)}</dd>
        </div>
      ))}
    </dl>
  );
}
