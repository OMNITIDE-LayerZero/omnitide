"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useState } from "react";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { MARKETS } from "@omnitide/contracts/markets";
import { usePriceMap, usePrices, useSparks, useSwell } from "@/lib/hooks";
import { CONTRACT_ROWS } from "@/lib/contracts";
import { CHAIN_COUNT, SPOKE_LIST } from "@/lib/chains";
import { LivePrice } from "../live-price";
import { Change } from "../change";
import { TokenCa } from "./token-ca";
import { HeroTicket } from "./hero-ticket";
import { Spark } from "./spark";
import { FEATURE_LIST } from "./features";

const WaveField = dynamic(() => import("../wave-field").then((m) => m.WaveField), { ssr: false });

const TAPE = ["BTC", "ETH", "SOL", "NVDA", "BABA", "HOOD"];

export function Hero() {
  const market = useSwell();
  // once a visitor touches the leverage slider, the wave answers to it instead of the market
  const [lev, setLev] = useState<number | null>(null);
  const swell = lev === null ? market : 0.1 + lev * 0.9;
  const { data } = usePrices();
  const prices = usePriceMap();
  const { data: sparks } = useSparks();
  const rows = TAPE.map((s) => MARKETS.find((m) => m.symbol === s)!).filter(Boolean);

  return (
    <section className="relative isolate min-h-[100svh] overflow-hidden">
      <WaveField swell={swell} className="absolute inset-0 -z-10" />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-t from-bg to-transparent" />

      <div className="mx-auto flex min-h-[100svh] max-w-[1440px] flex-col justify-between px-4 pt-24 pb-0 sm:px-8 sm:pt-32">
        <div data-hero-copy className="rise max-w-3xl">
          <p className="tag text-[12px] text-ink-2">LayerZero V2 · {CHAIN_COUNT} chains · settled on Robinhood Chain</p>
          <h1 className="display mt-4 text-[clamp(52px,9.5vw,128px)] text-ink">
            Be the tide.
            <br />
            Not the target.
          </h1>
          <p className="mt-6 max-w-xl text-[18px] leading-7 text-ink-2">
            Fund from {SPOKE_LIST}. LayerZero brings your collateral into one shared margin account on Robinhood Chain. Start with crypto and stock perps across markets like BTC, ETH, NVDA and BABA. One book, with room for more.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/terminal/trade" className="btn btn-primary btn-lg">
              Open terminal
              <ArrowRight size={16} strokeWidth={1.5} />
            </Link>
            <Link href="/sea-wall" className="btn btn-secondary btn-lg">
              Inspect the Sea Wall
            </Link>
          </div>
          <TokenCa />
          <Link href="/proof" className="group mt-4 flex w-fit items-center gap-2 text-[13px] text-ink-2 transition-colors hover:text-ink">
            <span className="size-1.5 rounded-full bg-flood shadow-[0_0_0_3px_color-mix(in_oklab,var(--flood)_20%,transparent)]" aria-hidden />
            {FEATURE_LIST.length} features live · {CONTRACT_ROWS.length} contracts source-verified
            <ArrowUpRight size={14} strokeWidth={1.5} className="text-ink-3 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-ink" />
          </Link>
        </div>

        {/* product view rising from the bottom edge: the live tide table */}
        <div data-hero-dock className="rise mt-10 grid gap-4 lg:grid-cols-[1fr_380px] lg:items-end" style={{ animationDelay: "120ms" }}>
          <div className="rounded-t-2xl border border-b-0 border-line bg-card/90 p-4 shadow-md backdrop-blur-sm sm:p-5">
            <div className="flex items-center justify-between">
              <span className="tag text-ink-3">Tide table · live from Coinbase and Nasdaq</span>
              <span className="tag hidden text-ink-3 sm:inline">Sea state · {swell > 0.66 ? "heavy swell" : swell > 0.33 ? "moderate swell" : "calm water"}</span>
            </div>
            <ul className="mt-3 grid grid-cols-2 gap-x-6 sm:grid-cols-3 lg:grid-cols-6">
              {rows.map((m) => (
                <li key={m.feed} className="border-t border-line py-3">
                  <Link href={`/terminal/trade?m=${m.symbol}`} className="group block">
                    <span className="text-[13px] text-ink-3 transition-colors group-hover:text-ink">{m.symbol}-PERP</span>
                    <LivePrice value={data?.[m.feed]?.price} className="mt-1 block text-[20px] leading-7 font-medium" />
                    <span className="text-[13px]">
                      <Change value={data?.[m.feed]?.change24h} />
                    </span>
                    <span className="mt-2 block">
                      <Spark closes={sparks?.[m.feed]} live={data?.[m.feed]?.price} label={`${m.symbol} price`} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <HeroTicket prices={prices} onLeverage={setLev} />
        </div>
      </div>
    </section>
  );
}
