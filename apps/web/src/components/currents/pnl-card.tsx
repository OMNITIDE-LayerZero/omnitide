"use client";

import { useQuery } from "@tanstack/react-query";
import { Share2, ShieldCheck } from "lucide-react";
import { money, moneyCompact, realized, signedMoney, units6, wad, who } from "@/lib/format";

export interface TraderRow {
  account: string;
  trades: number;
  volumeUsd: string;
  realizedPnl: string;
  fees: string;
  firstSeen: number;
  lastSeen: number;
  vault?: string | null;
}

interface Beam {
  chainId: number;
  score: number;
  grade: number;
  expiry: number;
}

const GRADES = ["A", "B", "C", "D"];
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://testnet.omnitide.trade";

export function useTrader(account: string | undefined) {
  return useQuery({
    queryKey: ["trader", account],
    enabled: !!account,
    refetchInterval: 15_000,
    queryFn: async () => (await (await fetch(`/api/indexer/trader?account=${account}`)).json()) as { trader: TraderRow | null; rank?: number; of?: number },
  });
}

export function useBeam(account: string | undefined) {
  return useQuery({
    queryKey: ["beam", account],
    enabled: !!account,
    refetchInterval: 30_000,
    queryFn: async () => (await (await fetch(`/api/indexer/lighthouse?account=${account}`)).json()) as Beam[],
    select: (rows) => rows.find((b) => b.expiry > Date.now() / 1000) ?? null,
  });
}

export const shareUrl = (account: string) => `${SITE}/currents/${account.toLowerCase()}`;

export function shareOnX(account: string, pnl: number, rank?: number) {
  const text = `${Math.abs(pnl) < 0.005 ? "Position open on OMNITIDE perps" : `${pnl >= 0 ? "Riding the current" : "Took a wave to the face"}: ${signedMoney(pnl)} realized on OMNITIDE perps`}${rank ? `, #${rank} on the Currents board` : ""}. Every fill verified on Robinhood Chain.`;
  window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl(account))}`, "_blank", "noopener,noreferrer");
}

/** The verified PnL card: every number is summed from Traded events on the hub, nothing is self-reported. */
export function PnlCard({ account, compact = false }: { account: string; compact?: boolean }) {
  const { data } = useTrader(account);
  const { data: beam } = useBeam(account);
  const t = data?.trader;
  if (!t) return null;
  const pnl = units6(t.realizedPnl);
  const vol = wad(t.volumeUsd);
  const days = Math.max(1, Math.round((t.lastSeen - t.firstSeen) / 86_400));

  return (
    <article className={`relative overflow-hidden rounded-2xl border border-line bg-navy text-white ${compact ? "p-5" : "p-6 sm:p-8"}`}>
      {/* engraved swell lines, the card's watermark */}
      <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.12]" preserveAspectRatio="none" viewBox="0 0 400 200">
        {Array.from({ length: 14 }, (_, i) => (
          <path key={i} d={`M0 ${40 + i * 12} Q 100 ${30 + i * 12 + (i % 2 ? 10 : -10)} 200 ${40 + i * 12} T 400 ${40 + i * 12}`} fill="none" stroke="white" strokeWidth="0.6" />
        ))}
      </svg>
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="tag text-white/60">OMNITIDE Currents · verified PnL</p>
            <p className="mt-1 font-mono text-[13px] text-white/80">{t.vault ? `${t.vault} · copy vault` : who(t.account)}</p>
          </div>
          {beam && (
            <div className="text-right">
              <p className="tag text-white/60">Lighthouse</p>
              <p className="display text-[36px] leading-none">{GRADES[beam.grade]}</p>
            </div>
          )}
        </div>
        <p className={`display mt-6 ${compact ? "text-[44px]" : "text-[clamp(48px,7vw,80px)]"} leading-none ${pnl >= 0 ? "text-[#7ee0b5]" : "text-[#ff9a8a]"}`}>{realized(pnl)}</p>
        <p className="mt-1 text-[13px] text-white/60">realized over {days} {days === 1 ? "day" : "days"}</p>
        <dl className="mt-6 grid grid-cols-3 gap-3 text-[13px]">
          <div>
            <dt className="text-white/50">Rank</dt>
            <dd className="num mt-0.5 text-[18px]">{data?.rank ? `#${data.rank}` : "–"}<span className="text-white/50">{data?.of ? ` / ${data.of}` : ""}</span></dd>
          </div>
          <div>
            <dt className="text-white/50">Volume</dt>
            <dd className="num mt-0.5 text-[18px]">{moneyCompact(vol)}</dd>
          </div>
          <div>
            <dt className="text-white/50">Fills</dt>
            <dd className="num mt-0.5 text-[18px]">{t.trades}</dd>
          </div>
        </dl>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/15 pt-4">
          <span className="inline-flex items-center gap-1.5 text-[12px] text-white/60">
            <ShieldCheck size={13} strokeWidth={1.75} /> summed from OmnitideClearinghouse events · fees {money(units6(t.fees))}
          </span>
          <button type="button" className="btn btn-sm bg-white text-navy hover:bg-white/90" onClick={() => shareOnX(t.account, pnl, data?.rank)}>
            <Share2 size={14} strokeWidth={1.75} /> Share to X
          </button>
        </div>
      </div>
    </article>
  );
}
