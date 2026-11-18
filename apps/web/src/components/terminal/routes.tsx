import { CHAINS } from "@omnitide/contracts/chains";
import { CHAIN_KEYS, HUB_KEY, SHORT, inflowRoute } from "@/lib/chains";

/** Every way collateral reaches the hub, straight from the lane table. */
export function InflowRoutes() {
  return (
    <div className="rounded-2xl border border-line bg-card">
      <div className="border-b border-line px-4 py-3">
        <p className="text-[13px] text-ink-3">Inflow routes · LayerZero V2 OFT + lzCompose</p>
      </div>
      <ul>
        {CHAIN_KEYS.filter((k) => k !== HUB_KEY).map((k) => {
          const route = inflowRoute(k);
          return (
            <li key={k} className="flex items-center justify-between gap-4 border-t border-line px-4 py-3 text-[13px] first:border-t-0">
              <span className="flex flex-wrap items-center gap-2">
                {[k, ...route].map((c, i) => (
                  <span key={`${c}${i}`} className="flex items-center gap-2">
                    {i > 0 && <span className="text-ink-3">→</span>}
                    <span className={c === HUB_KEY ? "font-medium text-accent-ink" : ""}>{SHORT[c]}</span>
                  </span>
                ))}
              </span>
              <span className="tag shrink-0 text-ink-3">
                {route.length === 1 ? "direct" : `${route.length} hops`} · eid {CHAINS[k].eid}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
