import { ExternalLink } from "lucide-react";
import type { MarketConfig } from "@omnitide/contracts/markets";
import { CLEARINGHOUSE, ORACLE, FEE_BPS } from "@/lib/contracts";
import { explorerAddress } from "@/lib/chains";
import { leverage, moneyCompact } from "@/lib/format";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Contract spec for the market in view, the fine print a desk trader looks for. */
export function MarketSpec({ market }: { market: MarketConfig }) {
  const rows: [string, React.ReactNode][] = [
    ["Feed id", <span key="f" className="font-mono">{market.feed}</span>],
    ["Initial margin", `${market.initialMarginBps / 100}% · ${leverage(market.initialMarginBps)}`],
    ["Maintenance", `${market.maintenanceMarginBps / 100}%`],
    ["Open interest cap", `${moneyCompact(market.maxOpenInterestUsd)} per side`],
    ["Taker fee", `${FEE_BPS / 100}%`],
    ["Funding", "None in Shoreline"],
    ["Liquidation", "1% penalty, 20% to the caller"],
    ["Order fills", "Keeper, every 5 s"],
  ];
  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <p className="text-[13px] text-ink-3">Contract spec · {market.symbol}-PERP</p>
      <dl className="mt-3 space-y-2 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4">
            <dt className="text-ink-3">{k}</dt>
            <dd className="num text-right">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex flex-col gap-1 border-t border-line pt-3">
        {[
          ["Clearinghouse", CLEARINGHOUSE],
          ["Oracle", ORACLE],
        ].map(([label, addr]) => (
          <a key={label} href={explorerAddress("robinhoodTestnet", addr!)} target="_blank" rel="noreferrer" className="flex items-center justify-between text-[12px] text-ink-2 hover:text-ink">
            <span>{label}</span>
            <span className="inline-flex items-center gap-1 font-mono">
              {short(addr!)}
              <ExternalLink size={12} strokeWidth={1.5} />
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
