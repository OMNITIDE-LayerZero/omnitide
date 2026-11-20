"use client";

import { useEffect, useRef, useState } from "react";
import type { ChainKey } from "@omnitide/contracts/chains";
import { CHAINS } from "@omnitide/contracts/chains";
import { HUB_KEY, SHORT, inflowRoute } from "@/lib/chains";
import { useSeaWall, useSwell } from "@/lib/hooks";
import { laneRows, windowLabel } from "@/lib/landing";
import { moneyCompact } from "@/lib/format";
import { LANE_PAIRS, RouteChart, SPOKES } from "./route-map";
import type { Harbor } from "./harbor-scene";

const hops = (k: ChainKey) => {
  const route = inflowRoute(k);
  return route.length === 1 ? "direct · 1 hop" : `via ${SHORT[route[0]!]} · 2 hops`;
};

/** Hub and spokes as a 3D harbor: ships carry deposits along the LayerZero lanes and spiral into the one book. The flat chart shows until WebGL is up, and stays for reduced motion. */
export function HarborAtlas() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const labels = useRef<Partial<Record<ChainKey, HTMLElement | null>>>({});
  const api = useRef<Harbor | null>(null);
  const [live, setLive] = useState(false);
  const [focus, setFocus] = useState<ChainKey | null>(null);
  const [landed, setLanded] = useState<ChainKey | null>(null);
  const swell = useSwell();
  const swellRef = useRef(swell);
  const { data: wall } = useSeaWall();
  // the directed lanes deposits actually ride, read live from each OFT endpoint
  const inflowLanes = laneRows(wall).filter((l) => SPOKES.some((k) => [k, ...inflowRoute(k)].some((c, i, path) => i > 0 && path[i - 1] === l.from && c === l.to)));

  useEffect(() => {
    const el = canvas.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let dead = false;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return;
        io.disconnect();
        import("./harbor-scene")
          .then(({ mountHarbor }) => {
            if (dead) return;
            api.current = mountHarbor(el, { hub: HUB_KEY, spokes: SPOKES, lanes: LANE_PAIRS, route: inflowRoute, labels: labels.current, onHover: setFocus, onLand: setLanded, onReady: () => setLive(true) });
            api.current.setSwell(swellRef.current);
          })
          .catch(() => {}); // no WebGL: the flat chart stays
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => {
      dead = true;
      io.disconnect();
      api.current?.dispose();
      api.current = null;
    };
  }, []);

  useEffect(() => api.current?.focus(focus), [focus]);
  useEffect(() => {
    swellRef.current = swell;
    api.current?.setSwell(swell);
  }, [swell]);

  return (
    <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-center">
      <div className="relative aspect-square overflow-hidden sm:aspect-[3/2]">
        <RouteChart className={`absolute inset-0 h-full transition-opacity duration-700 ${live ? "opacity-0" : ""}`} />
        <canvas ref={canvas} aria-hidden className={`absolute inset-0 block h-full w-full touch-pan-y transition-opacity duration-700 ${live ? "" : "opacity-0"}`} />
        <div aria-hidden className={`pointer-events-none absolute inset-0 transition-opacity duration-700 ${live ? "" : "opacity-0"}`}>
          {[HUB_KEY, ...SPOKES].map((k) => (
            <div key={k} ref={(n) => void (labels.current[k] = n)} className="absolute top-0 left-0 text-center whitespace-nowrap will-change-transform">
              <p className={`font-mono text-[12px] transition-colors ${focus === k ? "text-[#c9d3ff]" : "text-white/90"}`}>{SHORT[k]}</p>
              <p className="hidden font-mono text-[10px] text-white/50 sm:block">{k === HUB_KEY ? `the book · eid ${CHAINS[k].eid}` : `eid ${CHAINS[k].eid}`}</p>
            </div>
          ))}
          <p className="tag absolute top-3 left-3 text-white/50">Drag to turn · tap a port to sail</p>
          <p className="absolute bottom-3 left-3 rounded-full border border-white/15 bg-navy/70 px-3 py-1.5 font-mono text-[11px] text-white/80 backdrop-blur-sm">
            {landed ? `Landed in the book · ${SHORT[landed]} · ${hops(landed)}` : `${LANE_PAIRS.length} LayerZero lanes open · ${SPOKES.length} ports sailing`}
          </p>
        </div>
      </div>

      <ol className="space-y-0">
        {SPOKES.map((k) => (
          <li key={k} className="border-t border-white/10">
            <button
              type="button"
              onClick={() => api.current?.send(k)}
              onPointerEnter={() => setFocus(k)}
              onPointerLeave={() => setFocus(null)}
              onFocus={() => setFocus(k)}
              onBlur={() => setFocus(null)}
              className={`group flex w-full items-baseline justify-between gap-4 py-3 text-left transition-colors ${focus === k ? "text-[#c9d3ff]" : "text-white"}`}
            >
              <span>
                {SHORT[k]}
                <span className={`tag ml-3 text-white/40 transition-opacity ${live ? "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" : "hidden"}`}>Send a ship</span>
              </span>
              <span className="tag text-white/60">{hops(k)}</span>
            </button>
          </li>
        ))}
        <li className="border-t border-white/10 pt-4 text-[13px] leading-5 text-white/60">
          Lanes shown are the ones LayerZero runs today. Every spoke with a hub lane lands in one hop, one transaction; the rest ride one extra hop through Sepolia. Each arc overhead is the LayerZero message; each hull below is the collateral it carries home.
        </li>
        {inflowLanes.length > 0 && (
          <li className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <p className="tag text-white/55">Inflow lanes · live from each endpoint</p>
            <table className="mt-2 w-full text-left text-[12px]">
              <thead>
                <tr className="tag text-white/40">
                  <th className="py-1 font-normal">Lane</th>
                  <th className="py-1 text-right font-normal">DVNs</th>
                  <th className="py-1 text-right font-normal">Confs</th>
                  <th className="py-1 text-right font-normal">Rate limit</th>
                </tr>
              </thead>
              <tbody>
                {inflowLanes.map((l) => (
                  <tr key={`${l.from}${l.to}`} className={`border-t border-white/[0.07] transition-colors ${focus === l.from || (focus === HUB_KEY && l.to === HUB_KEY) ? "text-[#c9d3ff]" : "text-white/80"}`}>
                    <td className="py-1.5">
                      {SHORT[l.from]} → {SHORT[l.to]}
                    </td>
                    <td className="py-1.5 text-right num">{l.dvns}</td>
                    <td className="py-1.5 text-right num">{l.confirmations}</td>
                    <td className="py-1.5 text-right num">{l.limit > 0 ? `${moneyCompact(l.limit)} / ${windowLabel(l.window)}` : "unset"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="tag mt-3 text-white/40">OFT send → DVN verify → executor lzReceive → lzCompose credit</p>
          </li>
        )}
      </ol>
    </div>
  );
}
