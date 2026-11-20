"use client";

import { useEffect, useRef, useState } from "react";
import type { ChainKey } from "@omnitide/contracts/chains";
import { CHAINS } from "@omnitide/contracts/chains";
import { HUB_KEY, SHORT, inflowRoute } from "@/lib/chains";
import { useSwell } from "@/lib/hooks";
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
              <p className="font-mono text-[10px] text-white/50">{k === HUB_KEY ? `the book · eid ${CHAINS[k].eid}` : `eid ${CHAINS[k].eid}`}</p>
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
      </ol>
    </div>
  );
}
