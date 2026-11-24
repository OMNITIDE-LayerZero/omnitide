"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount, useConfig } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { ExternalLink, Radio } from "lucide-react";
import { CHAINS, type ChainKey } from "@omnitide/contracts/chains";
import { MARKETS } from "@omnitide/contracts/markets";
import { CHAIN_KEYS, HUB_KEY, LZ_SCAN, SHORT } from "@/lib/chains";
import { TIDE_READER, TIDE_READER_CHAIN, omnitideTideReaderAbi } from "@/lib/contracts";
import { useIndexer, usePrices } from "@/lib/hooks";
import { ago, moneyCompact, pct, price, shortHash, units6, wad } from "@/lib/format";
import { useTx } from "@/lib/tx";

interface TideLive {
  at: number;
  markets: { id: number; long: string; short: string; maxOpenInterestUsd: string }[];
  harbor: { assets: string; supply: string; pool: string };
  supply: Record<string, string>;
  shares: Record<string, string>;
}
interface TideRead { guid: string; readAt: number; requestTx: string | null; eids: number[] | null; supplies: string[] | null; receivedAt: number | null; receivedTx: string | null }

const READER_CHAIN = TIDE_READER_CHAIN as ChainKey;
const keyByEid = (eid: number) => (Object.keys(CHAINS) as ChainKey[]).find((k) => CHAINS[k].eid === eid);

function PullRead() {
  const { address } = useAccount();
  const config = useConfig();
  const { send, busy } = useTx();
  async function pull() {
    const client = getPublicClient(config, { chainId: CHAINS[READER_CHAIN].chainId })!;
    const fee = await client.readContract({ address: TIDE_READER, abi: omnitideTideReaderAbi, functionName: "quote" });
    await send("Pull a fresh lzRead", { chainId: CHAINS[READER_CHAIN].chainId, address: TIDE_READER, abi: omnitideTideReaderAbi, functionName: "refresh", value: (fee * 12n) / 10n });
  }
  return (
    <button type="button" className="btn btn-secondary btn-sm" disabled={!address || busy} onClick={() => void pull().catch(() => {})} title={address ? "Pays the LayerZero read fee on Arbitrum Sepolia" : "Connect a wallet first"}>
      <Radio size={14} strokeWidth={1.5} />
      Pull a fresh lzRead
    </button>
  );
}

