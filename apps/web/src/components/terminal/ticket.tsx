"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { Lock } from "lucide-react";
import { randomSalt, seal, sealedOrderCommitment, type SealedOrderPlain } from "@omnitide/contracts/deep";
import type { Hex } from "viem";
import type { MarketConfig } from "@omnitide/contracts/markets";
import { HUB } from "@/lib/chains";
import { CLEARINGHOUSE, CH_ABI, FEE_BPS } from "@/lib/contracts";
import { fetchReports, feedsFor, useHubAccount } from "@/lib/account";
import { usePriceMap } from "@/lib/hooks";
import { accountHealth, liquidationPrice } from "@/lib/margin";
import { leverage, money, price as fmtPrice, fee as feeText } from "@/lib/format";
import { useTx } from "@/lib/tx";
import { useDeepKeys } from "@/lib/deep";
import { Connect } from "../connect";
import { QuickFund } from "./quick-fund";

type Kind = "market" | "limit" | "stop" | "tp";
const KINDS: { k: Kind; label: string }[] = [
  { k: "market", label: "Market" },
  { k: "limit", label: "Limit" },
  { k: "stop", label: "Stop-loss" },
  { k: "tp", label: "Take-profit" },
];
const ORDER_KIND = { limit: 0, stop: 1, tp: 2 } as const;
const SLIPPAGE = 0.005;

/** Fixed-point helpers: display numbers into contract units without float drift past what we show. */
const toWad = (v: number) => BigInt(Math.round(v * 1e8)) * 10n ** 10n;
const baseToWad = (v: number) => BigInt(Math.round(v * 1e12)) * 10n ** 6n;

