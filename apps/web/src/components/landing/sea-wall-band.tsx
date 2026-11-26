"use client";

import Link from "next/link";
import { SeaWallWater } from "./backdrops";
import { useRef } from "react";
import { ArrowRight, Check } from "lucide-react";
import { useSeaWall } from "@/lib/hooks";
import { money, moneyCompact, units6 } from "@/lib/format";
import { NETWORK } from "@/lib/chains";
import { laneRows, windowLabel } from "@/lib/landing";
import { useSeen } from "./use-seen";

// dollar figures show once the book is deep enough to read as a number; below it the gauge shows coverage alone
const SHOW_USD = 10_000;

/** One staff on the reserve gauge; the owed column carries a moving crest. */
function Column({ label, value, share, seen, water }: { label: string; value: number; share: number; seen: boolean; water?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-48 w-16 overflow-hidden rounded-lg border border-white/20 bg-white/[0.04] sm:w-20">
        {[0.25, 0.5, 0.75].map((t) => (
          <span key={t} className="absolute left-0 h-px w-2 bg-white/30" style={{ bottom: `${t * 100}%` }} />
        ))}
        <div className="absolute inset-x-0 bottom-0 transition-[height] duration-[1400ms] ease-[var(--ease-tide)]" style={{ height: seen ? `${share * 100}%` : "0%" }}>
          {water ? (
            <>
              <svg aria-hidden viewBox="0 0 120 8" preserveAspectRatio="none" className="crest absolute -top-[7px] left-0 h-2 w-[calc(100%+40px)] fill-white/30">
                <path d="M0 8V4C10 0 20 0 40 4S70 8 80 4 110 0 120 4V8Z" />
              </svg>
              <div className="h-full bg-white/30" />
            </>
          ) : (
            <div className="h-full bg-[#8ea2ff]" style={{ backgroundImage: "repeating-linear-gradient(115deg, rgb(255 255 255 / 0.18) 0 1px, transparent 1px 6px)" }} />
          )}
        </div>
      </div>
      <p className="text-center text-[12px] leading-4 text-white/70">{label}</p>
      {value >= SHOW_USD && <p className="text-[14px] text-white num">{moneyCompact(value)}</p>}
    </div>
  );
}

