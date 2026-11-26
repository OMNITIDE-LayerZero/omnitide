"use client";

import { useEffect, useRef } from "react";
import { useSwell } from "@/lib/hooks";
import { useTheme } from "./theme";

const WORD = "OMNITIDE";

type Dot = { x: number; y: number; ph: number };
type Api = { setLevel: (l: number) => void; recolor: () => void };

const FONT = (size: number, family: string) => `600 ${size}px ${family}`;

/** Height the word needs to span width w edge to edge. */
function fitHeight(w: number, family: string) {
  const g = document.createElement("canvas").getContext("2d");
  if (!g) return w / 4;
  g.font = FONT(100, family);
  const m = g.measureText(WORD);
  return Math.ceil(((m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) * w) / (m.actualBoundingBoxLeft + m.actualBoundingBoxRight)) + 8;
}

/** Stipple the word: every inked pixel on a grid becomes a dot, coordinates in CSS px of the canvas. */
function stipple(w: number, h: number, family: string, step: number): Dot[] {
  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const g = off.getContext("2d", { willReadFrequently: true });
  if (!g) return [];
  g.font = FONT(100, family);
  const m = g.measureText(WORD);
  const size = (100 * w) / (m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
  g.font = FONT(size, family);
  const n = g.measureText(WORD);
  g.fillStyle = "#000";
  g.textBaseline = "alphabetic";
  g.fillText(WORD, (w - (n.actualBoundingBoxLeft + n.actualBoundingBoxRight)) / 2 + n.actualBoundingBoxLeft, (h + n.actualBoundingBoxAscent - n.actualBoundingBoxDescent) / 2);
  const px = g.getImageData(0, 0, w, h).data;
  const dots: Dot[] = [];
  for (let y = 0; y < h; y += step)
    for (let x = (y / step) % 2 ? step / 2 : 0; x < w; x += step) if (px[(Math.floor(y) * w + Math.floor(x)) * 4 + 3]! > 128) dots.push({ x, y, ph: Math.random() * Math.PI * 2 });
  return dots;
}

function run(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, level0: number, api: { current: Api | null }) {
  const family = getComputedStyle(canvas).fontFamily;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let w = 0;
  let h = 0;
  let dots: Dot[] = [];
  let top = 0;
  let bottom = 0;
  let ink = "#0e1430";
  let sea = "#5671ff";
  let dark = false;
  const recolor = () => {
    const s = getComputedStyle(document.documentElement);
    ink = s.getPropertyValue("--text").trim() || ink;
    sea = s.getPropertyValue("--accent").trim() || sea;
    dark = document.documentElement.dataset.theme === "dark";
  };
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio, 2);
    if (!canvas.clientWidth || canvas.clientWidth === w) return; // height changes alone don't need a new stipple
    w = canvas.clientWidth;
    h = fitHeight(w, family);
    canvas.style.height = `${h}px`;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dots = stipple(w, h, family, Math.max(3, Math.round(w / 360)));
    top = dots.length ? Math.min(...dots.map((d) => d.y)) : 0;
    bottom = dots.length ? Math.max(...dots.map((d) => d.y)) : 0;
  };

  let target = level0;
  let level = reduced ? level0 : 0; // the tide rises in once the footer is seen
  let surge = 0;
  const pointer = { x: -1e4, y: -1e4 };
  let last = 0;

  const draw = (now: number) => {
    const t = reduced ? 0 : now / 1000;
    const n = last ? Math.min(3, (now - last) / 16.667) : 1;
    last = now;
    level += (target - level) * Math.min(1, 0.03 * n);
    surge *= 0.96 ** n;
    const span = bottom - top;
    const amp = Math.max(3, span * 0.035);
    ctx.clearRect(0, 0, w, h);
    for (const wet of [false, true]) {
      ctx.fillStyle = wet ? sea : ink;
      ctx.globalAlpha = wet ? (dark ? 0.95 : 0.9) : dark ? 0.22 : 0.16;
      const size = wet ? 2 : 1.6;
      for (const d of dots) {
        const water = bottom - span * Math.min(1, level + surge) + Math.sin(d.x * 0.008 + t * 1.3) * amp + Math.sin(d.x * 0.021 - t * 0.9) * amp * 0.45;
        if (d.y >= water !== wet) continue;
        let x = d.x;
        let y = d.y + (wet ? Math.sin(t * 2.2 + d.x * 0.03 + d.ph) * 0.9 : 0);
        const dx = x - pointer.x;
        const dy = y - pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 6400) {
          const dist = Math.sqrt(d2) || 1;
          const push = (1 - dist / 80) * 14;
          x += (dx / dist) * push;
          y += (dy / dist) * push;
        }
        ctx.fillRect(x, y, size, size);
      }
    }
    ctx.globalAlpha = 1;
  };

  let raf = 0;
  let running = false;
  let visible = false;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    draw(now);
  };
  const play = () => {
    if (reduced || running || !visible || document.hidden) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  };
  const pause = () => {
    running = false;
    cancelAnimationFrame(raf);
  };
  const still = () => draw(performance.now());

  recolor();
  resize();
  const ro = new ResizeObserver(() => {
    resize();
    if (reduced) still();
  });
  ro.observe(canvas);
  const io = new IntersectionObserver(([e]) => {
    visible = !!e?.isIntersecting;
    if (visible) play();
    else pause();
  });
  io.observe(canvas);
  const local = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, inside: e.clientY >= r.top && e.clientY <= r.bottom };
  };
  const onMove = (e: PointerEvent) => Object.assign(pointer, local(e));
  const onLeave = () => Object.assign(pointer, { x: -1e4, y: -1e4 });
  const onDown = (e: PointerEvent) => {
    if (local(e).inside) surge = Math.min(0.25, surge + 0.12); // a tap sends a surge up the letters
  };
  const onVisibility = () => (document.hidden ? pause() : play());
  canvas.addEventListener("pointermove", onMove, { passive: true });
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("pointerdown", onDown, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  if (reduced) still();

  api.current = {
    setLevel: (l) => {
      target = l;
      if (reduced) {
        level = l;
        still();
      }
    },
    recolor: () => {
      recolor();
      if (reduced) still();
    },
  };

  return () => {
    pause();
    ro.disconnect();
    io.disconnect();
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerleave", onLeave);
    canvas.removeEventListener("pointerdown", onDown);
    document.removeEventListener("visibilitychange", onVisibility);
    api.current = null;
  };
}