export function Ticket({ market }: { market: MarketConfig }) {
  const { isConnected, address } = useAccount();
  const { data: acct } = useHubAccount();
  const deepKeys = useDeepKeys();
  const [sealed, setSealed] = useState(false);
  const prices = usePriceMap();
  const { send, busy } = useTx();
  const [side, setSide] = useState<1 | -1>(1);
  const [kind, setKind] = useState<Kind>("market");
  const [usd, setUsd] = useState("");
  const [trigger, setTrigger] = useState("");

  const mark = prices[market.feed];
  const positions = acct?.positions ?? [];
  const current = positions.find((p) => p.marketId === market.id);
  const health = accountHealth(acct?.collateral ?? 0, positions, prices);
  const maxNotional = Math.max(0, health.free) * (10_000 / market.initialMarginBps);
  const reduceKinds = kind === "stop" || kind === "tp";
  const execPrice = kind === "market" ? mark : Number(trigger) || undefined;
  const notional = Number(usd) || 0;
  const base = execPrice ? notional / execPrice : 0;
  const fee = (notional * FEE_BPS) / 10_000;

  const preview = useMemo(() => {
    if (!execPrice || base <= 0) return null;
    const signed = side * base;
    const prevSize = current?.size ?? 0;
    const nextSize = prevSize + signed;
    const entry = Math.sign(prevSize) === side && prevSize !== 0 ? (Math.abs(prevSize) * (current?.entry ?? 0) + base * execPrice) / Math.abs(nextSize) : execPrice;
    const others = positions.filter((p) => p.marketId !== market.id);
    const h = accountHealth((acct?.collateral ?? 0) - fee, [...others, ...(nextSize !== 0 ? [{ marketId: market.id, size: nextSize, entry }] : [])], prices);
    const otherUpnl = h.equity - (acct?.collateral ?? 0) + fee;
    const liq = nextSize !== 0 ? liquidationPrice(nextSize > 0 ? 1 : -1, nextSize, entry, (acct?.collateral ?? 0) - fee + otherUpnl, market.maintenanceMarginBps) : null;
    return { h, liq, nextSize };
  }, [execPrice, base, side, current, positions, acct, fee, prices, market]);

  const increases = !current || Math.sign(current.size) === side;
  const tooBig = kind === "market" && increases && notional > maxNotional + 0.01;
  const stopNeedsPosition = reduceKinds && !current;
  const canSubmit = isConnected && notional > 0 && !!execPrice && !tooBig && !stopNeedsPosition && !busy;

  async function submit() {
    if (!execPrice) return;
    const sizeDelta = BigInt(side) * baseToWad(base);
    if (kind === "market") {
      const reports = await fetchReports(feedsFor(positions, market.feed));
      const limit = toWad(execPrice * (1 + side * SLIPPAGE));
      await send(`${side > 0 ? "Long" : "Short"} ${market.symbol} ${money(notional)}`, { chainId: HUB.chainId, address: CLEARINGHOUSE, abi: CH_ABI, functionName: "trade", args: [market.id, sizeDelta, limit, reports] });
    } else if (sealed && reduceKinds && address && deepKeys.keys) {
      // trigger, size and side go on-chain only as a commitment plus a box for the keeper and you
      const plain: SealedOrderPlain = { marketId: market.id, kind: ORDER_KIND[kind], sizeDelta: sizeDelta.toString(), triggerPrice: toWad(execPrice).toString(), salt: randomSalt() };
      const { keeperKey } = (await (await fetch("/api/keeper/deep/key")).json()) as { keeperKey: Hex };
      await send(`Sealed ${KINDS.find((k) => k.k === kind)!.label.toLowerCase()} on ${market.symbol}`, {
        chainId: HUB.chainId,
        address: CLEARINGHOUSE,
        abi: CH_ABI,
        functionName: "placeSealedOrder",
        args: [sealedOrderCommitment(address, plain), seal([keeperKey, deepKeys.keys.viewPublic], JSON.stringify(plain))],
      });
    } else {
      await send(`${KINDS.find((k) => k.k === kind)!.label} ${market.symbol} at ${fmtPrice(execPrice)}`, {
        chainId: HUB.chainId,
        address: CLEARINGHOUSE,
        abi: CH_ABI,
        functionName: "placeOrder",
        args: [market.id, ORDER_KIND[kind], sizeDelta, toWad(execPrice), reduceKinds],
      });
    }
    setUsd("");
  }

  function pickKind(k: Kind) {
    setKind(k);
    if ((k === "stop" || k === "tp") && current) {
      setSide(current.size > 0 ? -1 : 1);
      setUsd((Math.abs(current.size) * (mark ?? current.entry)).toFixed(2));
    }
  }

  const needsFunding = isConnected && acct && acct.collateral < 1 && positions.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-raised p-1">
        {([1, -1] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSide(s)}
            aria-pressed={side === s}
            className={`h-9 rounded-lg text-[14px] font-medium transition-colors ${side === s ? (s > 0 ? "bg-flood text-white" : "bg-ebb text-white") : "text-ink-2 hover:text-ink"}`}
          >
            {s > 0 ? "Long" : "Short"}
          </button>
        ))}
      </div>

      <div className="relative flex gap-1 overflow-x-auto" role="tablist" aria-label="Order type">
        {KINDS.map(({ k, label }) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => pickKind(k)} className={`btn btn-sm shrink-0 ${kind === k ? "bg-raised text-ink" : "btn-ghost"}`}>
            {label}
          </button>
        ))}
      </div>

      {kind !== "market" && (
        <label className="block">
          <span className="text-[13px] text-ink-2">Trigger price</span>
          <input className="field mt-1" inputMode="decimal" placeholder={mark ? fmtPrice(mark).replace("$", "") : ""} value={trigger} onChange={(e) => setTrigger(e.target.value.replace(/[^0-9.]/g, ""))} />
        </label>
      )}

      <label className="block">
        <span className="flex justify-between text-[13px] text-ink-2">
          <span>Size</span>
          {isConnected && maxNotional > 1 && <span className="num text-ink-3">up to {money(maxNotional)}</span>}
        </span>
        <div className="relative mt-1">
          <input className="field pr-14" inputMode="decimal" placeholder="0.00" value={usd} onChange={(e) => setUsd(e.target.value.replace(/[^0-9.]/g, ""))} aria-label="Size in USD" />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[13px] text-ink-3">USD</span>
        </div>
      </label>

      {isConnected && maxNotional > 1 && kind === "market" && (
        <div className="grid grid-cols-4 gap-1">
          {[0.1, 0.25, 0.5, 0.9].map((f) => (
            <button key={f} type="button" className="btn btn-secondary btn-sm px-0" onClick={() => setUsd((maxNotional * f).toFixed(2))}>
              {f * 100}%
            </button>
          ))}
        </div>
      )}

      <dl className="space-y-2 border-t border-line pt-4 text-[13px]">
        {[
          ["Price", execPrice ? fmtPrice(execPrice) : null],
          ["Size", base > 0 ? `${base.toPrecision(5)} ${market.symbol}` : null],
          ["Margin used", notional > 0 ? money((notional * market.initialMarginBps) / 10_000) : null],
          ["Fee", fee > 0 ? feeText(fee) : null],
          ["Liquidation", preview?.liq ? fmtPrice(preview.liq) : null],
          ["Max leverage", leverage(market.initialMarginBps)],
        ]
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <dt className="text-ink-3">{k}</dt>
              <dd className="num">{v}</dd>
            </div>
          ))}
      </dl>

      {reduceKinds && isConnected && (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 text-[13px] leading-5">
          <input type="checkbox" className="mt-0.5 accent-[var(--color-accent)]" checked={sealed} onChange={(e) => setSealed(e.target.checked)} />
          <span>
            <span className="flex items-center gap-1.5 font-medium text-ink">
              <Lock size={13} strokeWidth={1.75} /> Seal it
            </span>
            <span className="text-ink-2">Private order: trigger and size stay encrypted on-chain until the keeper fills it. Stop hunters see a hash.</span>
          </span>
        </label>
      )}

      {stopNeedsPosition && <p className="text-[13px] text-ink-2">Stop-loss and take-profit protect an open position. Open one in {market.symbol} first.</p>}
      {tooBig && <p className="text-[13px] text-ebb">That size needs more free margin than the account has.</p>}

      {!isConnected ? (
        <Connect size="md" />
      ) : needsFunding ? (
        <QuickFund />
      ) : sealed && reduceKinds && !deepKeys.keys ? (
        <button type="button" className="btn btn-primary btn-lg w-full" onClick={() => void deepKeys.unlock().catch(() => {})}>
          <Lock size={15} strokeWidth={1.75} /> Unlock Deep keys to seal
        </button>
      ) : (
        <button type="button" disabled={!canSubmit} onClick={() => void submit().catch(() => {})} className={`btn btn-lg w-full text-white ${side > 0 ? "bg-flood hover:bg-flood/90" : "bg-ebb hover:bg-ebb/90"}`}>
          {kind === "market" ? `${side > 0 ? "Long" : "Short"} ${market.symbol}` : `Place ${KINDS.find((k) => k.k === kind)!.label.toLowerCase()}`}
        </button>
      )}
      <p className="tag text-ink-3">Filled at the signed oracle price · {SLIPPAGE * 100}% max slippage · fee {FEE_BPS / 100}%</p>
    </div>
  );
}
