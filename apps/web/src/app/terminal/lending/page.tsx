"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useBalance, usePublicClient } from "wagmi";
import { formatEther, maxUint256, parseEther, type Address } from "viem";
import { ExternalLink } from "lucide-react";
import { HUB, HUB_KEY, explorerTx } from "@/lib/chains";
import { LENDING, omnitideLendingAbi, omnitideUSDAbi, usdAddress } from "@/lib/contracts";
import { fetchReports } from "@/lib/account";
import { useIndexer, usePriceMap } from "@/lib/hooks";
import { ago, money, moneyCompact, price as fmtPrice, shortHash, units6, who } from "@/lib/format";
import { useTx } from "@/lib/tx";
import { anchorHold, borrowApr, borrowRoom, liquidationPrice, supplyApr, useLendingLive, useLendingMine, type LendingLive, type RateModel } from "@/lib/lending";
import { amountUnits } from "@/components/terminal/collateral";
import { TideGauge } from "@/components/tide-gauge";
import { Connect } from "@/components/connect";

interface Flow { id: string; account: string; kind: string; amount: string; seized: string | null; price: string | null; toMargin: boolean | null; timestamp: number; tx: string }

const KIND: Record<string, string> = { supply: "Lent", withdraw: "Withdrew", lock: "Anchored ETH", unlock: "Raised ETH", borrow: "Borrowed", repay: "Repaid", liquidation: "Liquidated", bad_debt: "Written off" };
const apr = (v: number) => (v === 0 ? "0.00%" : v < 0.0001 ? "<0.01%" : `${(v * 100).toFixed(2)}%`);
// ETH that can leave while the loan stays inside the borrow limit, with a 0.1% cushion for price ticks
const unlockable = (raw: bigint, debt: number, px: number, ltv: number) => {
  if (debt <= 0) return raw;
  if (px <= 0 || ltv <= 0) return 0n;
  const keep = BigInt(Math.ceil((debt / (px * ltv)) * 1.001 * 1e18));
  return raw > keep ? raw - keep : 0n;
};
const eth = (v: number) => `${v.toLocaleString("en-US", { maximumFractionDigits: v < 0.01 ? 6 : 4 })} ETH`;

function useWalletUsd() {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: HUB.chainId });
  return useQuery({
    queryKey: ["hub-usd", address],
    enabled: !!client && !!address,
    refetchInterval: 10_000,
    queryFn: () => client!.readContract({ address: usdAddress(HUB_KEY), abi: omnitideUSDAbi, functionName: "balanceOf", args: [address as Address] }),
  });
}

