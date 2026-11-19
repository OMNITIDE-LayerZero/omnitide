"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { ExternalLink } from "lucide-react";
import { MARKETS } from "@omnitide/contracts/markets";
import { CHAINS, type ChainKey } from "@omnitide/contracts/chains";
import { useIndexer } from "@/lib/hooks";
import { CHAIN_COUNT, SHORT, explorerTx } from "@/lib/chains";
import { ago, money, price, shortHash, signedMoney, units6, wad } from "@/lib/format";

interface Trade { id: string; account: string; marketId: number; sizeDelta: string; price: string; realizedPnl: string; fee: string; notionalUsd: string; viaOrder: boolean; timestamp: number; tx: string }
interface Flow { id: string; kind: string; amount: string; eid: number; guid: string | null; timestamp: number; tx: string }
interface Order { id: string; marketId: number; kind: number; sizeDelta: string; triggerPrice: string; status: string; fillPrice: string | null; placedAt: number }

const chainByEid = (eid: number) => (Object.keys(CHAINS) as ChainKey[]).find((k) => CHAINS[k].eid === eid);
const LZ_SCAN = "https://testnet.layerzeroscan.com/tx/";
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
  const [tab, setTab] = useState<"trades" | "transfers" | "orders">("trades");
  const { data: trades } = useIndexer<Trade[]>("trades", acct);
  const { data: flows } = useIndexer<Flow[]>("flows", acct, !!acct);
  const { data: orders } = useIndexer<Order[]>("orders", acct, !!acct);
  const tabs = acct ? (["trades", "transfers", "orders"] as const) : (["trades"] as const);

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
                  <td className="num px-4 py-3 text-ink-2">{money(units6(t.fee))}</td>
                  <td className="px-4 py-3 text-ink-3">{ago(t.timestamp)}</td>
                  <td className="px-4 py-3">
                    <TxLink hash={t.tx} href={explorerTx("robinhoodTestnet", t.tx)} />
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
                    <TxLink hash={f.tx} href={explorerTx("robinhoodTestnet", f.tx)} />
                  </td>
                  <td className="px-4 py-3">{f.guid ? <TxLink hash={f.tx} href={`${LZ_SCAN}${f.tx}`} /> : <span className="text-ink-3">local</span>}</td>
                </tr>
              );
            })}
          </Table>
        ) : (
          <p className="px-5 py-10 text-[14px] text-ink-2">Inflows and ebbs show up here with their LayerZero message, so you can follow each one across chains.</p>
        ))}

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
