"use client";

import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import { GOV, V3_CHAINS, govToken } from "@/lib/contracts";
import { HUB_KEY, NETWORK, explorerAddress } from "@/lib/chains";
import { CopyButton } from "./contracts-table";

const USES = [
  { k: "Steer", t: "Stake to vote", b: "Council proposals mirror to every chain. Stake where you hold and your vote counts in the one tally on the hub." },
  { k: "Sail", t: "One supply, no wrappers", b: "A LayerZero OFT: it moves between chains as one supply, never as a wrapped copy with its own price." },
  { k: "Settle", t: "No double votes", b: "Stake locks until the vote closes. Spoke votes ride LayerZero home, and the hub counts each one exactly once." },
];

/** The governance token: what it does and its address on every chain it sails. */
export function TokenBand() {
  return (
    <section id="token" data-tone="dark" className="engrave relative scroll-mt-16 overflow-hidden bg-navy py-12 text-white sm:py-16">
      <div className="mx-auto grid max-w-[1440px] gap-12 px-4 sm:px-8 lg:grid-cols-[1fr_1.1fr] lg:items-start">
        <div>
          <p className="tag text-[12px] text-white/70">${GOV} · LayerZero OFT · {V3_CHAINS.length} chains</p>
          <h2 className="display mt-4 text-[clamp(44px,6vw,80px)]">
            One token.
            <br />
            Every chain.
            <br />
            One tally.
          </h2>
          <p className="mt-6 max-w-lg text-[16px] leading-6 text-white/80">
            ${GOV} is the vote behind OMNITIDE. Hold it on {V3_CHAINS.map((k) => NETWORK[k]).join(", ").replace(/, ([^,]*)$/, " or $1")}, stake it where you are, and steer the book without bridging first.
          </p>
          <Link href="/terminal/council" className="btn btn-lg group mt-8 bg-white text-navy hover:bg-white/90">
            Enter the Council
            <ArrowRight size={16} strokeWidth={1.5} className="transition-transform duration-200 ease-[var(--ease-tide)] group-hover:translate-x-0.5" />
          </Link>
        </div>

        <div className="grid gap-4">
          <ol className="grid gap-px overflow-hidden rounded-2xl border border-white/15 bg-white/15 sm:grid-cols-3">
            {USES.map((u, i) => (
              <li key={u.k} className="group bg-navy p-5 transition-colors hover:bg-navy-2">
                <p className="tag text-[#8ea2ff]">
                  0{i + 1} · {u.k}
                </p>
                <p className="mt-3 text-[16px] leading-6 font-medium">{u.t}</p>
                <p className="mt-2 text-[13px] leading-5 text-white/65">{u.b}</p>
              </li>
            ))}
          </ol>
          <div data-theme="dark" className="rounded-2xl border border-white/15 bg-white/[0.03] p-5">
            <p className="tag text-white/55">${GOV} contract on each chain</p>
            <ul className="mt-3 divide-y divide-white/10">
              {V3_CHAINS.map((k) => {
                const a = govToken(k);
                return (
                  <li key={k} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                    <span className="flex items-center gap-2 text-white/85">
                      <span className={`size-1.5 rounded-full ${k === HUB_KEY ? "bg-white" : "bg-[#8ea2ff]"}`} aria-hidden />
                      {NETWORK[k]}
                      <span className="tag text-white/40">{k === HUB_KEY ? "home" : "OFT"}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <a href={explorerAddress(k, a)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] text-[#c9d3ff] hover:underline" title={a}>
                        {a.slice(0, 6)}…{a.slice(-4)}
                        <ExternalLink size={11} strokeWidth={1.5} />
                      </a>
                      <CopyButton text={a} label={`$${GOV} on ${NETWORK[k]}`} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
