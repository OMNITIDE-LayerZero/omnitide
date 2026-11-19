"use client";

import type { ChainKey } from "@omnitide/contracts/chains";
import { useSeaWall } from "@/lib/hooks";
import { CHAIN_COUNT, SHORT } from "@/lib/chains";
import { money, units6 } from "@/lib/format";
import { LayerZeroMessages } from "./messages";

function Bar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function SeaWallLive() {
  const { data, isLoading } = useSeaWall();
  if (isLoading || !data) return <div className="h-64 rounded-2xl border border-line bg-card" aria-busy="true" />;
  const r = data.reserves;
  const held = units6(r.held);
  const owed = units6(r.collateral) + Math.max(0, units6(r.pool));
  const ratio = owed > 0 ? held / owed : 1;
  const supply = data.chains.reduce((s, c) => s + units6(c.supply), 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-2xl border border-line bg-card p-5">
          <p className="text-[13px] text-ink-3">Proof of reserves · hub clearinghouse</p>
          <p className="num mt-2 text-[44px] leading-[48px] font-medium">{(ratio * 100).toFixed(2)}%</p>
          <p className="text-[14px] text-ink-2">of every balance and the Tide Pool is held by the contract right now</p>
          <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-line pt-4 text-[14px] sm:grid-cols-4">
            {[
              ["Held", money(held)],
              ["Trader collateral", money(units6(r.collateral))],
              ["Tide Pool", money(units6(r.pool))],
              ["Deposit cap", money(units6(r.depositCap))],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[12px] text-ink-3">{k}</dt>
                <dd className="num mt-1">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="rounded-2xl border border-line bg-card p-5">
          <p className="text-[13px] text-ink-3">tdUSD across {CHAIN_COUNT} chains</p>
          <p className="num mt-2 text-[28px] leading-8 font-medium">{money(supply)}</p>
          <ul className="mt-4 space-y-3">
            {data.chains.filter((c) => BigInt(c.supply) > 0n).map((c) => (
              <li key={c.chain} className="text-[13px]">
                <div className="flex justify-between">
                  <span>{SHORT[c.chain as ChainKey]}</span>
                  <span className="num text-ink-2">{money(units6(c.supply))}</span>
                </div>
                <div className="mt-1">
                  <Bar value={units6(c.supply)} max={supply} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="rounded-2xl border border-line bg-card">
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line px-5 py-4">
          <div>
            <p className="text-[13px] text-ink-3">LayerZero lanes · read from each chain's endpoint</p>
            <p className="mt-1 text-[16px] font-medium">Rate limits, DVNs and confirmations</p>
          </div>
          <p className="tag text-ink-3">refreshed {new Date(data.at).toLocaleTimeString("en-US")}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead className="text-[12px] text-ink-3">
              <tr>
                {["From", "To", "Hourly limit", "Available now", "DVNs", "Confirmations", "Status"].map((h) => (
                  <th key={h} className="px-5 py-2 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.chains.flatMap((c) =>
                c.lanes.map((l) => {
                  const limit = units6(l.limit);
                  const avail = units6(l.available);
                  return (
                    <tr key={`${c.chain}${l.to}`} className="border-t border-line">
                      <td className="px-5 py-3">{SHORT[c.chain as ChainKey]}</td>
                      <td className="px-5 py-3">{SHORT[l.to as ChainKey]}</td>
                      <td className="num px-5 py-3">{money(limit)}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span className="num w-24">{money(avail)}</span>
                          <div className="w-24">
                            <Bar value={avail} max={limit} />
                          </div>
                        </div>
                      </td>
                      <td className="num px-5 py-3">{l.dvns}</td>
                      <td className="num px-5 py-3">{l.confirmations}</td>
                      <td className="px-5 py-3">{c.paused ? <span className="text-warn">Paused by guardian</span> : <span className="text-flood">Open</span>}</td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      </section>
      <LayerZeroMessages />
    </div>
  );
}
