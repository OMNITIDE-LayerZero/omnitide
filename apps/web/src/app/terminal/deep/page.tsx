"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient } from "wagmi";
import { encodeAbiParameters, pad, type Hex } from "viem";
import { Check, Copy, ExternalLink, Eye, EyeOff, Lock, ShieldCheck } from "lucide-react";
import { CHAINS } from "@omnitide/contracts/chains";
import { detailHash, disclosureKey, open as openBox, type DeepBook } from "@omnitide/contracts/deep";
import { HUB, HUB_KEY, SHORT, explorerTx } from "@/lib/chains";
import { DEEP_POOL, MARKETS, V3_CHAINS, omnitideDeepPoolAbi, omnitideUSDAbi, omnitideClearinghouseAbi, CLEARINGHOUSE, usdAddress } from "@/lib/contracts";
import { useDeepActions, useDeepBook, useDeepKeys, type DeepNote, type Unlocked } from "@/lib/deep";
import { fetchReports, feedsFor, useLocalToken } from "@/lib/account";
import { useIndexer, usePriceMap } from "@/lib/hooks";
import { accountHealth } from "@/lib/margin";
import { ago, money, price as fmtPrice, shortHash, signedMoney, realized, units6, upnl, wad } from "@/lib/format";
import { explain, useTx } from "@/lib/tx";
import { toast } from "@/components/toasts";
import { amountUnits } from "@/components/terminal/collateral";
import { Connect } from "@/components/connect";
import { TideGauge } from "@/components/tide-gauge";

const SLIPPAGE = 0.01;
const toWad = (v: number) => BigInt(Math.round(v * 1e8)) * 10n ** 10n;
const baseToWad = (v: number) => BigInt(Math.round(v * 1e12)) * 10n ** 6n;
const positionsOf = (b: DeepBook | null) => (b?.positions ?? []).map((p) => ({ marketId: p.marketId, size: wad(p.size), entry: wad(p.entry) }));

function Dive({ onUnlock }: { onUnlock: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <section className="rounded-2xl border border-line bg-card p-5">
      <p className="font-medium">Dive in</p>
      <p className="mt-2 text-[13px] leading-5 text-ink-2">
        One signature derives your Deep id and an x25519 view key on this device. A second, typed signature hands the keeper the public half so it can seal your book to you. Neither costs gas.
      </p>
      <button
        type="button"
        className="btn btn-primary mt-4 w-full"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          onUnlock()
            .catch((e) => toast.push({ kind: "error", title: "Deep Mode stayed locked", body: explain(e) }))
            .finally(() => setBusy(false));
        }}
      >
        <Lock size={15} strokeWidth={1.75} /> Unlock Deep Mode
      </button>
      <ul className="mt-4 space-y-1.5 text-[13px] leading-5 text-ink-2">
        <li>· Same wallet, same signature, same keys on any device</li>
        <li>· Keys stay in this tab and vanish when it closes</li>
        <li>· Withdrawals still need your wallet's own signature</li>
      </ul>
    </section>
  );
}

