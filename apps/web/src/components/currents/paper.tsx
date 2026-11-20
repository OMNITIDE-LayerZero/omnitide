"use client";

import { useEffect, useState } from "react";
import { MARKETS } from "@/lib/contracts";
import { usePriceMap } from "@/lib/hooks";
import { accountHealth, type Pos } from "@/lib/margin";
import { money, price as fmtPrice, signedMoney } from "@/lib/format";

interface Paper {
  cash: number;
  positions: Pos[];
  fills: number;
  startedAt: number;
}

const START = 10_000;
const KEY = "omnitide.paper";
const fresh = (): Paper => ({ cash: START, positions: [], fills: 0, startedAt: Date.now() });

function load(): Paper {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Paper) : fresh();
  } catch {
    return fresh();
  }
}

/** Paper account: same markets, same live marks, same margin math, play money kept in this browser. */
export function PaperAccount() {
  const prices = usePriceMap();
  const [paper, setPaper] = useState<Paper>(fresh);
  const [marketId, setMarketId] = useState(0);
  const [usd, setUsd] = useState("1000");
  useEffect(() => setPaper(load()), []);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(paper));
    } catch {}
  }, [paper]);

  const h = accountHealth(paper.cash, paper.positions, prices);
  const m = MARKETS[marketId]!;
  const mark = prices[m.feed];
  const notional = Number(usd) || 0;
  const canOpen = !!mark && notional > 0 && notional * (m.initialMarginBps / 10_000) <= h.free;

  function fill(id: number, delta: number, px: number) {
    setPaper((p) => {
      const cur = p.positions.find((x) => x.marketId === id);
      const old = cur?.size ?? 0;
      const next = old + delta;
      let cash = p.cash - (Math.abs(delta) * px * 10) / 10_000;
      let entry = cur?.entry ?? px;
      if (old === 0 || Math.sign(old) === Math.sign(delta)) entry = (Math.abs(old) * entry + Math.abs(delta) * px) / Math.abs(next);
      else {
        cash += Math.sign(old) * Math.min(Math.abs(old), Math.abs(delta)) * (px - entry);
        if (Math.sign(next) !== Math.sign(old)) entry = px;
      }
      const rest = p.positions.filter((x) => x.marketId !== id);
      return { ...p, cash, fills: p.fills + 1, positions: Math.abs(next) < 1e-12 ? rest : [...rest, { marketId: id, size: next, entry }] };
    });
  }

  const pnl = h.equity - START;

  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <div className="flex items-baseline justify-between">
        <p className="font-medium">Paper account</p>
        <button type="button" className="text-[12px] text-ink-3 hover:text-ink" onClick={() => setPaper(fresh())}>
          Reset to {money(START)}
        </button>
      </div>
      <div className="mt-3 flex items-baseline justify-between">
        <p className="num text-[24px] font-medium">{money(h.equity)}</p>
        <p className={`num text-[14px] ${pnl >= 0 ? "text-flood" : "text-ebb"}`}>{signedMoney(pnl)}</p>
      </div>
      <p className="text-[12px] text-ink-3">
        {paper.fills} paper fills · live OMNITIDE marks · real margin math
      </p>
      <div className="mt-3 grid grid-cols-[1fr_110px] gap-2">
        <select className="field" value={marketId} onChange={(e) => setMarketId(Number(e.target.value))} aria-label="Paper market">
          {MARKETS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.symbol}-PERP
            </option>
          ))}
        </select>
        <input className="field" inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value.replace(/[^0-9.]/g, ""))} aria-label="Paper size in USD" />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-sm bg-flood text-white hover:bg-flood/90" disabled={!canOpen} onClick={() => fill(m.id, notional / mark!, mark!)}>
          Paper long
        </button>
        <button type="button" className="btn btn-sm bg-ebb text-white hover:bg-ebb/90" disabled={!canOpen} onClick={() => fill(m.id, -notional / mark!, mark!)}>
          Paper short
        </button>
      </div>
      {paper.positions.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-line pt-3 text-[13px]">
          {paper.positions.map((p) => {
            const mk = MARKETS[p.marketId]!;
            const px = prices[mk.feed];
            return (
              <li key={p.marketId} className="flex items-center justify-between gap-2">
                <span>
                  {mk.symbol} <span className={p.size > 0 ? "text-flood" : "text-ebb"}>{p.size > 0 ? "long" : "short"}</span> <span className="num text-ink-3">@ {fmtPrice(p.entry)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className={`num ${px && p.size * (px - p.entry) >= 0 ? "text-flood" : "text-ebb"}`}>{px ? signedMoney(p.size * (px - p.entry)) : ""}</span>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!px} onClick={() => fill(p.marketId, -p.size, px!)}>
                    Close
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
