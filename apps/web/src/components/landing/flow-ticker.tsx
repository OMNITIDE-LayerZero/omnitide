"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { CHAINS, type ChainKey } from "@omnitide/contracts/chains";
import { useIndexer } from "@/lib/hooks";
import { HUB_KEY, SHORT, explorerTx } from "@/lib/chains";
import { ago, money, units6 } from "@/lib/format";

interface Flow {
  id: string;
  kind: "inflow" | "deposit" | "ebb" | "withdraw" | "liquidation";
  amount: string;
  eid: number;
  timestamp: number;
  tx: string;
}

const chainOf = (eid: number) => (Object.keys(CHAINS) as ChainKey[]).find((k) => CHAINS[k].eid === eid);

function describe(f: Flow) {
  const c = chainOf(f.eid);
  const where = c ? SHORT[c] : `eid ${f.eid}`;
  if (f.kind === "inflow") return { verb: "Inflow", path: `${where} → the book` };
  if (f.kind === "deposit") return { verb: "Deposit", path: `into the book on ${SHORT[HUB_KEY]}` };
  if (f.kind === "ebb") return { verb: "Ebb", path: `the book → ${where}` };
  return { verb: "Withdraw", path: `out of the book on ${SHORT[HUB_KEY]}` };
}

/** The latest money movements on the hub, one at a time; hidden until there is one. */
export function FlowTicker() {
  const { data } = useIndexer<Flow[]>("flows");
  const flows = (Array.isArray(data) ? data : []).filter((f) => f.kind !== "liquidation" && BigInt(f.amount) > 0n).slice(0, 6);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (flows.length < 2) return;
    const t = setInterval(() => setI((x) => x + 1), 4200);
    return () => clearInterval(t);
  }, [flows.length]);
  if (flows.length === 0) return null;
  const f = flows[i % flows.length]!;
  const d = describe(f);
  return (
    <a href={explorerTx(HUB_KEY, f.tx)} target="_blank" rel="noreferrer" className="group mt-6 inline-flex max-w-full items-center gap-3 rounded-full border border-line bg-card/80 py-1.5 pr-3 pl-1.5 text-[13px] shadow-sm backdrop-blur-sm transition-colors hover:border-line-strong" aria-label={`Latest on the hub: ${d.verb} ${money(units6(f.amount))}, ${ago(f.timestamp)}. Open the transaction.`}>
      <span className="tag shrink-0 rounded-full bg-accent px-2 py-0.5 text-on-accent">Live</span>
      <span key={f.id} className="rise min-w-0 truncate text-ink-2">
        <span className="font-medium text-ink">{d.verb}</span> · {d.path} · <span className="text-ink num">{money(units6(f.amount))}</span> · {ago(f.timestamp)}
      </span>
      <ArrowUpRight size={14} strokeWidth={1.5} className="shrink-0 text-ink-3 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink" />
    </a>
  );
}
