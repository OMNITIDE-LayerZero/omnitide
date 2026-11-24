"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink } from "lucide-react";
import { MARKETS } from "@omnitide/contracts/markets";
import { CHAINS, type ChainKey } from "@omnitide/contracts/chains";
import { useIndexer } from "@/lib/hooks";
import { CHAIN_COUNT, HUB_KEY, LZ_SCAN, SHORT, explorerTx } from "@/lib/chains";
import { ago, fee, money, price, shortHash, signedMoney, units6, wad } from "@/lib/format";
import { LineChart } from "@/components/terminal/line-chart";
import { csv, download, pnlReport } from "@/lib/report";

interface Trade { id: string; account: string; marketId: number; sizeDelta: string; price: string; realizedPnl: string; fee: string; notionalUsd: string; viaOrder: boolean; timestamp: number; tx: string }
interface Flow { id: string; kind: string; amount: string; eid: number; guid: string | null; timestamp: number; tx: string }
interface Order { id: string; marketId: number; kind: number; sizeDelta: string; triggerPrice: string; status: string; fillPrice: string | null; placedAt: number }

const chainByEid = (eid: number) => (Object.keys(CHAINS) as ChainKey[]).find((k) => CHAINS[k].eid === eid);
const FLOW: Record<string, string> = { inflow: "Inflow", deposit: "Deposit", ebb: "Ebb", withdraw: "Withdraw" };

