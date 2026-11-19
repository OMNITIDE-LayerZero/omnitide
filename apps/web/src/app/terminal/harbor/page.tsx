"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useConfig } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { encodeAbiParameters, pad, type Address } from "viem";
import { ExternalLink } from "lucide-react";
import { CHAINS, type ChainKey } from "@omnitide/contracts/chains";
import { HUB, HUB_KEY, SHORT, explorerTx } from "@/lib/chains";
import { HARBOR, HARBOR_ADAPTER, SHARE_CHAINS, omnitideHarborAbi, omnitideUSDAbi, shareAddress, usdAddress } from "@/lib/contracts";
import { useIndexer } from "@/lib/hooks";
import { ago, money, moneyCompact, shortHash, units6 } from "@/lib/format";
import { useTx } from "@/lib/tx";
import { amountUnits } from "@/components/terminal/collateral";
import { LineChart } from "@/components/terminal/line-chart";
import { Connect } from "@/components/connect";

interface TideLive { harbor: { assets: string; supply: string; pool: string }; shares: Record<string, string> }
interface HarborFlow { id: string; account: string; kind: "deposit" | "redeem"; assets: string; shares: string; srcEid: number; dstEid: number; delivered: boolean; timestamp: number; tx: string }

const CHAINS_FOR_HARBOR: ChainKey[] = [HUB_KEY, ...SHARE_CHAINS];
const chainByEid = (eid: number) => (Object.keys(CHAINS) as ChainKey[]).find((k) => CHAINS[k].eid === eid);
const hex = (n: bigint, bytes: number) => n.toString(16).padStart(bytes * 2, "0");
// compose option (index 0): 50k extra gas plus the native value that pays the return leg from the hub
const returnLegOption = (value: bigint) => `0x0003010023030000${hex(50_000n, 16)}${hex(value, 16)}` as const;

function useHarborLive() {
  return useQuery({ queryKey: ["tide-live"], queryFn: async () => (await (await fetch("/api/tide")).json()) as TideLive, refetchInterval: 15_000 });
}

function useMyShares() {
  const { address } = useAccount();
  const config = useConfig();
  return useQuery({
    queryKey: ["harbor-mine", address],
    enabled: !!address,
    refetchInterval: 10_000,
    queryFn: async () => {
      const rows = await Promise.all(
        CHAINS_FOR_HARBOR.map(async (k) => {
          const client = getPublicClient(config, { chainId: CHAINS[k].chainId })!;
          const [shares, usd] = await Promise.all([
            client.readContract({ address: shareAddress(k), abi: omnitideUSDAbi, functionName: "balanceOf", args: [address as Address] }),
            client.readContract({ address: usdAddress(k), abi: omnitideUSDAbi, functionName: "balanceOf", args: [address as Address] }),
          ]);
          return { chain: k, shares, usd };
        }),
      );
      return Object.fromEntries(rows.map((r) => [r.chain, r])) as Record<ChainKey, { chain: ChainKey; shares: bigint; usd: bigint }>;
    },
  });
}