/** The closing wordmark: OMNITIDE in stippled ink, filled to a tide line that follows the market's 24h swell. */
export function FooterWordmark() {
  const host = useRef<HTMLCanvasElement>(null);
  const api = useRef<Api | null>(null);
  const swell = useSwell();
  const level = 0.3 + swell * 0.45;
  const levelRef = useRef(level);
  const { theme } = useTheme();

  useEffect(() => {
    const canvas = host.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let stop = () => {};
    let dead = false;
    // the display face must be loaded before its pixels are sampled
    void document.fonts.load(FONT(100, getComputedStyle(canvas).fontFamily)).then(() => {
      if (!dead) stop = run(canvas, ctx, levelRef.current, api);
    });
    return () => {
      dead = true;
      stop();
    };
  }, []);

  useEffect(() => {
    levelRef.current = level;
    api.current?.setLevel(level);
  }, [level]);
  // next frame: the theme provider writes data-theme after this effect runs
  useEffect(() => {
    const r = requestAnimationFrame(() => api.current?.recolor());
    return () => cancelAnimationFrame(r);
  }, [theme]);

  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-6 pb-4 sm:px-8 sm:pt-10">
      <canvas ref={host} aria-hidden className="display block aspect-[4/1] w-full touch-pan-y" />
    </div>
  );
}
