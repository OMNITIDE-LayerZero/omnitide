"use client";

import { useBlockNumber } from "wagmi";
import { HUB, CHAIN_COUNT } from "@/lib/chains";
import { usePrices, useSeaWall } from "@/lib/hooks";
import { laneRows } from "@/lib/landing";
import { ago } from "@/lib/format";

/** Live hub block. Watching polls through our RPC proxy, shared by every caller on the page. */
export function useHubBlock() {
  return useBlockNumber({ chainId: HUB.chainId, watch: true });
}

/** One line of live network facts; any fact that isn't in yet is left out. */
export function NetworkStatus({ className = "" }: { className?: string }) {
  const { data: block } = useHubBlock();
  const { data: wall } = useSeaWall();
  const { data: prices } = usePrices();
  const lanes = laneRows(wall).length;
  const feeds = prices ? Object.values(prices) : [];
  const newest = feeds.length ? Math.max(...feeds.map((p) => p.observed)) : 0;
  const items = [
    block ? (
      <span key="block" className="inline-flex items-center gap-1.5">
        <span key={String(block)} className="rise size-1.5 rounded-full bg-flood" aria-hidden />
        {HUB.name} · block {block.toLocaleString("en-US")}
      </span>
    ) : null,
    lanes ? `${CHAIN_COUNT} chains · ${lanes} LayerZero lanes` : `${CHAIN_COUNT} chains`,
    newest ? `${feeds.length} signed feeds · last tick ${ago(newest / 1000)}` : null,
  ].filter(Boolean);
  return (
    <p className={`tag flex flex-wrap items-center gap-x-4 gap-y-1 ${className}`} aria-live="off">
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-4">
          {i > 0 && <span className="opacity-40" aria-hidden>/</span>}
          {it}
        </span>
      ))}
    </p>
  );
}