function Fund({ keys }: { keys: Unlocked }) {
  const { send, busy } = useTx();
  const [from, setFrom] = useState(V3_CHAINS[0]!);
  const [value, setValue] = useState("");
  const amount = amountUnits(value);
  const { data: local } = useLocalToken(CHAINS[from].chainId);
  const client = usePublicClient({ chainId: CHAINS[from].chainId });
  const remote = from !== HUB_KEY;
  const balance = local?.balanceRaw ?? 0n;

  async function go() {
    if (!remote) {
      await send("Approve tdUSD for the Deep pool", { chainId: HUB.chainId, address: usdAddress(HUB_KEY), abi: omnitideUSDAbi, functionName: "approve", args: [DEEP_POOL, amount] });
      await send(`Sink ${value} tdUSD into Deep`, { chainId: HUB.chainId, address: DEEP_POOL, abi: omnitideDeepPoolAbi, functionName: "deposit", args: [keys.id, amount] });
    } else {
      // private Inflow: the OFT lands on the pool and lzCompose credits the Deep id, never your hub account
      const p = { dstEid: HUB.eid, to: pad(DEEP_POOL, { size: 32 }), amountLD: amount, minAmountLD: amount, extraOptions: "0x" as const, composeMsg: encodeAbiParameters([{ type: "bytes32" }], [keys.id]), oftCmd: "0x" as const };
      const q = await client!.readContract({ address: usdAddress(from), abi: omnitideUSDAbi, functionName: "quoteSend", args: [p, false] });
      await send(`Private Inflow from ${SHORT[from]}`, { chainId: CHAINS[from].chainId, address: usdAddress(from), abi: omnitideUSDAbi, functionName: "send", args: [p, { nativeFee: q.nativeFee, lzTokenFee: 0n }, keys.owner], value: q.nativeFee });
    }
    setValue("");
  }

  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <p className="font-medium">Sink collateral</p>
      <div className="mt-3 flex flex-wrap gap-1" role="radiogroup" aria-label="Source chain">
        {V3_CHAINS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={from === k} onClick={() => setFrom(k)} className={`btn btn-sm ${from === k ? "bg-raised text-ink" : "btn-ghost"}`}>
            {SHORT[k]}
          </button>
        ))}
      </div>
      <label className="mt-3 block">
        <span className="flex justify-between text-[13px] text-ink-2">
          <span>tdUSD</span>
          {balance > 0n && (
            <button type="button" className="num text-ink-3 hover:text-ink" onClick={() => setValue(String(units6(balance)))}>
              {units6(balance).toLocaleString("en-US")} on {SHORT[from]}
            </button>
          )}
        </span>
        <input className="field mt-1" inputMode="decimal" placeholder="0.00" value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))} />
      </label>
      <p className="mt-2 text-[12px] leading-[18px] text-ink-3">
        {remote ? "LayerZero OFT + lzCompose into OmnitideDeepPool. Lands in about a minute." : "Straight into OmnitideDeepPool on Robinhood Chain."} The deposit is public; everything after it is sealed.
      </p>
      <button type="button" className="btn btn-primary mt-3 w-full" disabled={busy || amount === 0n || amount > balance} onClick={() => void go().catch(() => {})}>
        {remote ? `Inflow from ${SHORT[from]}` : "Sink into Deep"}
      </button>
    </section>
  );
}

