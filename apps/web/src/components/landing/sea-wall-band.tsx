"use client";

import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { useSeaWall } from "@/lib/hooks";
import { money, units6 } from "@/lib/format";

export function SeaWallBand() {
  const { data } = useSeaWall();
  const r = data?.reserves;
  const held = r ? units6(r.held) : undefined;
  const owed = r ? units6(r.collateral) + Math.max(0, units6(r.pool)) : undefined;
  const lanes = data?.chains.reduce((n, c) => n + c.lanes.length, 0);
  const minConf = data?.chains.flatMap((c) => c.lanes.map((l) => l.confirmations)).reduce((a, b) => Math.min(a, b), Infinity);

  return (
    <div className="grid gap-10 lg:grid-cols-2 lg:items-end">
      <div>
        <p className="tag text-white/70">Sea Wall · proof of reserves</p>
        <h2 className="display mt-4 text-[clamp(44px,6vw,80px)] text-white">
          Reserves you can
          <br />
          read on-chain.
        </h2>
        <p className="mt-6 max-w-lg text-white/75">
          Every tdUSD the book owes sits in the clearinghouse contract on the hub, and every lane out of a chain has a rate limit, a DVN and a confirmation count you can check yourself.
        </p>
        <Link href="/sea-wall" className="btn btn-lg mt-8 bg-white text-navy hover:bg-white/90">
          Open the Sea Wall
          <ArrowRight size={16} strokeWidth={1.5} />
        </Link>
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/15 bg-white/15">
        {[
          ["Held by the clearinghouse", held !== undefined ? money(held) : null],
          ["Owed to traders + Tide Pool", owed !== undefined ? money(owed) : null],
          ["Active LayerZero lanes", lanes ? String(lanes) : null],
          ["Min. block confirmations", minConf !== undefined && Number.isFinite(minConf) ? String(minConf) : null],
        ].map(([label, value]) => (
          <div key={label} className="bg-navy p-5">
            <dt className="text-[13px] text-white/60">{label}</dt>
            <dd className="mt-2 text-[24px] leading-8 text-white num">{value ?? <span className="inline-block h-6 w-24 rounded bg-white/10" />}</dd>
          </div>
        ))}
        <div className="col-span-2 flex items-center gap-2 bg-navy p-4 text-[13px] text-white/75">
          <Check size={16} strokeWidth={1.5} className="text-[#8ea2ff]" />
          {held !== undefined && owed !== undefined
            ? held + 0.000001 >= owed
              ? "Fully backed: holdings cover every balance and the pool"
              : "Rebalancing reserves on the hub"
            : "Reading the hub"}
        </div>
      </dl>
    </div>
  );
}
