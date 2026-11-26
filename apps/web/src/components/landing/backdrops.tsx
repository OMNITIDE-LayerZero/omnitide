"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CHAINS } from "@omnitide/contracts/chains";
import { MARKETS } from "@omnitide/contracts/markets";
import { HUB_KEY, NETWORK } from "@/lib/chains";
import { V3_CHAINS } from "@/lib/contracts";
import { useIndexer, usePrices, useStats, useSwell } from "@/lib/hooks";
import { runLoop, scaled2d, type Frame, type Loop } from "../canvas-loop";
import { useTheme } from "../theme";
import { currentScene, deepScene, drawBathymetry, seamounts, seaWallScene, starScene, type Star } from "./backdrop-scenes";
import type { Caustics } from "./caustics-scene";
import type { Ocean } from "./ocean-scene";

// every backdrop sits under its section's content; the section is `isolate` so -z-10 stays above its background
const FILL = "pointer-events-none absolute inset-0 -z-10 block h-full w-full";

/** A 2D canvas driven by `make`'s frame function; the scene reads live values through refs, so it is built once. */
function useCanvas2d(make: (ctx: CanvasRenderingContext2D) => (f: Frame) => void, animate = true) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const loop = useRef<Loop | null>(null);
  const build = useRef(make);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const { ctx, resize } = scaled2d(el);
    loop.current = runLoop(el, { resize, frame: build.current(ctx), animate, maxDpr: 1.5 });
    return () => {
      loop.current?.stop();
      loop.current = null;
    };
  }, [animate]);
  return { canvas, loop };
}

const small = () => window.matchMedia("(max-width: 767px)").matches;

/** V1 Shoreline: sunlight caustics and rising bubbles (WebGL, loaded when the tier comes near). */
export function ShorelineLight() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const api = useRef<Caustics | null>(null);
  const [live, setLive] = useState(false);
  const { theme } = useTheme();
  const themeRef = useRef(theme);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let dead = false;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return;
        io.disconnect();
        import("./caustics-scene")
          .then(({ mountCaustics }) => {
            if (dead) return;
            api.current = mountCaustics(el, themeRef.current);
            setLive(true);
          })
          .catch(() => {}); // no WebGL: the tier keeps its plain paper
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => {
      dead = true;
      io.disconnect();
      api.current?.dispose();
      api.current = null;
    };
  }, []);
  useEffect(() => {
    themeRef.current = theme;
    api.current?.setTheme(theme);
  }, [theme]);
  return <canvas ref={canvas} aria-hidden className={`${FILL} transition-opacity duration-1000 ${live ? "" : "opacity-0"}`} />;
}

/** V2 Current: drift that runs faster the more Inflows the book has settled. */
export function CurrentDrift() {
  const { data } = useStats();
  const inflows = data?.global?.inflows ?? 0;
  const speed = useRef(1);
  speed.current = 0.8 + Math.min(1.2, Math.log10(1 + inflows) * 0.6);
  const { canvas } = useCanvas2d((ctx) => currentScene(ctx, small() ? 180 : 420, () => speed.current));
  return <canvas ref={canvas} aria-hidden className={FILL} />;
}

/** V3 Deep Water: bioluminescent plankton that wake under the cursor. */
export function DeepGlow() {
  const { canvas } = useCanvas2d((ctx) => deepScene(ctx, small() ? 90 : 170));
  return <canvas ref={canvas} aria-hidden className={FILL} />;
}

const CHART_INK = { light: ["#0a1786", "#1f3dff"], dark: ["#aebbff", "#8ea2ff"] } as const;