function DeepTicket({ keys, book }: { keys: Unlocked; book: DeepBook | null }) {
  const prices = usePriceMap();
  const { trade } = useDeepActions(keys);
  const [marketId, setMarketId] = useState(0);
  const [side, setSide] = useState<1 | -1>(1);
  const [usd, setUsd] = useState("");
  const [busy, setBusy] = useState(false);
  const m = MARKETS[marketId]!;
  const mark = prices[m.feed];
  const h = accountHealth(units6(book?.collateral ?? "0"), positionsOf(book), prices);
  const max = Math.max(0, h.free) * (10_000 / m.initialMarginBps);
  const notional = Number(usd) || 0;

  async function go() {
    if (!mark) return;
    setBusy(true);
    const id = toast.push({ kind: "pending", title: `Deep ${side > 0 ? "long" : "short"} ${m.symbol}`, body: "Sign the intent in your wallet" });
    try {
      const tx = await trade(m.id, BigInt(side) * baseToWad(notional / mark), toWad(mark * (1 + side * SLIPPAGE)));
      toast.update(id, { kind: "success", body: "Filled through the pool, sealing your book", href: explorerTx(HUB_KEY, tx) });
      setUsd("");
    } catch (e) {
      toast.update(id, { kind: "error", body: explain(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <div className="flex items-baseline justify-between">
        <p className="font-medium">Deep order</p>
        <span className="tag text-ink-3">EIP-712 intent · no gas</span>
      </div>
      <select className="field mt-3" value={marketId} onChange={(e) => setMarketId(Number(e.target.value))} aria-label="Market">
        {MARKETS.map((x) => (
          <option key={x.id} value={x.id}>
            {x.symbol}-PERP · {x.name}
          </option>
        ))}
      </select>
      <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-raised p-1">
        {([1, -1] as const).map((s) => (
          <button key={s} type="button" aria-pressed={side === s} onClick={() => setSide(s)} className={`h-9 rounded-lg text-[14px] font-medium transition-colors ${side === s ? (s > 0 ? "bg-flood text-white" : "bg-ebb text-white") : "text-ink-2 hover:text-ink"}`}>
            {s > 0 ? "Long" : "Short"}
          </button>
        ))}
      </div>
      <label className="mt-3 block">
        <span className="flex justify-between text-[13px] text-ink-2">
          <span>Size</span>
          {max > 1 && (
            <button type="button" className="num text-ink-3 hover:text-ink" onClick={() => setUsd((max * 0.9).toFixed(2))}>
              up to {money(max)}
            </button>
          )}
        </span>
        <div className="relative mt-1">
          <input className="field pr-14" inputMode="decimal" placeholder="0.00" value={usd} onChange={(e) => setUsd(e.target.value.replace(/[^0-9.]/g, ""))} aria-label="Size in USD" />
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[13px] text-ink-3">USD</span>
        </div>
      </label>
      {mark && <p className="num mt-2 text-[13px] text-ink-2">Mark {fmtPrice(mark)} · fills at the signed oracle price, {SLIPPAGE * 100}% max slippage</p>}
      <button
        type="button"
        disabled={busy || !mark || notional <= 0}
        onClick={() => void go()}
        className={`btn btn-lg mt-3 w-full text-white ${side > 0 ? "bg-flood hover:bg-flood/90" : "bg-ebb hover:bg-ebb/90"}`}
      >
        {side > 0 ? "Long" : "Short"} {m.symbol} in Deep
      </button>
    </section>
  );
}

function Withdraw({ keys, book }: { keys: Unlocked; book: DeepBook | null }) {
  const { withdraw } = useDeepActions(keys);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const amount = amountUnits(value);
  const held = BigInt(book?.collateral ?? "0");
  if (held === 0n) return null;

  async function go() {
    setBusy(true);
    const id = toast.push({ kind: "pending", title: `Surface ${value} tdUSD`, body: "Sign the withdrawal in your wallet" });
    try {
      const tx = await withdraw(amount, DEEP_POOL);
      toast.update(id, { kind: "success", body: "Paid to your wallet on Robinhood Chain", href: explorerTx(HUB_KEY, tx) });
      setValue("");
    } catch (e) {
      toast.update(id, { kind: "error", body: explain(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <p className="font-medium">Surface</p>
      <label className="mt-3 block">
        <span className="flex justify-between text-[13px] text-ink-2">
          <span>tdUSD out</span>
          <button type="button" className="num text-ink-3 hover:text-ink" onClick={() => setValue(String(units6(held)))}>
            {money(units6(held))} in Deep
          </button>
        </span>
        <input className="field mt-1" inputMode="decimal" placeholder="0.00" value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ""))} />
      </label>
      <p className="mt-2 text-[12px] leading-[18px] text-ink-3">Your wallet signs a DeepWithdrawal; OmnitideDeepPool checks that signature on-chain before a cent moves.</p>
      <button type="button" className="btn btn-secondary mt-3 w-full" disabled={busy || amount === 0n || amount > held} onClick={() => void go()}>
        Withdraw to wallet
      </button>
    </section>
  );
}

function Disclosure({ keys }: { keys: Unlocked }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const dk = disclosureKey(keys.id, keys.viewPrivate);
  return (
    <section className="rounded-2xl border border-line bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="font-medium">Disclosure Key</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShown((s) => !s)} aria-label={shown ? "Hide key" : "Show key"}>
          {shown ? <EyeOff size={15} strokeWidth={1.75} /> : <Eye size={15} strokeWidth={1.75} />}
        </button>
      </div>
      <p className="mt-2 text-[13px] leading-5 text-ink-2">Read-only. Hand it to an auditor, a fund admin or your accountant: they replay every sealed state and check it against the chain. It can't trade or withdraw.</p>
      <code className={`mt-3 block rounded-lg bg-raised p-3 font-mono text-[11px] leading-4 break-all ${shown ? "text-ink-2" : "text-ink-3 blur-[3px] select-none"}`}>{dk}</code>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            void navigator.clipboard.writeText(dk).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check size={14} strokeWidth={1.75} /> : <Copy size={14} strokeWidth={1.75} />} {copied ? "Copied" : "Copy key"}
        </button>
        <Link href="/disclosure" className="btn btn-ghost btn-sm">
          Auditor view
        </Link>
      </div>
    </section>
  );
}

function EscapeHatch({ keys, book, verified }: { keys: Unlocked; book: DeepBook | null; verified: boolean }) {
  const client = usePublicClient({ chainId: HUB.chainId });
  const { send, busy } = useTx();
  const { data: note } = useQuery({
    queryKey: ["deep-note", keys.id],
    refetchInterval: 15_000,
    enabled: !!client,
    queryFn: () => client!.readContract({ address: DEEP_POOL, abi: omnitideDeepPoolAbi, functionName: "notes", args: [keys.id] }),
  });
  const exitAt = note ? Number(note[2]) : 0;
  const flat = !!book && book.positions.length === 0 && BigInt(book.collateral) > 0n;
  if (!flat && !exitAt) return null;
  const ready = exitAt > 0 && Date.now() / 1000 >= exitAt;

  async function request() {
    await send("Request a keeper-free exit", { chainId: HUB.chainId, address: DEEP_POOL, abi: omnitideDeepPoolAbi, functionName: "requestExit", args: [keys.salt, BigInt(book!.collateral), detailHash(book!)] });
  }
  async function exit() {
    const open = (await client!.readContract({ address: CLEARINGHOUSE, abi: omnitideClearinghouseAbi, functionName: "openMarkets", args: [DEEP_POOL] })) as readonly number[];
    const reports = await fetchReports(feedsFor(open.map((id) => ({ marketId: Number(id) }))));
    await send("Exit Deep without the keeper", { chainId: HUB.chainId, address: DEEP_POOL, abi: omnitideDeepPoolAbi, functionName: "exit", args: [keys.id, reports] });
  }

  return (
    <section className="rounded-2xl border border-dashed border-line-strong bg-card p-4">
      <p className="font-medium">Escape hatch</p>
      <p className="mt-2 text-[13px] leading-5 text-ink-2">
        {exitAt
          ? ready
            ? "The 24h window passed with no newer seal. The pool pays the last sealed collateral straight to you."
            : `Exit unlocks ${new Date(exitAt * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}. Any newer seal from the keeper cancels it.`
          : "A flat book never depends on the keeper. Prove the last sealed state on-chain, wait 24 hours, and the contract pays you itself."}
      </p>
      {exitAt ? (
        <button type="button" className="btn btn-secondary mt-3 w-full" disabled={busy || !ready} onClick={() => void exit().catch(() => {})}>
          Exit now
        </button>
      ) : (
        <button type="button" className="btn btn-ghost mt-3 w-full" disabled={busy || !verified} onClick={() => void request().catch(() => {})}>
          Request exit
        </button>
      )}
    </section>
  );
}

interface SealedRow {
  id: string;
  account: string;
  commitment: Hex;
  ciphertext: Hex;
  status: "open" | "filled" | "cancelled";
  fillPrice: string | null;
  placedAt: number;
}

function SealedOrders({ keys }: { keys: Unlocked }) {
  const { data } = useIndexer<SealedRow[]>("sealed", keys.owner);
  const { send, busy } = useTx();
  const rows = (data ?? []).map((r) => {
    const text = openBox(keys.viewPrivate, r.ciphertext);
    return { ...r, plain: text ? (JSON.parse(text) as { marketId: number; kind: 1 | 2; sizeDelta: string; triggerPrice: string }) : null };
  });
  if (!rows.length) return null;
  return (
    <div className="rounded-2xl border border-line bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5">
        <h2 className="text-[20px] font-medium">Sealed orders</h2>
        <span className="tag text-ink-3">trigger hidden until it fires</span>
      </div>
      <div className="relative mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-[13px]">
          <thead className="text-[12px] text-ink-3">
            <tr>
              {["Order", "Trigger", "Size", "Status", "Placed", ""].map((h) => (
                <th key={h} className="px-5 py-2 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="px-5 py-3 font-medium">{r.plain ? `${MARKETS[r.plain.marketId]?.symbol} ${r.plain.kind === 1 ? "stop-loss" : "take-profit"}` : "Sealed"}</td>
                <td className="num px-5 py-3">{r.plain ? fmtPrice(wad(r.plain.triggerPrice)) : "••••••"}</td>
                <td className="num px-5 py-3">{r.plain ? `${Math.abs(wad(r.plain.sizeDelta)).toPrecision(4)} ${MARKETS[r.plain.marketId]?.symbol}` : "••••"}</td>
                <td className="px-5 py-3 capitalize text-ink-2">{r.status === "filled" && r.fillPrice ? `filled ${fmtPrice(wad(r.fillPrice))}` : r.status}</td>
                <td className="px-5 py-3 text-ink-3">{ago(r.placedAt)}</td>
                <td className="px-5 py-3 text-right">
                  {r.status === "open" && (
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void send("Cancel sealed order", { chainId: HUB.chainId, address: CLEARINGHOUSE, abi: omnitideClearinghouseAbi, functionName: "cancelSealedOrder", args: [BigInt(r.id)] }).catch(() => {})}>
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** What anyone on the explorer sees next to what the view key reveals. */
function TwoSides({ keys, book, verified, seal }: { keys: Unlocked; book: DeepBook | null; verified: boolean; seal?: DeepNote }) {
  return (
    <div className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-2">
      <div className="bg-navy p-5 text-white">
        <p className="tag text-white/60">What the chain sees</p>
        <dl className="mt-3 space-y-2 font-mono text-[11px] leading-4 break-all text-white/80">
          <div>
            <dt className="text-white/50">deep id</dt>
            <dd>{keys.id}</dd>
          </div>
          <div>
            <dt className="text-white/50">commitment · nonce {seal?.nonce ?? "–"}</dt>
            <dd>{seal?.commitment ?? "waiting for the first seal"}</dd>
          </div>
          <div>
            <dt className="text-white/50">ciphertext · {seal?.ciphertext ? (seal.ciphertext.length - 2) / 2 : 0} bytes</dt>
            <dd className="line-clamp-3">{seal?.ciphertext ?? "–"}</dd>
          </div>
        </dl>
        <p className="mt-3 text-[12px] leading-[18px] text-white/60">Trades fill as one pooled account with no id attached; seals land in separate batches.</p>
      </div>
      <div className="bg-card p-5">
        <p className="tag flex items-center gap-1.5 text-ink-3">
          What your view key reveals
          {verified && (
            <span className="inline-flex items-center gap-1 text-flood">
              <ShieldCheck size={13} strokeWidth={1.75} /> matches chain
            </span>
          )}
        </p>
        {book ? (
          <dl className="mt-3 space-y-2 text-[13px]">
            <div className="flex justify-between">
              <dt className="text-ink-3">Collateral</dt>
              <dd className="num">{money(units6(book.collateral))}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-3">Positions</dt>
              <dd className="num">{book.positions.length ? book.positions.map((p) => `${MARKETS[p.marketId]?.symbol} ${wad(p.size) > 0 ? "long" : "short"}`).join(", ") : "flat"}</dd>
            </div>
            {book.realized !== "0" && (
              <div className="flex justify-between">
                <dt className="text-ink-3">Realized PnL</dt>
                <dd className="num">{signedMoney(units6(book.realized))}</dd>
              </div>
            )}
            {book.fees !== "0" && (
              <div className="flex justify-between">
                <dt className="text-ink-3">Fees paid</dt>
                <dd className="num">{money(units6(book.fees))}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-ink-3">Sealed</dt>
              <dd className="num">{ago(book.updatedAt)}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-3 text-[13px] leading-5 text-ink-2">Your first seal lands within half a minute of the first deposit. Until then there is nothing on-chain to open.</p>
        )}
      </div>
    </div>
  );
}

function DeepDesk({ keys, lock }: { keys: Unlocked; lock: () => void }) {
  const prices = usePriceMap();
  const { book, verified, status, seals } = useDeepBook(keys);
  const positions = positionsOf(book);
  const h = accountHealth(units6(book?.collateral ?? "0"), positions, prices);
  const unrealized = h.equity - units6(book?.collateral ?? "0");

  const figures = book
    ? [
        { label: "Deep equity", value: money(h.equity) },
        { label: "Collateral", value: money(units6(book.collateral)) },
        ...(positions.length ? [{ label: "Unrealized", value: upnl(unrealized) }] : []),
        { label: "Seals on-chain", value: String(seals.length) },
      ]
    : [];

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_380px]">
      <section className="flex min-w-0 flex-col gap-3">
        <div className="rounded-2xl border border-line bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="tag text-ink-3">x25519 · AES-256-GCM · keccak commitments on Robinhood Chain</p>
              <h1 className="display mt-2 text-[44px] text-ink">Deep Mode</h1>
            </div>
            <div className="flex items-center gap-3">
              {positions.length > 0 && <TideGauge level={h.level} className="[&>div]:h-10" />}
              <button type="button" className="btn btn-ghost btn-sm" onClick={lock}>
                <Lock size={14} strokeWidth={1.75} /> Lock
              </button>
            </div>
          </div>
          <p className="mt-1 font-mono text-[12px] text-ink-3">
            {shortHash(keys.id)} · {status?.sealing ? "sealing the latest change…" : verified ? "sealed and verified" : "standing by"}
          </p>
          {book ? (
            <dl className="mt-5 flex flex-wrap gap-px overflow-hidden rounded-xl border border-line bg-line">
              {figures.map((f) => (
                <div key={f.label} className="min-w-[140px] flex-1 bg-card p-4">
                  <dt className="text-[13px] text-ink-3">{f.label}</dt>
                  <dd className="num mt-1 text-[22px] leading-8 font-medium">{f.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-5 max-w-2xl text-[14px] leading-[22px] text-ink-2">Sink tdUSD from Robinhood Chain or Arbitrum to open your book. From then on, size, entries and PnL live only as ciphertext addressed to your key.</p>
          )}
        </div>

        <TwoSides keys={keys} book={book} verified={verified} seal={seals[0]?.note} />

        {positions.length > 0 && (
          <div className="rounded-2xl border border-line bg-card">
            <h2 className="px-5 pt-5 text-[20px] font-medium">Deep positions</h2>
            <div className="relative mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-[13px]">
                <thead className="text-[12px] text-ink-3">
                  <tr>
                    {["Market", "Size", "Entry", "Mark", "PnL"].map((x) => (
                      <th key={x} className="px-5 py-2 font-normal">
                        {x}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => {
                    const m = MARKETS[p.marketId]!;
                    const mark = prices[m.feed];
                    const pnl = mark ? p.size * (mark - p.entry) : null;
                    return (
                      <tr key={p.marketId} className="border-t border-line">
                        <td className="px-5 py-3 font-medium">
                          {m.symbol}-PERP <span className={p.size > 0 ? "text-flood" : "text-ebb"}>{p.size > 0 ? "long" : "short"}</span>
                        </td>
                        <td className="num px-5 py-3">{Math.abs(p.size).toPrecision(5)}</td>
                        <td className="num px-5 py-3">{fmtPrice(p.entry)}</td>
                        <td className="num px-5 py-3">{mark ? fmtPrice(mark) : ""}</td>
                        <td className={`num px-5 py-3 ${pnl === null ? "" : pnl >= 0 ? "text-flood" : "text-ebb"}`}>{pnl === null ? "" : upnl(pnl)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <SealedOrders keys={keys} />

        {book && book.history.length > 0 && (
          <div className="rounded-2xl border border-line bg-card">
            <h2 className="px-5 pt-5 text-[20px] font-medium">Sealed history</h2>
            <ol className="mt-3">
              {book.history.slice(0, 20).map((f, i) => (
                <li key={`${f.at}-${i}`} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line px-5 py-3 text-[13px]">
                  <span className="font-medium capitalize">
                    {f.kind}
                    {f.marketId !== undefined && ` ${MARKETS[f.marketId]?.symbol} ${f.sizeDelta && BigInt(f.sizeDelta) > 0n ? "buy" : "sell"}`}
                  </span>
                  <span className="num text-ink-2">{f.kind === "trade" ? `${f.price ? fmtPrice(wad(f.price)) : ""} · ${realized(units6(f.amount))}` : money(units6(f.amount))}</span>
                  <span className="flex items-center gap-3 text-ink-3">
                    {ago(f.at)}
                    {f.tx && (
                      <a href={explorerTx(HUB_KEY, f.tx)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] hover:text-ink">
                        {shortHash(f.tx)}
                        <ExternalLink size={12} strokeWidth={1.5} />
                      </a>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>

      <aside className="flex flex-col gap-3">
        <DeepTicket keys={keys} book={book} />
        <Fund keys={keys} />
        <Withdraw keys={keys} book={book} />
        <Disclosure keys={keys} />
        <EscapeHatch keys={keys} book={book} verified={verified} />
      </aside>
    </div>
  );
}

export default function DeepPage() {
  const { address } = useAccount();
  const { keys, unlock, lock } = useDeepKeys();
  const { data: pool } = useIndexer<{ books: number; seals: number; latest: { deepId: string; kind: string; commitment: string | null; timestamp: number; tx: string }[] }>("deep");

  if (address && keys) return <DeepDesk keys={keys} lock={lock} />;

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_380px]">
      <section className="flex min-w-0 flex-col gap-3">
        <div className="rounded-2xl border border-line bg-card p-5">
          <p className="tag text-ink-3">Private positions · sealed PnL · Disclosure Key</p>
          <h1 className="display mt-2 text-[44px] text-ink">Deep Mode</h1>
          <p className="mt-2 max-w-2xl text-[14px] leading-[22px] text-ink-2">
            Below the surface, nobody reads your book. OmnitideDeepPool trades every Deep book as one pooled account, the keeper keeps the ledger, and the chain stores only a keccak commitment and a ciphertext sealed to your view key. Copy-traders, liquidation hunters and
            explorer snoops see a hash.
          </p>
          {pool && pool.books > 0 && (
            <dl className="mt-6 flex flex-wrap gap-px overflow-hidden rounded-xl border border-line bg-line">
              <div className="min-w-[150px] flex-1 bg-card p-4">
                <dt className="text-[13px] text-ink-3">Deep books</dt>
                <dd className="num mt-1 text-[22px] leading-8 font-medium">{pool.books}</dd>
              </div>
              <div className="min-w-[150px] flex-1 bg-card p-4">
                <dt className="text-[13px] text-ink-3">Seals on-chain</dt>
                <dd className="num mt-1 text-[22px] leading-8 font-medium">{pool.seals}</dd>
              </div>
            </dl>
          )}
        </div>

        {pool && pool.latest.length > 0 && (
          <div className="rounded-2xl border border-line bg-navy p-5 text-white">
            <p className="tag text-white/60">Live from OmnitideDeepPool · this is all anyone gets</p>
            <ol className="mt-3 space-y-2 font-mono text-[11px] leading-4">
              {pool.latest.slice(0, 8).map((n) => (
                <li key={n.tx + n.deepId + n.kind} className="flex flex-wrap gap-x-3 text-white/75">
                  <span className="w-16 text-white/50">{n.kind}</span>
                  <span>{shortHash(n.deepId)}</span>
                  <span className="min-w-0 flex-1 truncate">{n.commitment ?? ""}</span>
                  <span className="text-white/50">{ago(n.timestamp)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-3">
          {[
            { t: "Pooled fills", b: "Every Deep trade hits the clearinghouse as OmnitideDeepPool. No id, no owner, nothing to follow." },
            { t: "Sealed to you", b: "Each change re-seals your book: x25519 key wrap, AES-256-GCM body, keccak commitment on-chain." },
            { t: "Yours to prove", b: "Your Disclosure Key replays every seal and checks each one against its on-chain commitment." },
          ].map((x) => (
            <div key={x.t} className="rounded-2xl border border-line bg-card p-4">
              <p className="font-medium">{x.t}</p>
              <p className="mt-1 text-[13px] leading-5 text-ink-2">{x.b}</p>
            </div>
          ))}
        </div>
      </section>
      <aside className="flex flex-col gap-3">
        {address ? <Dive onUnlock={unlock} /> : (
          <section className="rounded-2xl border border-line bg-card p-5">
            <p className="font-medium">Connect to dive</p>
            <p className="mt-2 text-[13px] leading-5 text-ink-2">Deep keys come from your wallet signature, so the same wallet opens the same book anywhere.</p>
            <div className="mt-4">
              <Connect size="md" />
            </div>
          </section>
        )}
        <div className="rounded-2xl border border-line bg-card p-4 text-[13px] leading-5 text-ink-2">
          <p className="font-medium text-ink">Who sees what</p>
          <ul className="mt-2 space-y-1">
            <li>· Public: deposits into the pool, withdrawals out, one commitment per seal</li>
            <li>· You and your Disclosure Key holders: the full book and every fill</li>
            <li>· The keeper: runs the ledger, so it reads it too, and can never sign for your wallet</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
