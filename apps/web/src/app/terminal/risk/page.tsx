"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { MARKETS } from "@omnitide/contracts/markets";
import { useHubAccount } from "@/lib/account";
import { useIndexer, usePriceMap } from "@/lib/hooks";
import { LighthousePanel } from "@/components/terminal/lighthouse";
import { FEATURES } from "@/lib/contracts";
import { RADAR_AXES, SCENARIOS, bookRank, radar, simulateMargin, stressAccount, stressBook, type Radar, type SimLeg } from "@/lib/risk";
import { money, moneyCompact, price, signedMoney, wad } from "@/lib/format";
import { TideGauge } from "@/components/tide-gauge";
import { RiptidePanel } from "@/components/terminal/riptide";
import { Connect } from "@/components/connect";

interface BookRow { account: string; marketId: number; size: string; entryPrice: string }

const GRADE_TONE: Record<string, string> = { A: "text-flood", B: "text-accent-ink", C: "text-warn", D: "text-ebb" };
const GRADE_LINE: Record<string, string> = {
  A: "Rides out every Tidal Lens scenario with room to spare.",
  B: "Sound, with one or two dials running warm.",
  C: "Seaworthy in calm water; a hard scenario breaches the wall.",
  D: "Riding the rip current. Cut size or throw a Lifeline.",
};

function RadarChart({ r }: { r: Radar }) {
  const size = 240;
  const c = size / 2;
  const rad = c - 34;
  const pt = (i: number, v: number) => {
    const a = (Math.PI * 2 * i) / RADAR_AXES.length - Math.PI / 2;
    return [c + Math.cos(a) * rad * v, c + Math.sin(a) * rad * v] as const;
  };
  const poly = RADAR_AXES.map((ax, i) => pt(i, Math.max(0.04, r[ax.key])).join(",")).join(" ");
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-auto w-full max-w-[280px]" role="img" aria-label="RADAR risk dials">
      {[0.25, 0.5, 0.75, 1].map((ring) => (
        <polygon key={ring} points={RADAR_AXES.map((_, i) => pt(i, ring).join(",")).join(" ")} fill="none" stroke="var(--line)" strokeWidth={1} />
      ))}
      {RADAR_AXES.map((ax, i) => {
        const [x, y] = pt(i, 1);
        const [lx, ly] = pt(i, 1.2);
        return (
          <g key={ax.key}>
            <line x1={c} y1={c} x2={x} y2={y} stroke="var(--line)" />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="fill-[var(--text-3)] font-mono text-[9px]">
              {ax.label}
            </text>
          </g>
        );
      })}
      <polygon points={poly} fill="var(--accent)" fillOpacity={0.18} stroke="var(--accent)" strokeWidth={1.5} className="transition-all duration-500" />
      {RADAR_AXES.map((ax, i) => {
        const [x, y] = pt(i, Math.max(0.04, r[ax.key]));
        return <circle key={ax.key} cx={x} cy={y} r={2.5} fill="var(--accent)" />;
      })}
    </svg>
  );
}