/** Markets: a nautical chart of the sea floor, one seamount per market raised or sunk by its 24h move; hovering a row lights its contours. */
export function Bathymetry() {
  const { data } = usePrices();
  const { theme } = useTheme();
  const [hover, setHover] = useState<string | null>(null);
  const state = useRef({ moves: [] as { symbol: string; change?: number }[], hover: null as string | null, theme });
  state.current.moves = MARKETS.map((m) => ({ symbol: m.symbol, change: data?.[m.feed]?.change24h ?? undefined }));
  state.current.hover = hover;
  state.current.theme = theme;
  const { canvas, loop } = useCanvas2d(
    (ctx) =>
      ({ w, h }) => {
        const s = state.current;
        const [ink, accent] = CHART_INK[s.theme];
        drawBathymetry(ctx, w, h, seamounts(s.moves, w < 640 ? 3 : 6), s.hover, ink, accent);
      },
    false,
  );
  const key = MARKETS.map((m) => data?.[m.feed]?.change24h?.toFixed(1)).join();
  useEffect(() => loop.current?.redraw(), [key, hover, theme, loop]);
  useEffect(() => {
    const host = canvas.current?.parentElement;
    if (!host) return;
    const over = (e: PointerEvent) => setHover((e.target as Element).closest?.("[data-market]")?.getAttribute("data-market") ?? null);
    const out = () => setHover(null);
    host.addEventListener("pointerover", over);
    host.addEventListener("pointerleave", out);
    return () => {
      host.removeEventListener("pointerover", over);
      host.removeEventListener("pointerleave", out);
    };
  }, [canvas]);
  return <canvas ref={canvas} aria-hidden className={FILL} />;
}

/** Sea Wall: the band floods to the live reserve coverage, read against a staff gauge. */
export function SeaWallWater({ cover }: { cover?: number }) {
  const value = useRef(cover);
  value.current = cover;
  const { canvas } = useCanvas2d((ctx) => seaWallScene(ctx, () => value.current));
  return <canvas ref={canvas} aria-hidden className={FILL} />;
}

// where the hub and each spoke sit in the token band's sky, as shares of the band: clear of the copy on desktop, along the right edge on phones
const SKY = { wide: [[0.3, 0.1], [0.1, 0.92], [0.42, 0.88], [0.24, 0.97]], narrow: [[0.8, 0.04], [0.92, 0.17], [0.62, 0.12], [0.7, 0.22]] } as const;
type BridgeRow = { guid: string; srcChainId: number | null; dstChainId: number | null };

/** $OMNITIDE: the chains as a constellation; real LayerZero transfers and Council proposals send bright pulses along the lanes. */
export function StarChart() {
  const keys = [HUB_KEY, ...V3_CHAINS.filter((k) => k !== HUB_KEY)];
  const stars = (narrow: boolean): Star[] =>
    keys.map((k, i) => {
      const [x, y] = SKY[narrow ? "narrow" : "wide"][i] ?? [0.1 + i * 0.2, 0.7];
      return { key: k, label: narrow ? undefined : i === 0 ? `${NETWORK[k]} · hub` : NETWORK[k], x, y };
    });
  const lanes: [number, number][] = keys.flatMap((_, a) => keys.map((_, b) => [a, b] as [number, number]).filter(([x, y]) => x < y));
  const idx = (chainId: number | null) => keys.findIndex((k) => CHAINS[k].chainId === chainId);

  const queue = useRef<[number, number][]>([]);
  const seen = useRef<Set<string> | null>(null);
  const { data: bridge } = useIndexer<BridgeRow[]>("bridge");
  const { data: council } = useQuery({
    queryKey: ["council-sky"],
    refetchInterval: 20_000,
    queryFn: async () => (await (await fetch("/api/indexer/council?limit=20")).json()) as { proposals?: { id: string | number }[] },
  });
  useEffect(() => {
    const ids = [...(Array.isArray(bridge) ? bridge.map((b) => `b:${b.guid}`) : []), ...(council?.proposals ?? []).map((p) => `p:${p.id}`)];
    if (!seen.current) {
      // what was already on chain when the page opened stays quiet; only new messages pulse
      if (bridge !== undefined || council !== undefined) seen.current = new Set(ids);
      return;
    }
    for (const b of Array.isArray(bridge) ? bridge : []) {
      const id = `b:${b.guid}`;
      if (seen.current.has(id)) continue;
      seen.current.add(id);
      const [from, to] = [idx(b.srcChainId), idx(b.dstChainId)];
      if (from >= 0 && to >= 0) queue.current.push([from, to]);
    }
    for (const p of council?.proposals ?? []) {
      const id = `p:${p.id}`;
      if (seen.current.has(id)) continue;
      seen.current.add(id);
      for (let i = 1; i < keys.length; i++) queue.current.push([0, i]); // proposals mirror from the hub to every spoke
    }
  });

  const { canvas } = useCanvas2d((ctx) => starScene(ctx, stars(small()), lanes, () => queue.current.splice(0)));
  return <canvas ref={canvas} aria-hidden className={FILL} />;
}

