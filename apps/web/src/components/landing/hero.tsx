"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowRight } from "lucide-react";
import { MARKETS } from "@omnitide/contracts/markets";
import { usePrices, useSwell } from "@/lib/hooks";
import { LivePrice } from "../live-price";
import { Change } from "../change";

const WaveField = dynamic(() => import("../wave-field").then((m) => m.WaveField), { ssr: false });

const TAPE = ["BTC", "ETH", "SOL", "NVDA", "TSLA", "HOOD"];

export function Hero() {
  const swell = useSwell();
  const { data } = usePrices();
  const rows = TAPE.map((s) => MARKETS.find((m) => m.symbol === s)!).filter(Boolean);
  const btc = data?.["BTC-USD"];

  return (
    <section className="relative isolate min-h-[100svh] overflow-hidden">
      <WaveField swell={swell} className="absolute inset-0 -z-10" />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-t from-bg to-transparent" />

      <div className="mx-auto flex min-h-[100svh] max-w-[1440px] flex-col justify-between px-4 pt-28 pb-0 sm:px-8 sm:pt-36">
        <div data-hero-copy className="rise max-w-3xl">
          <p className="tag text-ink-2">LayerZero V2 · 5 chains · settled on Robinhood Chain</p>
          <h1 className="display mt-4 text-[clamp(52px,9.5vw,128px)] text-ink">
            Be the tide.
            <br />
            Not the target.
          </h1>
          <p className="mt-6 max-w-xl text-[18px] leading-7 text-ink-2">
            Fund from Ethereum, Avalanche, Monad or Arc. LayerZero lands it in a single margin account on Robinhood Chain, where BTC, ETH, NVDA and TSLA perps all trade off the same balance.
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
        </div>

        {/* product view rising from the bottom edge: the live tide table */}
        <div data-hero-dock className="rise mt-16 grid gap-4 lg:grid-cols-[1fr_320px]" style={{ animationDelay: "120ms" }}>
          <div className="rounded-t-2xl border border-b-0 border-line bg-card/90 p-4 shadow-md backdrop-blur-sm sm:p-5">
            <div className="flex items-center justify-between">
              <span className="tag text-ink-3">Tide table · live venue prices</span>
              <span className="tag hidden text-ink-3 sm:inline">Coinbase · Nasdaq</span>
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
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <aside className="hidden rounded-t-2xl border border-b-0 border-line bg-card/90 p-5 shadow-md backdrop-blur-sm lg:block">
            <span className="tag text-ink-3">Sea state</span>
            <p className="display mt-2 text-[40px] text-ink">{swell > 0.66 ? "Heavy swell" : swell > 0.33 ? "Moderate swell" : "Calm water"}</p>
            <p className="mt-2 text-[13px] leading-5 text-ink-2">
              The wave is drawn by the market. Its swell follows the average 24h move across crypto majors{btc?.change24h != null ? `, BTC ${btc.change24h >= 0 ? "up" : "down"} ${Math.abs(btc.change24h).toFixed(2)}% today` : ""}.
            </p>
          </aside>
        </div>
      </div>
    </section>
  );
}
