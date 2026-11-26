"use client";

import { useRef } from "react";
import { MARKETS } from "@omnitide/contracts/markets";
import { CONTRACT_ROWS } from "@/lib/contracts";
import { CHAIN_COUNT } from "@/lib/chains";
import { laneRows } from "@/lib/landing";
import { useSeaWall } from "@/lib/hooks";
import { FEATURE_LIST } from "./features";
import { useSeen } from "./use-seen";
import { LANE_PAIRS } from "./route-map";

const MAX_LEV = Math.max(...MARKETS.map((m) => 10_000 / m.initialMarginBps));

const STACK = ["LayerZero V2 OFT", "lzCompose", "lzRead", "DVN-verified lanes", "Robinhood Chain", "Arbitrum", "HyperEVM", "Coinbase prices", "Nasdaq prices", "EIP-712 signed reports", "ERC-4626 OVault", "ONFT badges", "UUPS proxies", "x25519 + AES-256-GCM", "keccak commitments"];

/** Depth soundings under the hero: the protocol's size in a few big numbers, then the stack it stands on. */
export function Soundings() {
  const host = useRef<HTMLDivElement>(null);
  const seen = useSeen(host);
  const { data: wall } = useSeaWall();
  const lanes = laneRows(wall).length;
  const cells = [
    { v: String(MARKETS.length), k: "markets", note: "crypto, US and China stocks" },
    { v: `${MAX_LEV}×`, k: "max leverage", note: "cross-margined, one balance" },
    { v: String(CHAIN_COUNT), k: "chains", note: "one book on Robinhood Chain" },
    { v: String(lanes || LANE_PAIRS.length * 2), k: "LayerZero lanes", note: "rate-limited, DVN-verified" },
    { v: String(CONTRACT_ROWS.length), k: "contracts", note: "UUPS proxies, source verified" },
    { v: String(FEATURE_LIST.length), k: "features live", note: "Shoreline to Deep Water" },
  ];

  return (
    <section aria-label="OMNITIDE in numbers" className="relative border-y border-line bg-card">
      <div ref={host} className={`mx-auto grid max-w-[1440px] grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-6`}>
        {cells.map((c, i) => (
          <div key={c.k} className="group bg-card px-4 py-6 sm:px-8 sm:py-8">
            <p className={`display text-[clamp(48px,5.2vw,72px)] text-ink num transition-[opacity,transform] duration-700 ease-[var(--ease-tide)] group-hover:text-accent-ink ${seen ? "" : "translate-y-3 opacity-0"}`} style={{ transitionDelay: `${i * 70}ms` }}>
              {c.v}
            </p>
            <p className="mt-1 text-[14px] font-medium text-ink">{c.k}</p>
            <p className="tag mt-0.5 text-ink-3">{c.note}</p>
          </div>
        ))}
      </div>
      <div className="marquee border-t border-line py-3" aria-label="Built on">
        <ul className="marquee-track">
          {[0, 1].map((copy) =>
            STACK.map((s) => (
              <li key={`${copy}${s}`} aria-hidden={copy === 1} className="tag flex shrink-0 items-center gap-6 pr-6 text-[12px] text-ink-2">
                {s}
                <span className="size-1 rounded-full bg-accent/60" aria-hidden />
              </li>
            )),
          )}
        </ul>
      </div>
    </section>
  );
}