function Actions({ sharePrice }: { sharePrice: number }) {
  const { address } = useAccount();
  const config = useConfig();
  const { send, busy } = useTx();
  const { data: mine } = useMyShares();
  const [mode, setMode] = useState<"deposit" | "redeem">("deposit");
  const [from, setFrom] = useState<ChainKey>(HUB_KEY);
  const [value, setValue] = useState("");
  const amount = amountUnits(value);
  const here = mine?.[from];
  const max = here ? (mode === "deposit" ? here.usd : here.shares) : 0n;
  const out = mode === "deposit" ? Number(value || 0) / sharePrice : Number(value || 0) * sharePrice;
  const remote = from !== HUB_KEY;

  async function go() {
    if (!address) return;
    const hub = getPublicClient(config, { chainId: HUB.chainId })!;
    const preview = await hub.readContract({ address: HARBOR, abi: omnitideHarborAbi, functionName: mode === "deposit" ? "previewDeposit" : "previewRedeem", args: [amount] });
    const minOut = (preview * 99n) / 100n;
    if (!remote) {
      if (mode === "deposit") {
        await send("Approve tdUSD for Harbor", { chainId: HUB.chainId, address: usdAddress(HUB_KEY), abi: omnitideUSDAbi, functionName: "approve", args: [HARBOR, amount] });
        await send(`Deposit ${value} tdUSD into Harbor`, { chainId: HUB.chainId, address: HARBOR, abi: omnitideHarborAbi, functionName: "deposit", args: [amount, address] });
      } else {
        await send(`Redeem ${value} htdUSD`, { chainId: HUB.chainId, address: HARBOR, abi: omnitideHarborAbi, functionName: "redeem", args: [amount, address, address] });
      }
    } else {
      const eid = CHAINS[from].eid;
      const back = { dstEid: eid, to: pad(address, { size: 32 }), amountLD: preview, minAmountLD: preview, extraOptions: "0x" as const, composeMsg: "0x" as const, oftCmd: "0x" as const };
      // the hub pays the return leg (shares or tdUSD back to this chain) out of the compose value
      const ret = await hub.readContract({ address: mode === "deposit" ? HARBOR_ADAPTER : usdAddress(HUB_KEY), abi: omnitideUSDAbi, functionName: "quoteSend", args: [back, false] });
      const p = {
        dstEid: HUB.eid,
        to: pad(HARBOR, { size: 32 }),
        amountLD: amount,
        minAmountLD: amount,
        extraOptions: returnLegOption((ret.nativeFee * 15n) / 10n),
        composeMsg: encodeAbiParameters([{ type: "address" }, { type: "uint32" }, { type: "uint256" }], [address, eid, minOut]),
        oftCmd: "0x" as const,
      };
      const token = mode === "deposit" ? usdAddress(from) : shareAddress(from);
      const src = getPublicClient(config, { chainId: CHAINS[from].chainId })!;
      const q = await src.readContract({ address: token, abi: omnitideUSDAbi, functionName: "quoteSend", args: [p, false] });
      await send(mode === "deposit" ? `Harbor deposit from ${SHORT[from]}` : `Harbor redeem to ${SHORT[from]}`, {
        chainId: CHAINS[from].chainId,
        address: token,
        abi: omnitideUSDAbi,
        functionName: "send",
        args: [p, { nativeFee: q.nativeFee, lzTokenFee: 0n }, address],
        value: q.nativeFee,
      });
    }
    setValue("");
  }

  return (
    <section className="rounded-2xl border border-line bg-card">
      <div className="flex gap-1 border-b border-line px-2" role="tablist" aria-label="Harbor">
        {(["deposit", "redeem"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={mode === t} onClick={() => setMode(t)} className={`relative h-11 px-3 text-[14px] capitalize transition-colors ${mode === t ? "text-ink" : "text-ink-3 hover:text-ink-2"}`}>
            {t}
            {mode === t && <span className="absolute inset-x-3 -bottom-px h-px bg-accent" />}
          </button>
        ))}
      </div>
      <div className="space-y-4 p-4">
        {!address ? (
          <Connect size="md" />
        ) : (
          <>
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Chain">
              {CHAINS_FOR_HARBOR.map((k) => (
                <button key={k} type="button" role="radio" aria-checked={from === k} onClick={() => setFrom(k)} className={`btn btn-sm ${from === k ? "bg-raised text-ink" : "btn-ghost"}`}>
                  {SHORT[k]}
                </button>
              ))}
            </div>
            <label className="block">
              <span className="flex justify-between text-[13px] text-ink-2">
                <span>{mode === "deposit" ? "tdUSD in" : "htdUSD to redeem"}</span>
                {max > 0n && (
                  <button type="button" className="num text-ink-3 hover:text-ink" onClick={() => setValue(String(units6(max)))}>
                    {units6(max).toLocaleString("en-US")} on {SHORT[from]}
                  </button>
                )}
              </span>
              <input className="field mt-1" inputMode="decimal" placeholder="0.00" value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))} />
            </label>
            {amount > 0n && (
              <p className="num text-[13px] text-ink-2">
                ≈ {out.toLocaleString("en-US", { maximumFractionDigits: 4 })} {mode === "deposit" ? "htdUSD" : "tdUSD"} {remote ? `back on ${SHORT[from]}` : "on Robinhood Chain"}
              </p>
            )}
            {remote && (
              <p className="text-[13px] leading-5 text-ink-2">
                OVault route: {mode === "deposit" ? "tdUSD" : "htdUSD"} rides LayerZero to the hub, lzCompose {mode === "deposit" ? "deposits it and ships the shares" : "redeems it and ships the tdUSD"} back here in one go. The return leg is prepaid; if anything slips by more than 1%, it lands on Robinhood Chain instead.
              </p>
            )}
            <button type="button" className="btn btn-primary w-full" disabled={busy || amount === 0n || amount > max} onClick={() => void go().catch(() => {})}>
              {mode === "deposit" ? (remote ? `Deposit from ${SHORT[from]}` : "Deposit to Harbor") : remote ? `Redeem to ${SHORT[from]}` : "Redeem"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

export default function Harbor() {
  const { address } = useAccount();
  const { data: live } = useHarborLive();
  const { data: mine } = useMyShares();
  const { data: flows } = useIndexer<HarborFlow[]>("harbor");
  const { data: history } = useQuery({
    queryKey: ["harbor-snapshots"],
    queryFn: async () => (await (await fetch("/api/snapshots?harbor=1")).json()) as { points: { time: number; assets: number; supply: number }[] },
    refetchInterval: 120_000,
  });

  const assets = live ? units6(live.harbor.assets) : 0;
  const supply = live ? units6(live.harbor.supply) : 0;
  const sharePrice = supply > 0 ? assets / supply : 1;
  const points = (history?.points ?? []).filter((p) => p.supply > 0).map((p) => ({ time: p.time, value: p.assets / p.supply }));
  const first = points[0];
  const days = first ? (Date.now() / 1000 - first.time) / 86_400 : 0;
  const apr = first && days >= 1 ? ((sharePrice / first.value - 1) / days) * 365 * 100 : null;
  const myShares = mine ? Object.values(mine).reduce((a, r) => a + units6(r.shares), 0) : 0;

  const figures = live
    ? [
        { label: "Harbor TVL", value: moneyCompact(assets) },
        { label: "Share price", value: `${sharePrice.toFixed(6)} tdUSD` },
        { label: "Shares out", value: supply.toLocaleString("en-US", { maximumFractionDigits: 2 }) },
        ...(apr !== null ? [{ label: `Annualised, ${Math.floor(days)}d`, value: `${apr >= 0 ? "+" : "−"}${Math.abs(apr).toFixed(2)}%` }] : []),
        ...(myShares > 0 ? [{ label: "Your position", value: money(myShares * sharePrice) }] : []),
      ]
    : [];

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_380px]">
      <section className="flex min-w-0 flex-col gap-3">
        <div className="rounded-2xl border border-line bg-card p-5">
          <p className="tag text-ink-3">LayerZero OVault · ERC-4626 on Robinhood Chain · shares on {SHARE_CHAINS.map((k) => SHORT[k]).join(", ")}</p>
          <h1 className="display mt-2 text-[44px] text-ink">Harbor</h1>
          <p className="mt-2 max-w-2xl text-[14px] leading-[22px] text-ink-2">Idle tdUSD moors here and becomes the Tide Pool: the counterparty to every trade on OMNITIDE. Harbor earns the 10 bps trading fee, 80% of every liquidation penalty and whatever traders give back, and it pays out when traders win.</p>
          {live ? (
            <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3 xl:grid-cols-5">
              {figures.map((f) => (
                <div key={f.label} className="bg-card p-4">
                  <dt className="text-[13px] text-ink-3">{f.label}</dt>
                  <dd className="num mt-1 text-[22px] leading-8 font-medium">{f.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <div className="mt-6 h-24 animate-pulse rounded-xl bg-raised" />
          )}
        </div>

        <div className="rounded-2xl border border-line bg-card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[20px] font-medium">Share price</h2>
            <span className="tag text-ink-3">keeper snapshot every 10 minutes</span>
          </div>
          {points.length >= 2 ? (
            <LineChart points={points} precision={6} className="mt-3 h-56" />
          ) : (
            <p className="mt-3 text-[14px] leading-[22px] text-ink-2">
              Harbor opened at 1.000000 tdUSD per share and sits at {sharePrice.toFixed(6)} now. The curve draws itself as the keeper's snapshots stack up.
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-card">
          <h2 className="px-5 pt-5 text-[20px] font-medium">Harbor flows</h2>
          {flows && flows.length > 0 ? (
            <div className="relative mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[13px]">
                <thead className="text-[12px] text-ink-3">
                  <tr>
                    {["Type", "tdUSD", "htdUSD", "Route", "When", "Hub tx"].map((h) => (
                      <th key={h} className="px-5 py-2 font-normal">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {flows.map((f) => {
                    const src = chainByEid(f.srcEid);
                    const dst = chainByEid(f.dstEid);
                    return (
                      <tr key={f.id} className="border-t border-line">
                        <td className="px-5 py-3 font-medium capitalize">
                          {f.kind}
                          {!f.delivered && <span className="tag ml-2 text-warn">held on hub</span>}
                        </td>
                        <td className="num px-5 py-3">{money(units6(f.assets))}</td>
                        <td className="num px-5 py-3">{units6(f.shares).toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
                        <td className="px-5 py-3 text-ink-2">{src === dst || !src ? SHORT[HUB_KEY] : `${SHORT[src]} → hub → ${dst ? SHORT[dst] : "hub"}`}</td>
                        <td className="px-5 py-3 text-ink-3">{ago(f.timestamp)}</td>
                        <td className="px-5 py-3">
                          <a href={explorerTx(HUB_KEY, f.tx)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] text-ink-2 hover:text-ink">
                            {shortHash(f.tx)}
                            <ExternalLink size={12} strokeWidth={1.5} />
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-5 py-8 text-[14px] text-ink-2">Every deposit and redemption lands here, cross-chain ones with their full route.</p>
          )}
        </div>
      </section>

      <aside className="flex flex-col gap-3">
        <Actions sharePrice={sharePrice} />
        {address && mine && myShares > 0 && (
          <div className="rounded-2xl border border-line bg-card p-4">
            <p className="font-medium">Your htdUSD</p>
            <dl className="mt-2 space-y-1 text-[13px]">
              {CHAINS_FOR_HARBOR.filter((k) => mine[k]?.shares).map((k) => (
                <div key={k} className="flex justify-between">
                  <dt className="text-ink-3">{SHORT[k]}</dt>
                  <dd className="num">{units6(mine[k].shares).toLocaleString("en-US", { maximumFractionDigits: 4 })}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        <div className="rounded-2xl border border-line bg-card p-4 text-[13px] leading-5 text-ink-2">
          <p className="font-medium text-ink">How the OVault moves</p>
          <ol className="mt-2 list-decimal space-y-1 pl-4">
            <li>tdUSD crosses to the hub as an OFT with a compose message naming you and your chain.</li>
            <li>OmnitideHarbor deposits it into the Tide Pool and mints htdUSD at the live share price.</li>
            <li>OmnitideHarborShareAdapter locks the shares and LayerZero mints them on your chain.</li>
            <li>Redeeming runs the same path backwards, paid out of the pool.</li>
          </ol>
          {live && <p className="num mt-3 text-ink-3">Tide Pool balance {moneyCompact(units6(live.harbor.pool))}</p>}
        </div>
      </aside>
    </div>
  );
}