export default function TideChart() {
  const { data: live } = useQuery({ queryKey: ["tide-live"], queryFn: async () => (await (await fetch("/api/tide")).json()) as TideLive, refetchInterval: 15_000 });
  const { data: reads } = useIndexer<TideRead[]>("tide");
  const { data: prices } = usePrices();

  const last = reads?.find((r) => r.supplies && r.eids);
  const pending = reads?.find((r) => !r.supplies);
  const attested = new Map<ChainKey, number>();
  last?.eids?.forEach((eid, i) => {
    const k = keyByEid(eid);
    if (k) attested.set(k, units6(last.supplies![i]!));
  });

  const supply = CHAIN_KEYS.map((k) => ({ k, v: live?.supply[k] ? units6(live.supply[k]) : null }));
  const total = supply.reduce((a, s) => a + (s.v ?? 0), 0);
  const tiles = MARKETS.map((m) => {
    const row = live?.markets.find((x) => x.id === m.id);
    const px = prices?.[m.feed]?.price;
    const long = row && px ? wad(row.long) * px : 0;
    const short = row && px ? wad(row.short) * px : 0;
    const cap = row ? wad(row.maxOpenInterestUsd) : m.maxOpenInterestUsd;
    return { m, px, change: prices?.[m.feed]?.change24h ?? null, long, short, util: Math.max(long, short) / cap };
  });
  const oi = tiles.reduce((a, t) => a + t.long + t.short, 0);
  const harborTvl = live ? units6(live.harbor.assets) : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl border border-line bg-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="tag text-ink-3">Every chain · every market · one screen</p>
            <h1 className="display mt-2 text-[44px] text-ink">Tide Chart</h1>
            <p className="mt-2 max-w-2xl text-[14px] leading-[22px] text-ink-2">
              One LayerZero lzRead from {SHORT[READER_CHAIN]} pulls tdUSD supply from every chain its read DVNs cover, in a single verified answer. The hub and the rest are read live. Open interest comes straight from the clearinghouse.
            </p>
          </div>
          <PullRead />
        </div>
        {live && (
          <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
            {[
              { label: "tdUSD across chains", value: moneyCompact(total) },
              { label: "Harbor TVL", value: moneyCompact(harborTvl) },
              { label: "Open interest", value: oi > 0 ? moneyCompact(oi) : "Flat book" },
              { label: "Chains in the tide", value: String(CHAIN_KEYS.length) },
            ].map((f) => (
              <div key={f.label} className="bg-card p-4">
                <dt className="text-[13px] text-ink-3">{f.label}</dt>
                <dd className="num mt-1 text-[22px] leading-8 font-medium">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <section className="rounded-2xl border border-line bg-card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[20px] font-medium">Chains</h2>
            {last ? (
              <a href={`${LZ_SCAN}${last.requestTx}`} target="_blank" rel="noreferrer" className="tag inline-flex items-center gap-1 text-accent-ink hover:underline">
                lzRead {ago(last.readAt)} · {shortHash(last.guid)}
                <ExternalLink size={11} strokeWidth={1.5} />
              </a>
            ) : (
              <span className="tag text-ink-3">first lzRead on its way</span>
            )}
          </div>
          <ul className="mt-4 space-y-4">
            {supply.map(({ k, v }) => {
              const read = attested.get(k);
              const share = v !== null && total > 0 ? v / total : 0;
              const htd = k === HUB_KEY ? null : live?.shares[k];
              return (
                <li key={k}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium">
                      {SHORT[k]}
                      <span className="tag ml-2 text-ink-3">eid {CHAINS[k].eid}</span>
                    </span>
                    <span className="num text-[14px]">{v === null ? "reading…" : v >= 1 ? `${v.toLocaleString("en-US", { maximumFractionDigits: 0 })} tdUSD` : "Lane open"}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-raised">
                    <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${Math.max(2, share * 100)}%` }} />
                  </div>
                  <p className="tag mt-1.5 text-ink-3">
                    {read !== undefined && read < 1 && (v ?? 0) < 1 ? "lzRead verified · ready for the first Inflow" : read !== undefined ? `lzRead attested ${read.toLocaleString("en-US", { maximumFractionDigits: 0 })}${v !== null && Math.abs(v - read) >= 1 ? ` · moved ${v > read ? "+" : "−"}${Math.abs(v - read).toLocaleString("en-US", { maximumFractionDigits: 0 })} since` : " · matches live"}` : k === HUB_KEY ? "hub · read live on Robinhood Chain" : "read live · outside lzRead DVN coverage on testnet"}
                    {htd && units6(htd) > 0 ? ` · ${units6(htd).toLocaleString("en-US", { maximumFractionDigits: 2 })} htdUSD` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
          {pending && <p className="tag mt-4 text-ink-3">Another lzRead requested {ago(pending.readAt)}, DVNs verifying</p>}
        </section>

        <section className="rounded-2xl border border-line bg-card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[20px] font-medium">Markets</h2>
            <span className="tag text-ink-3">open interest at mark · bar = long vs short · cap use</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {tiles.map((t) => {
              const gross = t.long + t.short;
              return (
                <article key={t.m.id} className="rounded-xl border border-line p-3 transition-colors hover:border-line-strong">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{t.m.symbol}-PERP</span>
                    {t.change !== null && <span className={`num text-[12px] ${t.change >= 0 ? "text-flood" : "text-ebb"}`}>{pct(t.change)}</span>}
                  </div>
                  <p className="num mt-1 text-[14px] text-ink-2">{t.px ? price(t.px) : "pricing…"}</p>
                  <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden>
                    {gross > 0 && (
                      <>
                        <span className="bg-flood" style={{ width: `${(t.long / gross) * 100}%` }} />
                        <span className="bg-ebb" style={{ width: `${(t.short / gross) * 100}%` }} />
                      </>
                    )}
                  </div>
                  <p className="tag mt-1.5 text-ink-3">{gross > 0 ? `${moneyCompact(gross)} · ${(t.util * 100).toFixed(t.util < 0.01 ? 2 : 0)}% of cap` : "Flat · no open interest"}</p>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