/** Borrow and lender APR across utilisation, today's point marked; hover reads any point off the curve. */
function RateCurve({ live }: { live: LendingLive }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const H = 220;
  const pad = { l: 44, r: 12, t: 14, b: 28 };
  const top = live.model.maxRate * 1.05;
  const x = (u: number) => pad.l + u * (W - pad.l - pad.r);
  const y = (r: number) => H - pad.b - (r / top) * (H - pad.t - pad.b);
  const pts = (f: (u: number) => number) => Array.from({ length: 101 }, (_, i) => `${x(i / 100).toFixed(1)},${y(f(i / 100)).toFixed(1)}`).join(" ");
  const u = hover ?? live.util;
  const read = { util: u, borrow: borrowApr(live.model, u), lend: supplyApr(live.model, u, live.reserve) };
  return (
    <div className="rounded-2xl border border-line bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[20px] font-medium">Rate curve</h2>
        <span className="tag text-ink-3">gentle to {Math.round(live.model.kink * 100)}% lent out, steep after it, so lenders can always leave</span>
      </div>
      <div className="mt-3 grid gap-4 md:grid-cols-[1fr_200px]">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none select-none"
          role="img"
          aria-label="Borrow and lender APR by utilisation"
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setHover(Math.max(0, Math.min(1, ((e.clientX - r.left) / r.width) * (W / (W - pad.l - pad.r)) - pad.l / (W - pad.l - pad.r))));
          }}
          onPointerLeave={() => setHover(null)}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={pad.t} y2={H - pad.b} className="stroke-line" strokeDasharray="2 4" />
              <text x={x(t)} y={H - 8} textAnchor="middle" className="fill-ink-3 font-mono text-[12px]">
                {t * 100}%
              </text>
            </g>
          ))}
          {[0, live.model.maxRate].map((r) => (
            <text key={r} x={pad.l - 6} y={y(r) + 4} textAnchor="end" className="fill-ink-3 font-mono text-[12px]">
              {(r * 100).toFixed(0)}%
            </text>
          ))}
          <text x={x(live.model.kink) - 6} y={y(live.model.kinkRate) - 8} textAnchor="end" className="fill-ink-2 font-mono text-[12px]">
            {(live.model.kinkRate * 100).toFixed(0)}% at the kink
          </text>
          <rect x={x(live.model.kink)} y={pad.t} width={x(1) - x(live.model.kink)} height={H - pad.t - pad.b} className="fill-accent/5" />
          <polyline points={pts((v) => supplyApr(live.model, v, live.reserve))} fill="none" className="stroke-ink-3" strokeWidth={1.5} strokeDasharray="4 4" />
          <polyline points={pts((v) => borrowApr(live.model, v))} fill="none" className="stroke-accent" strokeWidth={2} />
          <line x1={x(u)} x2={x(u)} y1={pad.t} y2={H - pad.b} className={hover === null ? "stroke-accent" : "stroke-ink-2"} strokeWidth={1} />
          <circle cx={x(u)} cy={y(read.borrow)} r={4} className="fill-accent" />
          <circle cx={x(u)} cy={y(read.lend)} r={3} className="fill-ink-2" />
        </svg>
        <dl className="grid grid-cols-3 gap-3 text-[13px] md:grid-cols-1 md:content-center">
          <div>
            <dt className="text-ink-3">{hover === null ? "Lent out now" : "Lent out"}</dt>
            <dd className="num text-[20px] font-medium">{apr(read.util)}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Borrowers pay</dt>
            <dd className="num text-[20px] font-medium text-accent">{apr(read.borrow)}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Lenders earn</dt>
            <dd className="num text-[20px] font-medium">{apr(read.lend)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

/** What a stack of ETH anchors at today's price: borrow room and the price the anchor would drag at. */
function AnchorCalculator({ live, ethPrice }: { live: LendingLive; ethPrice: number }) {
  const [amount, setAmount] = useState(1);
  const [take, setTake] = useState(0.5);
  const debt = amount * ethPrice * live.ltv * take;
  const liq = liquidationPrice(debt, amount, live.liquidation) ?? 0;
  const drop = 1 - liq / ethPrice;
  return (
    <div className="rounded-2xl border border-line bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[20px] font-medium">Sound the anchor</h2>
        <span className="tag text-ink-3">ETH {fmtPrice(ethPrice)} · signed Coinbase feed</span>
      </div>
      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <label className="block">
            <span className="flex justify-between text-[13px] text-ink-2">
              <span>ETH anchored</span>
              <span className="num">{eth(amount)}</span>
            </span>
            <input type="range" min={0.1} max={10} step={0.1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="mt-2 w-full accent-[var(--color-accent)]" />
          </label>
          <label className="block">
            <span className="flex justify-between text-[13px] text-ink-2">
              <span>Share of the borrow limit you take</span>
              <span className="num">{Math.round(take * 100)}%</span>
            </span>
            <input type="range" min={0.05} max={1} step={0.05} value={take} onChange={(e) => setTake(Number(e.target.value))} className="mt-2 w-full accent-[var(--color-accent)]" />
          </label>
        </div>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line text-[13px]">
          <div className="bg-card p-3">
            <dt className="text-ink-3">You borrow</dt>
            <dd className="num mt-1 text-[18px] font-medium">{money(debt)}</dd>
          </div>
          <div className="bg-card p-3">
            <dt className="text-ink-3">Anchor drags at</dt>
            <dd className="num mt-1 text-[18px] font-medium text-warn">{fmtPrice(liq)}</dd>
          </div>
          <div className="bg-card p-3">
            <dt className="text-ink-3">ETH can fall</dt>
            <dd className="num mt-1 text-[18px] font-medium">{(drop * 100).toFixed(1)}%</dd>
          </div>
          <div className="bg-card p-3">
            <dt className="text-ink-3">Interest a year</dt>
            <dd className="num mt-1 text-[18px] font-medium">{money(debt * borrowApr(live.model, live.util))}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function Actions({ live, ethPrice }: { live: LendingLive | undefined; ethPrice: number }) {
  const { address } = useAccount();
  const { send, busy } = useTx();
  const { data: mine } = useLendingMine();
  const { data: walletUsd } = useWalletUsd();
  const { data: walletEth } = useBalance({ address, chainId: HUB.chainId });
  const [side, setSide] = useState<"borrow" | "lend">("borrow");
  const [step, setStep] = useState<"lock" | "borrow" | "repay" | "unlock" | "supply" | "withdraw">("lock");
  const [toMargin, setToMargin] = useState(true);
  const [value, setValue] = useState("");
  const steps = side === "borrow" ? (["lock", "borrow", "repay", "unlock"] as const) : (["supply", "withdraw"] as const);
  const isEth = step === "lock" || step === "unlock";
  const amount = isEth ? (() => { try { return value ? parseEther(value) : 0n; } catch { return 0n; } })() : amountUnits(value);

  const room = live && mine ? borrowRoom(mine.eth, ethPrice, live.ltv, mine.debt) : 0;
  const max: bigint = !mine
    ? 0n
    : step === "lock"
      ? (walletEth?.value ?? 0n) > parseEther("0.0002") ? walletEth!.value - parseEther("0.0002") : 0n // keep gas
      : step === "unlock"
        ? unlockable(mine.ethRaw, mine.debt, ethPrice, live?.ltv ?? 0)
        : step === "borrow"
          ? BigInt(Math.floor(Math.min(room, live?.cash ?? 0) * 0.995 * 1e6))
          : step === "repay"
            ? (mine.debtRaw < (walletUsd ?? 0n) ? mine.debtRaw : (walletUsd ?? 0n))
            : step === "supply"
              ? walletUsd ?? 0n
              : mine.maxWithdraw;
  const show = (v: bigint) => (isEth ? Number(formatEther(v)) : units6(v));

  async function go() {
    if (!address) return;
    const L = { chainId: HUB.chainId, address: LENDING, abi: omnitideLendingAbi } as const;
    const usd = { chainId: HUB.chainId, address: usdAddress(HUB_KEY), abi: omnitideUSDAbi } as const;
    const report = async () => (await fetchReports(["ETH-USD"]))[0]!;
    if (step === "lock") await send(`Anchor ${value} ETH`, { ...L, functionName: "depositETH", args: [address], value: amount });
    if (step === "unlock") await send(`Raise ${value} ETH`, { ...L, functionName: "withdrawCollateral", args: [amount, address, await report()] });
    if (step === "borrow")
      await send(toMargin ? `Borrow ${value} tdUSD into margin` : `Borrow ${value} tdUSD`, toMargin ? { ...L, functionName: "borrowToMargin", args: [amount, await report()] } : { ...L, functionName: "borrow", args: [amount, address, await report()] });
    if (step === "repay") {
      const all = mine && amount >= mine.debtRaw;
      // interest keeps ticking between blocks: a full repay approves a hair over and lets the contract take exactly what is owed
      await send("Approve tdUSD for Lending", { ...usd, functionName: "approve", args: [LENDING, all ? (amount * 1001n) / 1000n + 1n : amount] });
      await send(`Repay ${value} tdUSD`, { ...L, functionName: "repay", args: [all ? maxUint256 : amount, address] });
    }
    if (step === "supply") {
      await send("Approve tdUSD for Lending", { ...usd, functionName: "approve", args: [LENDING, amount] });
      await send(`Lend ${value} tdUSD`, { ...L, functionName: "deposit", args: [amount, address] });
    }
    if (step === "withdraw") await send(`Withdraw ${value} tdUSD`, { ...L, functionName: "withdraw", args: [amount, address, address] });
    setValue("");
  }

  const label: Record<typeof step, string> = { lock: "Anchor ETH", borrow: toMargin ? "Borrow into margin" : "Borrow to wallet", repay: "Repay", unlock: "Raise ETH", supply: "Lend tdUSD", withdraw: "Withdraw" };
  const hint: Record<typeof step, string> = {
    lock: "ETH you lock stays yours. It is wrapped to WETH and held by OmnitideLending until you raise it.",
    borrow: `Up to ${Math.round((live?.ltv ?? 0.7) * 100)}% of your ETH's value. Into margin lands as trading collateral in the same transaction.`,
    repay: "Anyone can repay for any account, so a friend, a bot or an Inlet can clear your debt too.",
    unlock: "Raise as much ETH as keeps your loan inside the borrow limit.",
    supply: "Your tdUSD earns what borrowers pay, minus a 10% cut that flows into Harbor's Tide Pool.",
    withdraw: "Withdraw from idle cash. Lent-out tdUSD comes back as borrowers repay, and the rate curve pulls it back fast.",
  };

  return (
    <section className="rounded-2xl border border-line bg-card">
      <div className="flex gap-1 border-b border-line px-2" role="tablist" aria-label="Lending">
        {(["borrow", "lend"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={side === t}
            onClick={() => {
              setSide(t);
              setStep(t === "borrow" ? "lock" : "supply");
              setValue("");
            }}
            className={`relative h-11 px-3 text-[14px] capitalize transition-colors ${side === t ? "text-ink" : "text-ink-3 hover:text-ink-2"}`}
          >
            {t}
            {side === t && <span className="absolute inset-x-3 -bottom-px h-px bg-accent" />}
          </button>
        ))}
      </div>
      <div className="space-y-4 p-4">
        {!address ? (
          <Connect size="md" />
        ) : (
          <>
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Action">
              {steps.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={step === s} onClick={() => { setStep(s); setValue(""); }} className={`btn btn-sm ${step === s ? "bg-raised text-ink" : "btn-ghost"}`}>
                  {label[s].split(" ")[0]}
                </button>
              ))}
            </div>
            {step === "borrow" && (
              <div className="flex gap-1 rounded-lg border border-line p-1 text-[13px]" role="radiogroup" aria-label="Borrow to">
                {[true, false].map((m) => (
                  <button key={String(m)} type="button" role="radio" aria-checked={toMargin === m} onClick={() => setToMargin(m)} className={`flex-1 rounded-md py-1.5 transition-colors ${toMargin === m ? "bg-raised text-ink" : "text-ink-3 hover:text-ink-2"}`}>
                    {m ? "Into trading margin" : "To my wallet"}
                  </button>
                ))}
              </div>
            )}
            <label className="block">
              <span className="flex justify-between text-[13px] text-ink-2">
                <span>{isEth ? "ETH" : "tdUSD"}</span>
                {max > 0n && (
                  <button type="button" className="num text-ink-3 hover:text-ink" onClick={() => setValue(isEth ? formatEther(max) : String(units6(max)))}>
                    max {show(max).toLocaleString("en-US", { maximumFractionDigits: isEth ? 6 : 2 })}
                  </button>
                )}
              </span>
              <input className="field mt-1" inputMode="decimal" placeholder="0.00" value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))} />
            </label>
            <p className="text-[13px] leading-5 text-ink-2">{hint[step]}</p>
            <button type="button" className="btn btn-primary w-full" disabled={busy || amount === 0n || amount > max} onClick={() => void go().catch(() => {})}>
              {label[step]}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function MyAnchor({ live, ethPrice }: { live: LendingLive; ethPrice: number }) {
  const { data: mine } = useLendingMine();
  if (!mine || (mine.eth === 0 && mine.debt === 0 && mine.lent === 0)) return null;
  const liq = liquidationPrice(mine.debt, mine.eth, live.liquidation);
  const hold = anchorHold(mine.debt, mine.eth * ethPrice, live.liquidation);
  const rows = [
    mine.eth > 0 && ["ETH anchored", `${eth(mine.eth)} · ${money(mine.eth * ethPrice)}`],
    mine.debt > 0 && ["Borrowed", money(mine.debt)],
    mine.eth > 0 && ["Room to borrow", money(borrowRoom(mine.eth, ethPrice, live.ltv, mine.debt))],
    liq && ["Anchor drags at", `ETH ${fmtPrice(liq)}`],
    mine.lent > 0 && ["Lent, with interest", money(mine.lent)],
  ].filter(Boolean) as [string, string][];
  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">Your anchor</p>
        {mine.debt > 0 && <TideGauge level={hold} label="Distance from liquidation" />}
      </div>
      <dl className="mt-2 space-y-1 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <dt className="text-ink-3">{k}</dt>
            <dd className="num text-right">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function Lending() {
  const { data: live } = useLendingLive();
  const prices = usePriceMap();
  const ethPrice = prices["ETH-USD"] ?? 0;
  const { data: flows } = useIndexer<Flow[]>("lending");
  const borrowNow = live ? borrowApr(live.model, live.util) : 0;
  const lendNow = live ? supplyApr(live.model, live.util, live.reserve) : 0;

  const figures = useMemo(
    () =>
      live
        ? [
            live.supplied > 0 && { label: "Supplied", value: moneyCompact(live.supplied) },
            live.borrowed > 0 && { label: "Borrowed", value: moneyCompact(live.borrowed) },
            live.ethLocked > 0 && { label: "ETH anchored", value: ethPrice ? moneyCompact(live.ethLocked * ethPrice) : eth(live.ethLocked) },
            live.borrowed > 0 && { label: "Borrow APR", value: apr(borrowNow) },
            live.borrowed > 0 && { label: "Lender APR", value: apr(lendNow) },
            { label: "Opening cap", value: moneyCompact(live.supplyCap) },
          ].filter(Boolean) as { label: string; value: string }[]
        : [],
    [live, ethPrice, borrowNow, lendNow],
  );

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_380px]">
      <section className="flex min-w-0 flex-col gap-3">
        <div className="rounded-2xl border border-line bg-card p-5">
          <p className="tag text-ink-3">Anchor · ERC-4626 lending on Robinhood Chain · ETH collateral · signed ETH-USD price</p>
          <h1 className="display mt-2 text-[44px] text-ink">Lending</h1>
          <p className="mt-2 max-w-2xl text-[14px] leading-[22px] text-ink-2">
            Drop anchor on your ETH and borrow dollars without selling a wei of it. Take the tdUSD to your wallet or straight into trading margin in one transaction. On the other side, lenders park tdUSD and collect what borrowers pay, priced by a curve that never lets the pool run dry.
          </p>
          {live ? (
            <dl className="mt-6 flex flex-wrap gap-px overflow-hidden rounded-xl border border-line bg-line">
              {figures.map((f) => (
                <div key={f.label} className="min-w-[140px] flex-1 bg-card p-4">
                  <dt className="text-[13px] text-ink-3">{f.label}</dt>
                  <dd className="num mt-1 text-[22px] leading-8 font-medium">{f.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <div className="mt-6 h-24 animate-pulse rounded-xl bg-raised" />
          )}
        </div>

        {live && <RateCurve live={live} />}
        {live && ethPrice > 0 && <AnchorCalculator live={live} ethPrice={ethPrice} />}

        <div className="rounded-2xl border border-line bg-card">
          <h2 className="px-5 pt-5 text-[20px] font-medium">Anchorage log</h2>
          {flows && flows.length > 0 ? (
            <div className="relative mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[13px]">
                <thead className="text-[12px] text-ink-3">
                  <tr>
                    {["Move", "Amount", "Account", "When", "Hub tx"].map((h) => (
                      <th key={h} className="px-5 py-2 font-normal">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {flows.map((f) => (
                    <tr key={f.id} className="border-t border-line">
                      <td className="px-5 py-3 font-medium">
                        {KIND[f.kind] ?? f.kind}
                        {f.toMargin && <span className="tag ml-2 text-accent">into margin</span>}
                      </td>
                      <td className="num px-5 py-3">
                        {f.kind === "lock" || f.kind === "unlock" ? eth(Number(formatEther(BigInt(f.amount)))) : money(units6(f.amount))}
                        {f.seized && <span className="ml-2 text-ink-3">for {eth(Number(formatEther(BigInt(f.seized))))}</span>}
                      </td>
                      <td className="px-5 py-3 font-mono text-[12px] text-ink-2">{who(f.account)}</td>
                      <td className="px-5 py-3 text-ink-3">{ago(f.timestamp)}</td>
                      <td className="px-5 py-3">
                        <a href={explorerTx(HUB_KEY, f.tx)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] text-ink-2 hover:text-ink">
                          {shortHash(f.tx)}
                          <ExternalLink size={12} strokeWidth={1.5} />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-5 py-8 text-[14px] text-ink-2">Every loan, repayment and liquidation is written here with its Robinhood Chain transaction.</p>
          )}
        </div>
      </section>

      <aside className="flex flex-col gap-3">
        <Actions live={live} ethPrice={ethPrice} />
        {live && ethPrice > 0 && <MyAnchor live={live} ethPrice={ethPrice} />}
        <div className="rounded-2xl border border-line bg-card p-4 text-[13px] leading-5 text-ink-2">
          <p className="font-medium text-ink">How the anchor holds</p>
          <ol className="mt-2 list-decimal space-y-1 pl-4">
            <li>Lock ETH. Borrow up to {Math.round((live?.ltv ?? 0.7) * 100)}% of its value in tdUSD, priced by a keeper-signed ETH-USD report the contract verifies.</li>
            <li>Interest accrues every second on a kinked curve: cheap while the pool is deep, steep once {Math.round((live?.model.kink ?? 0.8) * 100)}% is lent out.</li>
            <li>Past {Math.round((live?.liquidation ?? 0.8) * 100)}%, anyone may repay up to half the loan and take that much ETH plus {Math.round((live?.bonus ?? 0.05) * 100)}%. The keeper watches every loan around the clock.</li>
            <li>{Math.round((live?.reserve ?? 0.1) * 100)}% of all interest sails to Harbor's Tide Pool, so LPs earn from borrowing too.</li>
          </ol>
          {live && <p className="num mt-3 text-ink-3">Idle tdUSD ready to lend {moneyCompact(live.cash)}</p>}
        </div>
      </aside>
    </div>
  );
}
