"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useSeaWall } from "@/lib/hooks";
import { moneyCompact, units6 } from "@/lib/format";
import { IS_MAINNET, SPOKE_LIST } from "@/lib/chains";
import { laneRows } from "@/lib/landing";
import { useHubBlock } from "../network-status";
import { SwellLines } from "./swell-lines";

/** Closing band: back at the surface, one move left. */
export function Surface() {
  const { data: wall } = useSeaWall();
  const { data: block } = useHubBlock();
  const lanes = laneRows(wall).length;
  const facts = [
    { label: "Tide Pool depth", value: wall && units6(wall.reserves.pool) > 0 ? moneyCompact(units6(wall.reserves.pool)) : null },
    { label: "Margin in the book", value: wall && units6(wall.reserves.collateral) > 0 ? moneyCompact(units6(wall.reserves.collateral)) : null },
    { label: "LayerZero lanes open", value: lanes ? String(lanes) : null },
    { label: "Hub block", value: block ? `#${block.toLocaleString("en-US")}` : null },
  ].filter((f) => f.value);

  return (
    <section data-tone="dark" className="relative isolate overflow-hidden bg-navy text-white">
      <SwellLines className="absolute inset-0 -z-10" />
      <div className="absolute inset-x-0 top-0 -z-10 h-2/5 bg-gradient-to-b from-navy to-transparent" />
      <div className="mx-auto max-w-[1440px] px-4 pt-12 pb-16 sm:px-8 sm:pt-16 sm:pb-24">
        <p className="tag text-[12px] text-white/75">Surface · {IS_MAINNET ? "live on mainnet" : "testnet season is live"}</p>
        <h2 className="display mt-4 text-[clamp(48px,7.6vw,112px)]">
          Bring it from any chain.
          <br />
          Trade it on one.
        </h2>
        <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="max-w-xl text-[17px] leading-7 text-white/80">
              Send tdUSD from {SPOKE_LIST} once. It lands as margin on Robinhood Chain, and BTC to NVDA trade off the same balance.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/terminal/trade" className="btn btn-lg group bg-white text-navy hover:bg-white/90">
                Open terminal
                <ArrowRight size={16} strokeWidth={1.5} className="transition-transform duration-200 ease-[var(--ease-tide)] group-hover:translate-x-0.5" />
              </Link>
              <Link href="/terminal/currents" className="btn btn-lg border border-white/25 text-white hover:bg-white/10">
                See who&apos;s riding the tide
              </Link>
            </div>
          </div>
          {facts.length > 0 && (
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/15 bg-white/15 sm:min-w-[440px]">
              {facts.map((f) => (
                <div key={f.label} className="bg-navy/80 p-5 backdrop-blur-sm">
                  <dt className="text-[12px] text-white/60">{f.label}</dt>
                  <dd className="mt-1.5 text-[22px] leading-7 num">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </section>
  );
}
