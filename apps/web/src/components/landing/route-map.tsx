import { CHAINS, type ChainKey } from "@omnitide/contracts/chains";
import { HUB_KEY, LANES, SHORT, inflowRoute } from "@/lib/chains";

const SPOKES: ChainKey[] = ["sepolia", "fuji"];
// port positions on a 600×360 chart
const POS: Record<ChainKey, [number, number]> = {
  robinhoodTestnet: [300, 240],
  sepolia: [110, 96],
  fuji: [490, 96],
};

/** The three ports and the LayerZero lanes that connect them, drawn like a nautical chart. */
export function RouteMap() {
  const drawn = new Set<string>();
  const lanes: [ChainKey, ChainKey][] = [];
  for (const [from, tos] of Object.entries(LANES) as [ChainKey, ChainKey[]][]) {
    for (const to of tos) {
      const id = [from, to].sort().join("-");
      if (!drawn.has(id)) {
        drawn.add(id);
        lanes.push([from, to]);
      }
    }
  }
  return (
    <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-center">
      <svg viewBox="0 0 600 360" className="w-full" role="img" aria-label="Map of OMNITIDE chains and LayerZero lanes into the Robinhood Chain hub">
        <defs>
          <pattern id="soundings" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="12" cy="12" r="0.8" fill="currentColor" opacity="0.18" />
          </pattern>
        </defs>
        <rect width="600" height="360" fill="url(#soundings)" className="text-white" />
        {[60, 110, 160].map((r) => (
          <circle key={r} cx={POS[HUB_KEY][0]} cy={POS[HUB_KEY][1]} r={r} fill="none" stroke="white" strokeOpacity="0.08" strokeDasharray="2 6" />
        ))}
        {lanes.map(([a, b]) => {
          const toHub = a === HUB_KEY || b === HUB_KEY;
          const [x1, y1] = POS[a];
          const [x2, y2] = POS[b];
          return <line key={`${a}${b}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="white" strokeOpacity={toHub ? 0.55 : 0.18} strokeWidth={toHub ? 1.25 : 1} strokeDasharray={toHub ? undefined : "3 5"} />;
        })}
        {/* one Inflow in motion: Fuji → hub */}
        <circle r="3" fill="#8ea2ff">
          <animateMotion dur="3.6s" repeatCount="indefinite" path={`M${POS.fuji[0]},${POS.fuji[1]} L${POS[HUB_KEY][0]},${POS[HUB_KEY][1]}`} />
        </circle>
        <circle r="3" fill="#8ea2ff">
          <animateMotion dur="5.2s" repeatCount="indefinite" path={`M${POS.sepolia[0]},${POS.sepolia[1]} L${POS[HUB_KEY][0]},${POS[HUB_KEY][1]}`} />
        </circle>
        {(Object.keys(POS) as ChainKey[]).map((k) => {
          const [x, y] = POS[k];
          const hub = k === HUB_KEY;
          return (
            <g key={k}>
              <circle cx={x} cy={y} r={hub ? 10 : 6} fill={hub ? "#5671ff" : "#070c48"} stroke="white" strokeWidth="1.25" />
              <text x={x} y={y + (hub ? 30 : y < 180 ? -14 : 24)} textAnchor="middle" fill="white" fontSize="12" fontFamily="var(--font-geist-mono)" opacity="0.9">
                {SHORT[k]}
              </text>
              <text x={x} y={y + (hub ? 44 : y < 180 ? -28 : 38)} textAnchor="middle" fill="white" fontSize="10" fontFamily="var(--font-geist-mono)" opacity="0.5">
                eid {CHAINS[k].eid}
              </text>
            </g>
          );
        })}
      </svg>

      <ol className="space-y-0">
        {SPOKES.map((k) => {
          const route = inflowRoute(k);
          return (
            <li key={k} className="flex items-baseline justify-between gap-4 border-t border-white/10 py-3">
              <span className="text-white">{SHORT[k]}</span>
              <span className="tag text-white/60">{route.length === 1 ? "direct · 1 hop" : `via ${SHORT[route[0]!]} · 2 hops`}</span>
            </li>
          );
        })}
        <li className="border-t border-white/10 pt-4 text-[13px] leading-5 text-white/60">
          Lanes shown are the ones LayerZero runs today. Every spoke lands on the hub in one hop, one transaction.
        </li>
      </ol>
    </div>
  );
}