export function SeaWallBand() {
  const { data } = useSeaWall();
  const gauge = useRef<HTMLDivElement>(null);
  const seen = useSeen(gauge);
  const r = data?.reserves;
  const held = r ? units6(r.held) : undefined;
  const traders = r ? units6(r.collateral) : undefined;
  const pool = r ? Math.max(0, units6(r.pool)) : undefined;
  const owed = traders !== undefined && pool !== undefined ? traders + pool : undefined;
  const lanes = laneRows(data);
  const minConf = lanes.length ? Math.min(...lanes.map((l) => l.confirmations)) : undefined;
  const top = held !== undefined && owed !== undefined ? Math.max(held, owed) * 1.12 : 0;
  const cover = held !== undefined && owed ? (held / owed) * 100 : undefined;

  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_1.15fr] lg:items-center">
      <SeaWallWater cover={cover} />
      <div>
        <p className="tag text-[12px] text-white/75">Sea Wall · proof of reserves</p>
        <h2 className="display mt-4 text-[clamp(44px,6vw,80px)] text-white">
          Reserves you can
          <br />
          read on-chain.
        </h2>
        <p className="mt-6 max-w-lg text-white/80">
          Every tdUSD the book owes sits in the clearinghouse contract on the hub, and every lane out of a chain has a rate limit, a DVN and a confirmation count you can check yourself.
        </p>
        <Link href="/sea-wall" className="btn btn-lg mt-8 bg-white text-navy hover:bg-white/90">
          Open the Sea Wall
          <ArrowRight size={16} strokeWidth={1.5} />
        </Link>
        <p className="tag mt-6 text-white/60">read live from the hub clearinghouse and every OFT endpoint · refreshed every 30 s</p>
      </div>

      <div ref={gauge} className="overflow-hidden rounded-2xl border border-white/15 bg-navy">
        <div className="grid gap-6 p-5 sm:grid-cols-[auto_1fr] sm:p-6">
          {held !== undefined && owed !== undefined && top > 0 ? (
            <div className="flex justify-center gap-4">
              <Column label="Held on the hub" value={held} share={held / top} seen={seen} />
              <Column label="Owed: margin + pool" value={owed} share={owed / top} seen={seen} water />
            </div>
          ) : (
            <div className="h-60 w-44 rounded-lg bg-white/[0.06]" aria-label="Reading the hub" />
          )}
          <div className="flex flex-col justify-between gap-5">
            <div>
              <p className="text-[13px] text-white/60">Coverage</p>
              <p className="display mt-1 text-[clamp(52px,6vw,72px)] text-white num">{cover !== undefined ? `${cover.toFixed(2)}%` : <span className="inline-block h-14 w-40 rounded bg-white/10" />}</p>
              <p className="mt-2 flex items-center gap-2 text-[13px] text-white/75">
                <Check size={16} strokeWidth={1.5} className="text-[#8ea2ff]" />
                {cover === undefined ? "Reading the hub" : cover >= 99.9999 ? "Fully backed: holdings cover every balance and the pool" : "Rebalancing reserves on the hub"}
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/10 pt-4 text-[13px]">
              {held !== undefined && held >= SHOW_USD && (
                <div>
                  <dt className="text-white/55">Held</dt>
                  <dd className="text-white num">{money(held)}</dd>
                </div>
              )}
              {traders !== undefined && traders >= SHOW_USD && (
                <div>
                  <dt className="text-white/55">Traders&apos; margin</dt>
                  <dd className="text-white num">{money(traders)}</dd>
                </div>
              )}
              {pool !== undefined && pool >= SHOW_USD && (
                <div>
                  <dt className="text-white/55">Tide Pool</dt>
                  <dd className="text-white num">{money(pool)}</dd>
                </div>
              )}
              {minConf !== undefined && minConf > 0 && (
                <div>
                  <dt className="text-white/55">Min. confirmations</dt>
                  <dd className="text-white num">
                    {minConf} {minConf === 1 ? "block" : "blocks"}
                  </dd>
                </div>
              )}
              {lanes.length > 0 && (
                <div>
                  <dt className="text-white/55">Lanes watched</dt>
                  <dd className="text-white num">{lanes.length} LayerZero</dd>
                </div>
              )}
            </dl>
          </div>
        </div>

        {lanes.length > 0 && (
          <div className="border-t border-white/10 p-5 sm:p-6">
            <p className="tag text-white/55">{lanes.length} LayerZero lanes · rate-limit headroom</p>
            <ul className="mt-3 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
              {lanes.map((l) => {
                const head = l.limit > 0 ? Math.max(0, Math.min(1, l.available / l.limit)) : 0;
                const live = !l.paused && l.available > 0;
                return (
                  <li key={`${l.from}${l.to}`} className="group">
                    <div className="flex items-center gap-2 text-[13px]">
                      <span className={`size-1.5 shrink-0 rounded-full ${live ? "bg-[#8ea2ff] shadow-[0_0_0_3px_rgb(142_162_255/0.2)]" : "bg-white/30"}`} aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-white/85">
                        {NETWORK[l.from]} → {NETWORK[l.to]}
                      </span>
                      <span className="tag shrink-0 text-white/55">
                        {l.dvns} DVN · {l.confirmations} conf
                      </span>
                    </div>
                    <div className="mt-1.5 ml-3.5 flex items-center gap-2">
                      <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                        <span className="absolute inset-y-0 left-0 rounded-full bg-white/60 transition-[width] duration-700" style={{ width: `${(seen ? head : 0) * 100}%` }} />
                      </span>
                      <span className="tag shrink-0 text-white/45 transition-colors group-hover:text-white/80 num">
                        {l.available > 0 ? `${moneyCompact(l.available)} / ${windowLabel(l.window)}` : `refills in ${windowLabel(l.window)}`}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