/** Surface: the engraved sea, back where the dive started (WebGL, loaded when the band comes near). */
export function SurfaceOcean() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const api = useRef<Ocean | null>(null);
  const swell = useSwell();
  const swellRef = useRef(swell);
  const [live, setLive] = useState(false);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let dead = false;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return;
        io.disconnect();
        import("./ocean-scene")
          .then(({ mountOcean }) => {
            if (dead) return;
            api.current = mountOcean(el, { swell: swellRef.current, horizon: 0.36 });
            setLive(true);
          })
          .catch(() => {}); // no WebGL: the navy band stands on its own
      },
      { rootMargin: "600px" },
    );
    io.observe(el);
    return () => {
      dead = true;
      io.disconnect();
      api.current?.dispose();
      api.current = null;
    };
  }, []);
  useEffect(() => {
    swellRef.current = swell;
    api.current?.setSwell(swell);
  }, [swell]);
  return <canvas ref={canvas} aria-hidden className={`${FILL} transition-opacity duration-1000 ${live ? "" : "opacity-0"}`} />;
}

// soundings scattered over one chart tile, as on an old survey sheet
const SOUNDINGS = [
  [34, 52, "17"], [190, 30, "23"], [300, 96, "9"], [420, 40, "31"], [80, 170, "14"], [250, 200, "27"], [380, 230, "19"],
  [40, 320, "12"], [160, 290, "8"], [330, 350, "35"], [450, 300, "21"], [110, 430, "16"], [270, 440, "24"], [420, 420, "11"],
] as const;

/** Contracts and FAQ: a survey chart under the content, graticule, soundings and a compass rose that turns as you scroll. */
export function ChartGrid({ seed = "chart", rose = "right" }: { seed?: string; rose?: "left" | "right" }) {
  const roseRef = useRef<SVGGElement>(null);
  useEffect(() => {
    const el = roseRef.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const turn = () => {
      raf = 0;
      el.setAttribute("transform", `rotate(${(window.scrollY * 0.04) % 360})`);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(turn);
    };
    turn();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);
  const id = `grid-${seed}`;
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 -z-10 h-full w-full text-ink">
      <defs>
        <pattern id={id} width="480" height="480" patternUnits="userSpaceOnUse">
          <path d="M480 0H0V480" fill="none" stroke="currentColor" strokeOpacity="0.06" />
          <path d="M240 0V480M0 240H480" fill="none" stroke="currentColor" strokeOpacity="0.04" strokeDasharray="2 6" />
          {SOUNDINGS.map(([x, y, d]) => (
            <text key={`${x}-${y}`} x={x} y={y} fill="currentColor" fillOpacity="0.13" fontSize="10" fontFamily="var(--font-mono)" fontStyle="italic">
              {d}
            </text>
          ))}
          <text x="6" y="14" fill="currentColor" fillOpacity="0.18" fontSize="9" fontFamily="var(--font-mono)">
            40°42′N
          </text>
          <text x="246" y="14" fill="currentColor" fillOpacity="0.18" fontSize="9" fontFamily="var(--font-mono)">
            74°00′W
          </text>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
      <svg x={rose === "right" ? "100%" : "0"} y="100%" overflow="visible">
        <g transform={`translate(${rose === "right" ? -150 : 150} -170)`}>
          <g ref={roseRef} fill="none" stroke="currentColor" strokeOpacity="0.14">
            <circle r="130" />
            <circle r="118" strokeDasharray="1 5" />
            <circle r="40" />
            {Array.from({ length: 32 }, (_, i) => (
              <line key={i} x1="0" y1={-118} x2="0" y2={i % 8 === 0 ? -100 : i % 4 === 0 ? -106 : -112} transform={`rotate(${i * 11.25})`} />
            ))}
            {[0, 90, 180, 270].map((a) => (
              <path key={a} d="M0 -112 L9 -9 L0 0 L-9 -9 Z" transform={`rotate(${a})`} fill="currentColor" fillOpacity={a === 0 ? 0.14 : 0.06} />
            ))}
            {[45, 135, 225, 315].map((a) => (
              <path key={a} d="M0 -72 L6 -6 L0 0 L-6 -6 Z" transform={`rotate(${a})`} />
            ))}
            <text y="-138" textAnchor="middle" fill="currentColor" fillOpacity="0.3" stroke="none" fontSize="11" fontFamily="var(--font-mono)">
              N
            </text>
          </g>
        </g>
      </svg>
    </svg>
  );
}
