"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ExternalLink } from "lucide-react";
import type { Token } from "@/lib/token";
import { CopyButton } from "./contracts-table";

/** The token's contract address under the hero CTAs; renders nothing until the launch file exists on the server. */
export function TokenCa() {
  const { data } = useQuery({
    queryKey: ["token"],
    queryFn: async () => ((await (await fetch("/api/token")).json()) as { token: Token | null }).token,
    refetchInterval: 15_000,
  });
  if (!data) return null;
  const t = data;
  return (
    <div className="rise mt-6 inline-flex max-w-full flex-wrap items-center lg:w-max lg:max-w-none lg:flex-nowrap lg:whitespace-nowrap gap-x-3 gap-y-2 rounded-xl border border-line bg-card/90 py-2 pr-2 pl-4 shadow-sm backdrop-blur-sm">
      <span className="flex items-center gap-2 text-[14px] font-medium text-ink">
        <span className="size-2 rounded-full bg-accent" aria-hidden />${t.symbol}
        <span className="tag text-ink-3">{t.chain}</span>
      </span>
      <span className="hidden h-5 w-px bg-line sm:block" aria-hidden />
      <span className="inline-flex min-w-0 items-center gap-1">
        <span className="tag text-ink-3">CA</span>
        <a href={t.explorer} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 font-mono text-[13px] text-ink hover:underline" title={t.ca}>
          <span className="sm:hidden">{`${t.ca.slice(0, 6)}…${t.ca.slice(-4)}`}</span>
          <span className="hidden break-all sm:inline lg:break-normal">{t.ca}</span>
          <ExternalLink size={12} strokeWidth={1.5} className="shrink-0 text-ink-3" />
        </a>
        <CopyButton text={t.ca} label={`$${t.symbol} contract address`} />
      </span>
      {t.buy && (
        <a href={t.buy} target="_blank" rel="noreferrer" className="btn btn-primary btn-sm shrink-0 whitespace-nowrap">
          Buy ${t.symbol}
          <ArrowUpRight size={14} strokeWidth={1.5} />
        </a>
      )}
    </div>
  );
}
