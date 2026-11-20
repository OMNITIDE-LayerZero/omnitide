"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { ArrowUpRight } from "lucide-react";
import { PnlCard, type TraderRow } from "@/components/currents/pnl-card";
import { PaperAccount } from "@/components/currents/paper";
import { moneyCompact, shortHash, signedMoney, units6, wad } from "@/lib/format";

type By = "pnl" | "volume";

function useBoard(by: By) {
  return useQuery({
    queryKey: ["leaderboard", by],
    refetchInterval: 15_000,
    queryFn: async () => (await (await fetch(`/api/indexer/leaderboard?limit=50${by === "volume" ? "&by=volume" : ""}`)).json()) as TraderRow[],
  });
}

export default function Currents() {
  const { address } = useAccount();
  const [by, setBy] = useState<By>("pnl");
  const { data: board, isLoading } = useBoard(by);
  const me = address?.toLowerCase();
  const leader = board?.[0];

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_380px]">
      <section className="flex min-w-0 flex-col gap-3">
        <div className="rounded-2xl border border-line bg-card p-5">
          <p className="tag text-ink-3">Social leaderboard · every number summed from on-chain fills</p>
          <h1 className="display mt-2 text-[44px] text-ink">Currents</h1>
          <p className="mt-2 max-w-2xl text-[14px] leading-[22px] text-ink-2">
            Who is riding the tide and who got dragged under. No screenshots, no self-reported PnL: the board reads OmnitideClearinghouse Traded events, so every row is a receipt. Deep Mode books never appear here.
          </p>
          {leader && (
            <p className="mt-4 text-[14px] text-ink-2">
              Leading the current: <Link href={`/currents/${leader.account}`} className="font-mono text-ink underline decoration-line-strong underline-offset-4 hover:decoration-accent">{leader.vault ?? shortHash(leader.account)}</Link>{" "}
              <span className="num">{by === "pnl" ? signedMoney(units6(leader.realizedPnl)) : moneyCompact(wad(leader.volumeUsd))}</span>
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
            <h2 className="text-[20px] font-medium">The board</h2>
            <div className="flex gap-1" role="radiogroup" aria-label="Rank by">
              {(["pnl", "volume"] as const).map((b) => (
                <button key={b} type="button" role="radio" aria-checked={by === b} onClick={() => setBy(b)} className={`btn btn-sm ${by === b ? "bg-raised text-ink" : "btn-ghost"}`}>
                  {b === "pnl" ? "Realized PnL" : "Volume"}
                </button>
              ))}
            </div>
          </div>
          {isLoading ? (
            <div className="m-5 h-48 animate-pulse rounded-xl bg-raised" />
          ) : board && board.length > 0 ? (
            <div className="relative mt-3 overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-[13px]">
                <thead className="text-[12px] text-ink-3">
                  <tr>
                    {["#", "Trader", "Realized PnL", "Volume", "Fills", ""].map((h) => (
                      <th key={h} className="px-5 py-2 font-normal">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {board.map((r, i) => {
                    const pnl = units6(r.realizedPnl);
                    const mine = r.account.toLowerCase() === me;
                    return (
                      <tr key={r.account} className={`group border-t border-line transition-colors hover:bg-raised/60 ${mine ? "bg-accent/5" : ""}`}>
                        <td className="num px-5 py-3 text-ink-3">{i + 1}</td>
                        <td className="px-5 py-3">
                          <span className="font-mono">{shortHash(r.account)}</span>
                          {r.vault && <span className="tag ml-2 rounded-[4px] bg-navy px-1.5 py-0.5 text-white">vault · {r.vault}</span>}
                          {mine && <span className="tag ml-2 text-accent">you</span>}
                        </td>
                        <td className={`num px-5 py-3 ${pnl >= 0 ? "text-flood" : "text-ebb"}`}>{signedMoney(pnl)}</td>
                        <td className="num px-5 py-3">{moneyCompact(wad(r.volumeUsd))}</td>
                        <td className="num px-5 py-3">{r.trades}</td>
                        <td className="px-5 py-3 text-right">
                          <Link href={`/currents/${r.account}`} className="inline-flex items-center gap-1 text-ink-3 transition-colors group-hover:text-ink" aria-label={`Open card for ${r.account}`}>
                            Card <ArrowUpRight size={13} strokeWidth={1.5} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-5 py-8 text-[14px] text-ink-2">The board fills from the first on-chain fill. Make a trade and you're on it.</p>
          )}
        </div>
      </section>

      <aside className="flex flex-col gap-3">
        {address && <PnlCard account={address} compact />}
        <PaperAccount />
        <div className="rounded-2xl border border-line bg-card p-4 text-[13px] leading-5 text-ink-2">
          <p className="font-medium text-ink">Why this board can't be faked</p>
          <ul className="mt-2 space-y-1">
            <li>· Realized PnL and fees come straight from Traded events</li>
            <li>· Copy vaults rank as traders and wear their name</li>
            <li>· Lighthouse grade on the card is a keeper-signed beam stored on-chain</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
