"use client";

import { ExternalLink } from "lucide-react";
import { CHAINS, type ChainKey } from "@omnitide/contracts/chains";
import { useIndexer } from "@/lib/hooks";
import { SHORT } from "@/lib/chains";
import { ago, money, units6 } from "@/lib/format";

interface Message { guid: string; srcChainId: number; dstEid: number; amount: string; sentAt: number; receivedAt: number | null; sentTx: string }

const KEYS = Object.keys(CHAINS) as ChainKey[];
const byChainId = (id: number) => KEYS.find((k) => CHAINS[k].chainId === id);
const byEid = (eid: number) => KEYS.find((k) => CHAINS[k].eid === eid);

/** Every tdUSD message the indexer has seen, each linked to LayerZero Scan for independent proof. */
export function LayerZeroMessages() {
  const { data } = useIndexer<Message[]>("bridge");
  if (!data?.length) return null;
  return (
    <section className="rounded-2xl border border-line bg-card">
      <div className="border-b border-line px-5 py-4">
        <p className="text-[13px] text-ink-3">LayerZero messages · indexed on both ends</p>
        <p className="mt-1 text-[16px] font-medium">Every tdUSD crossing, traceable</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead className="text-[12px] text-ink-3">
            <tr>
              {["Route", "Amount", "Sent", "Delivery", "LayerZero Scan"].map((h) => (
                <th key={h} className="px-5 py-2 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((m) => {
              const src = byChainId(m.srcChainId);
              const dst = byEid(m.dstEid);
              return (
                <tr key={m.guid} className="border-t border-line">
                  <td className="px-5 py-3">
                    {src ? SHORT[src] : m.srcChainId} <span className="text-ink-3">→</span> {dst ? SHORT[dst] : m.dstEid}
                  </td>
                  <td className="num px-5 py-3">{money(units6(m.amount))}</td>
                  <td className="px-5 py-3 text-ink-3">{ago(m.sentAt)}</td>
                  <td className="px-5 py-3">{m.receivedAt ? <span className="text-flood">Delivered in {Math.max(1, Math.round((m.receivedAt - m.sentAt) / 60))} min</span> : <span className="text-warn">In flight</span>}</td>
                  <td className="px-5 py-3">
                    <a href={`https://testnet.layerzeroscan.com/tx/${m.sentTx}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[12px] text-ink-2 hover:text-ink">
                      {m.sentTx.slice(0, 10)}…{m.sentTx.slice(-4)}
                      <ExternalLink size={12} strokeWidth={1.5} />
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