function Simulator({ prices, seed }: { prices: Record<string, number>; seed: { collateral: number; legs: SimLeg[] } | null }) {
  const [collateral, setCollateral] = useState(seed ? String(Math.round(seed.collateral)) : "1000");
  const [legs, setLegs] = useState<SimLeg[]>(
    seed?.legs.length
      ? seed.legs
      : [
          { marketId: 0, side: 1, notional: 3_000 },
          { marketId: 7, side: -1, notional: 2_000 },
        ],
  );
  const [scenario, setScenario] = useState(SCENARIOS[0]!.id);
  const s = SCENARIOS.find((x) => x.id === scenario)!;
  const col = Math.max(0, Number(collateral) || 0);
  const sim = simulateMargin(col, legs, prices, s);
  const update = (i: number, patch: Partial<SimLeg>) => setLegs((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <section className="rounded-2xl border border-line bg-card p-5">
      <p className="tag text-ink-3">{seed?.legs.length ? "Loaded from your open positions" : "Example legs · edit them to match your plan"}</p>
      <h2 className="mt-1 text-[20px] font-medium">Margin simulator: shared vs isolated</h2>
      <p className="mt-2 max-w-2xl text-[13px] leading-5 text-ink-2">Same collateral, same legs. Shared margin lets a winner carry a loser; isolated margin splits collateral by initial margin so one blow-up can't drain the rest. Run a scenario and see what each keeps.</p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-[12px] text-ink-3">Collateral (tdUSD)</span>
          <input className="field mt-1 h-9 w-32" inputMode="decimal" value={collateral} onChange={(e) => setCollateral(e.target.value.replace(/[^0-9.]/g, ""))} />
        </label>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Scenario">
          {SCENARIOS.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={scenario === x.id} onClick={() => setScenario(x.id)} className={`btn btn-sm ${scenario === x.id ? "bg-raised text-ink" : "btn-ghost"}`}>
              {x.name}
            </button>
          ))}
        </div>
      </div>
      <div className="relative mt-4 overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-[13px]">
          <thead className="text-[12px] text-ink-3">
            <tr>
              <th className="py-2 pr-3 font-normal">Market</th>
              <th className="py-2 pr-3 font-normal">Side</th>
              <th className="py-2 pr-3 font-normal">Notional</th>
              <th className="py-2 pr-3 font-normal">Isolated margin</th>
              <th className="py-2 pr-3 font-normal">Isolated liq.</th>
              <th className="py-2 pr-3 font-normal">After {s.name.toLowerCase()}</th>
              <th className="py-2 font-normal" />
            </tr>
          </thead>
          <tbody>
            {legs.map((l, i) => {
              const iso = sim.isolated.legs.find((x) => x.marketId === l.marketId);
              return (
                <tr key={i} className="border-t border-line">
                  <td className="py-2 pr-3">
                    <select className="field h-8 w-28 py-0 text-[13px]" value={l.marketId} onChange={(e) => update(i, { marketId: Number(e.target.value) })} aria-label="Market">
                      {MARKETS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.symbol}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-3">
                    <button type="button" className={`btn btn-sm ${l.side > 0 ? "text-flood" : "text-ebb"}`} onClick={() => update(i, { side: l.side > 0 ? -1 : 1 })}>
                      {l.side > 0 ? "Long" : "Short"}
                    </button>
                  </td>
                  <td className="py-2 pr-3">
                    <input className="field h-8 w-28 text-[13px]" inputMode="decimal" value={l.notional} aria-label="Notional" onChange={(e) => update(i, { notional: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 })} />
                  </td>
                  <td className="num py-2 pr-3">{iso ? money(iso.alloc) : "pricing…"}</td>
                  <td className="num py-2 pr-3">{iso?.liqPrice ? price(iso.liqPrice) : "beyond zero"}</td>
                  <td className={`py-2 pr-3 ${iso?.liquidated ? "text-ebb" : "text-flood"}`}>{iso ? (iso.liquidated ? "Liquidated" : `Keeps ${money(iso.equity)}`) : "pricing…"}</td>
                  <td className="py-2 text-right">
                    {legs.length > 1 && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLegs((x) => x.filter((_, j) => j !== i))} aria-label="Remove leg">
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {legs.length < 6 && (
        <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => setLegs((x) => [...x, { marketId: 1, side: -1, notional: 1_000 }])}>
          + Add leg
        </button>
      )}
      <div className="mt-4 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2">
        <div className="bg-card p-4">
          <p className="text-[13px] text-ink-3">Shared (cross) margin</p>
          <p className={`num mt-1 text-[22px] font-medium ${sim.shared.liquidated ? "text-ebb" : ""}`}>{sim.shared.liquidated || sim.shared.kept <= 0 ? "Whole book liquidated" : `Keeps ${money(sim.shared.kept)}`}</p>
          <p className="mt-1 text-[12px] text-ink-3">Equity {money(sim.shared.equity)} vs maintenance {money(sim.shared.mm)}</p>
        </div>
        <div className="bg-card p-4">
          <p className="text-[13px] text-ink-3">Isolated margin</p>
          <p className={`num mt-1 text-[22px] font-medium ${sim.isolated.kept > 0 ? "" : "text-ebb"}`}>{sim.isolated.kept > 0 ? `Keeps ${money(sim.isolated.kept)}` : "Every leg liquidated"}</p>
          <p className="mt-1 text-[12px] text-ink-3">{sim.isolated.liquidated ? `${sim.isolated.liquidated} of ${legs.length} legs liquidated` : "Every leg stays above its wall"}</p>
        </div>
      </div>
      <p className="tag mt-3 text-ink-3">OMNITIDE runs shared margin on-chain; the isolated column shows what the same book would look like walled off.</p>
    </section>
  );
}

export default function Risk() {
  const { isConnected } = useAccount();
  const { data: acct } = useHubAccount();
  const prices = usePriceMap();
  const { data: bookRows } = useIndexer<BookRow[]>("book");
  const priced = Object.keys(prices).length > 0;
  const positions = acct?.positions ?? [];
  const collateral = acct?.collateral ?? 0;
  const mine = positions.length > 0 && priced;

  const r = radar(collateral, positions, prices);
  const stresses = SCENARIOS.map((s) => ({ s, res: stressAccount(collateral, positions, prices, s) }));
  const rank = bookRank(r, stresses.map((x) => !x.res.liquidated));
  const now = stresses[0]?.res.before;

  const book = useMemo(() => (bookRows ?? []).map((b) => ({ marketId: b.marketId, size: wad(b.size), entry: wad(b.entryPrice) })), [bookRows]);
  const accounts = new Set((bookRows ?? []).map((b) => b.account)).size;
  const seed = mine ? { collateral, legs: positions.map((p) => ({ marketId: p.marketId, side: (p.size > 0 ? 1 : -1) as 1 | -1, notional: Math.round(Math.abs(p.size) * (prices[MARKETS[p.marketId]!.feed] ?? p.entry)) })) } : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl border border-line bg-card p-5">
        <p className="tag text-ink-3">Tidal Lens · RADAR · Book Rank</p>
        <h1 className="display mt-2 text-[44px] text-ink">Risk</h1>
        <p className="mt-2 max-w-2xl text-[14px] leading-[22px] text-ink-2">Every number here is computed from your live positions on the hub and the keeper's signed prices, the same math the clearinghouse uses for maintenance margin.</p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <section className="rounded-2xl border border-line bg-card p-5">
          <p className="tag text-ink-3">Book Rank</p>
          {!isConnected ? (
            <div className="mt-4 space-y-3">
              <p className="text-[14px] text-ink-2">Connect a wallet to grade your book from A to D.</p>
              <Connect size="md" />
            </div>
          ) : !mine ? (
            <p className="mt-4 text-[14px] leading-[22px] text-ink-2">Open a position and your grade lands here: six RADAR dials plus four stress scenarios, scored 0–100.</p>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-6">
              <div>
                <p className={`display text-[96px] leading-none ${GRADE_TONE[rank.grade]}`}>{rank.grade}</p>
                <p className="num mt-1 text-[13px] text-ink-3">{rank.score}/100</p>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] leading-[22px] text-ink-2">{GRADE_LINE[rank.grade]}</p>
                <p className="mt-2 text-[13px] text-ink-3">{rank.failures ? `${rank.failures} of ${SCENARIOS.length} scenarios breach the wall` : `Survives all ${SCENARIOS.length} scenarios`}</p>
                {now && <TideGauge level={now.level} className="mt-3" />}
              </div>
            </div>
          )}
          {!mine && (
            <dl className="mt-6 grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
              {RADAR_AXES.map((ax) => (
                <div key={ax.key}>
                  <dt className="tag text-ink-2">{ax.label}</dt>
                  <dd className="mt-1 text-[12px] leading-[18px] text-ink-3">{ax.hint}</dd>
                </div>
              ))}
            </dl>
          )}
          {mine && (
            <div className="mt-5 flex flex-wrap items-center gap-4">
              <RadarChart r={r} />
              <dl className="grid min-w-44 flex-1 gap-1 text-[13px]">
                {RADAR_AXES.map((ax) => (
                  <div key={ax.key} className="flex justify-between gap-3" title={ax.hint}>
                    <dt className="text-ink-3">{ax.label}</dt>
                    <dd className="num">{Math.round(r[ax.key] * 100)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {mine && FEATURES.deepWater && <LighthousePanel />}
        </section>

        <section className="rounded-2xl border border-line bg-card p-5">
          <p className="tag text-ink-3">Tidal Lens · instant shock, no time to react</p>
          <h2 className="mt-1 text-[20px] font-medium">Stress test</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {stresses.map(({ s, res }) => {
              const pool = stressBook(book, prices, s);
              return (
                <article key={s.id} className="rounded-xl border border-line p-4 transition-colors hover:border-line-strong">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="font-medium">{s.name}</h3>
                    {mine && <span className={`tag ${res.liquidated ? "text-ebb" : "text-flood"}`}>{res.liquidated ? "breaches the wall" : "holds"}</span>}
                  </div>
                  <p className="mt-1 text-[12px] leading-[18px] text-ink-3">{s.blurb}</p>
                  {mine && (
                    <p className="num mt-3 text-[13px]">
                      You <span className={res.pnl >= 0 ? "text-flood" : "text-ebb"}>{signedMoney(res.pnl)}</span> · tide {Math.round(res.after.level * 100)}%
                    </p>
                  )}
                  {pool.notional > 0 && (
                    <p className="num mt-1 text-[13px] text-ink-2">
                      Whole book: Harbor <span className={pool.poolPnl >= 0 ? "text-flood" : "text-ebb"}>{signedMoney(pool.poolPnl)}</span>
                    </p>
                  )}
                </article>
              );
            })}
          </div>
          <p className="tag mt-3 text-ink-3">
            {book.length > 0 ? `Whole book: ${book.length} open positions across ${accounts} accounts, ${moneyCompact(stressBook(book, prices, SCENARIOS[0]!).notional)} notional, Harbor takes the other side` : "Whole-book lines appear as soon as the book holds open positions"}
          </p>
        </section>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {priced ? <Simulator key={seed ? "mine" : "example"} prices={prices} seed={seed} /> : <div className="h-80 animate-pulse rounded-2xl border border-line bg-card" />}
        <RiptidePanel />
      </div>
    </div>
  );
}