function TxLink({ hash, href }: { hash: string; href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] text-ink-2 hover:text-ink">
      {shortHash(hash)}
      <ExternalLink size={12} strokeWidth={1.5} />
    </a>
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-[13px]">
        <thead className="text-[12px] text-ink-3">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-2 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export default function History() {
  const { address } = useAccount();
  const acct = address?.toLowerCase();
  const [tab, setTab] = useState<"trades" | "transfers" | "orders" | "equity">("trades");
  const { data: trades } = useIndexer<Trade[]>("trades", acct);
  const { data: flows } = useIndexer<Flow[]>("flows", acct, !!acct);
  const { data: orders } = useIndexer<Order[]>("orders", acct, !!acct);
  const tabs = acct ? (["trades", "transfers", "orders", "equity"] as const) : (["trades"] as const);
  const { data: snaps } = useQuery({
    queryKey: ["snapshots", acct],
    enabled: !!acct,
    refetchInterval: 120_000,
    queryFn: async () => (await (await fetch(`/api/snapshots?account=${acct}&days=90`)).json()) as { points: { time: number; equity: number; collateral: number; upnl: number; notional: number }[] },
  });
  const report = acct && trades ? pnlReport(trades, flows ?? []) : null;
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <div className="rounded-2xl border border-line bg-card">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-5 pt-5">
        <div>
          <p className="tag text-ink-3">{acct ? `Your account, indexed across ${CHAIN_COUNT} chains` : "Recent fills across OMNITIDE"}</p>
          <h1 className="display mt-2 text-[44px] text-ink">History</h1>
        </div>
        <div className="flex gap-1" role="tablist">
          {tabs.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`relative h-11 px-3 text-[14px] capitalize transition-colors ${tab === t ? "text-ink" : "text-ink-3 hover:text-ink-2"}`}>
              {t}
              {tab === t && <span className="absolute inset-x-3 -bottom-px h-px bg-accent" />}
            </button>
          ))}
        </div>
      </div>

      {tab === "trades" &&
        (trades && trades.length > 0 ? (
          <Table head={["Market", "Side", "Size", "Price", "Notional", "Realized", "Fee", "When", "Tx"]}>
            {trades.map((t) => {
              const m = MARKETS[t.marketId]!;
              const size = wad(t.sizeDelta);
              // under half a cent rounds to $0.00, so it reads as an opening fill
              const raw = units6(t.realizedPnl);
              const pnl = Math.abs(raw) >= 0.005 ? raw : 0;
              return (
                <tr key={t.id} className="border-t border-line">
                  <td className="px-4 py-3 font-medium">
                    {m.symbol}
                    {t.viaOrder && <span className="tag ml-2 text-ink-3">order</span>}
                  </td>
                  <td className={`px-4 py-3 ${size > 0 ? "text-flood" : "text-ebb"}`}>{size > 0 ? "Buy" : "Sell"}</td>
                  <td className="num px-4 py-3">{Math.abs(size).toPrecision(5)}</td>
                  <td className="num px-4 py-3">{price(wad(t.price))}</td>
                  <td className="num px-4 py-3">{money(wad(t.notionalUsd))}</td>
                  <td className={`num px-4 py-3 ${pnl > 0 ? "text-flood" : pnl < 0 ? "text-ebb" : "text-ink-3"}`}>{pnl !== 0 ? signedMoney(pnl) : "Opened"}</td>
                  <td className="num px-4 py-3 text-ink-2">{fee(units6(t.fee))}</td>
                  <td className="px-4 py-3 text-ink-3">{ago(t.timestamp)}</td>
                  <td className="px-4 py-3">
                    <TxLink hash={t.tx} href={explorerTx(HUB_KEY, t.tx)} />
                  </td>
                </tr>
              );
            })}
          </Table>
        ) : (
          <p className="px-5 py-10 text-[14px] text-ink-2">Your fills will be logged here, each linked to its block on Robinhood Chain.</p>
        ))}

      {tab === "transfers" &&
        (flows && flows.length > 0 ? (
          <Table head={["Type", "Amount", "Chain", "When", "Hub tx", "LayerZero"]}>
            {flows.map((f) => {
              const k = chainByEid(f.eid);
              return (
                <tr key={f.id} className="border-t border-line">
                  <td className="px-4 py-3 font-medium">{FLOW[f.kind] ?? f.kind}</td>
                  <td className="num px-4 py-3">{money(units6(f.amount))}</td>
                  <td className="px-4 py-3 text-ink-2">{k ? SHORT[k] : `eid ${f.eid}`}</td>
                  <td className="px-4 py-3 text-ink-3">{ago(f.timestamp)}</td>
                  <td className="px-4 py-3">
                    <TxLink hash={f.tx} href={explorerTx(HUB_KEY, f.tx)} />
                  </td>
                  <td className="px-4 py-3">{f.guid ? <TxLink hash={f.tx} href={`${LZ_SCAN}${f.tx}`} /> : <span className="text-ink-3">local</span>}</td>
                </tr>
              );
            })}
          </Table>
        ) : (
          <p className="px-5 py-10 text-[14px] text-ink-2">Inflows and ebbs show up here with their LayerZero message, so you can follow each one across chains.</p>
        ))}

      {tab === "equity" && (
        <div className="p-5">
          {report && (
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
              {[
                { label: "Realized PnL", value: signedMoney(report.realized), tone: report.realized >= 0 ? "text-flood" : "text-ebb" },
                { label: "Fees paid", value: fee(report.fees) },
                { label: "Net after fees", value: signedMoney(report.realized - report.fees), tone: report.realized - report.fees >= 0 ? "text-flood" : "text-ebb" },
                { label: "Fills", value: String(report.fills) },
              ].map((f) => (
                <div key={f.label} className="bg-card p-4">
                  <dt className="text-[13px] text-ink-3">{f.label}</dt>
                  <dd className={`num mt-1 text-[22px] leading-8 font-medium ${f.tone ?? ""}`}>{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="mt-5 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[20px] font-medium">Equity curve</h2>
            <span className="tag text-ink-3">keeper snapshot every 10 minutes · last 90 days</span>
          </div>
          {snaps && snaps.points.length >= 2 ? (
            <LineChart points={snaps.points.map((p) => ({ time: p.time, value: p.equity }))} className="mt-3 h-64" />
          ) : (
            <p className="mt-3 text-[14px] leading-[22px] text-ink-2">The keeper photographs your equity every ten minutes while the account holds collateral. Two snapshots in, the curve starts drawing here.</p>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary btn-sm" disabled={!trades?.length} onClick={() => download(`omnitide-trades-${stamp}.csv`, csv(["time", "market", "side", "size", "price_usd", "notional_usd", "realized_pnl", "fee", "via_order", "tx"], (trades ?? []).map((t) => [new Date(t.timestamp * 1000).toISOString(), MARKETS[t.marketId]!.symbol, wad(t.sizeDelta) > 0 ? "buy" : "sell", Math.abs(wad(t.sizeDelta)), wad(t.price), wad(t.notionalUsd), units6(t.realizedPnl), units6(t.fee), t.viaOrder, t.tx])))}>
              <Download size={14} strokeWidth={1.5} /> Trades CSV
            </button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={!flows?.length} onClick={() => download(`omnitide-transfers-${stamp}.csv`, csv(["time", "type", "amount", "chain", "tx", "layerzero_guid"], (flows ?? []).map((f) => [new Date(f.timestamp * 1000).toISOString(), f.kind, units6(f.amount), chainByEid(f.eid) ?? f.eid, f.tx, f.guid ?? ""])))}>
              <Download size={14} strokeWidth={1.5} /> Transfers CSV
            </button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={!snaps?.points.length} onClick={() => download(`omnitide-equity-${stamp}.csv`, csv(["time", "equity", "collateral", "unrealized_pnl", "notional"], (snaps?.points ?? []).map((p) => [new Date(p.time * 1000).toISOString(), p.equity, p.collateral, p.upnl, p.notional])))}>
              <Download size={14} strokeWidth={1.5} /> Equity snapshots CSV
            </button>
          </div>
          <p className="tag mt-3 text-ink-3">Every row links back to a transaction hash, so a reviewer can check it on the explorer.</p>
        </div>
      )}

      {tab === "orders" &&
        (orders && orders.length > 0 ? (
          <Table head={["Market", "Type", "Size", "Trigger", "Result", "Placed"]}>
            {orders.map((o) => {
              const size = wad(o.sizeDelta);
              return (
                <tr key={o.id} className="border-t border-line">
                  <td className="px-4 py-3 font-medium">{MARKETS[o.marketId]!.symbol}</td>
                  <td className="px-4 py-3">
                    {["Limit", "Stop-loss", "Take-profit"][o.kind]} <span className={size > 0 ? "text-flood" : "text-ebb"}>{size > 0 ? "buy" : "sell"}</span>
                  </td>
                  <td className="num px-4 py-3">{Math.abs(size).toPrecision(5)}</td>
                  <td className="num px-4 py-3">{price(wad(o.triggerPrice))}</td>
                  <td className="num px-4 py-3">{o.fillPrice ? `Filled at ${price(wad(o.fillPrice))}` : o.status === "open" ? "Resting" : <span className="capitalize text-ink-3">{o.status}</span>}</td>
                  <td className="px-4 py-3 text-ink-3">{ago(o.placedAt)}</td>
                </tr>
              );
            })}
          </Table>
        ) : (
          <p className="px-5 py-10 text-[14px] text-ink-2">Every order you place, fill or cancel is kept here.</p>
        ))}
    </div>
  );
}
