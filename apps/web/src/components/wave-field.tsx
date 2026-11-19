"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "./theme";

const LOGO = "/brand/mark-512.webp";
const SRC = 720; // the mark is resampled at this size before stippling
const STEP = 3;
const LOOP = 8; // seconds; every motion term repeats on it so the loop is seamless
const TAU = Math.PI * 2;

// tone bands from deep water to foam, tuned per theme so the crests stay visible on paper
const PALETTE = {
  light: ["#1530c0", "#1b34d6", "#1f3dff", "#3b82ff", "#78a9ff"],
  dark: ["#1a2a9e", "#1f3dff", "#3f7bff", "#62c4ff", "#f4f7ff"],
};

type Theme = keyof typeof PALETTE;
type Api = { setTheme: (t: Theme) => void; setSwell: (s: number) => void };
type Particle = { ox: number; oy: number; band: number; k: number; ph: number; sx: number; sy: number; px: number; py: number; vx: number; vy: number; wait: number };

/** Stipple the mark: painted pixels become particles, brighter paint lands in a higher tone band. Coordinates are normalised to the mark's bounds. */
export function sampleLogo(rgba: Uint8ClampedArray, w: number, h: number, step: number, rand: () => number) {
  const pts: { ox: number; oy: number; band: number }[] = [];
  let x0 = w;
  let y0 = h;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < h; y += step)
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      const r = rgba[i]!;
      const g = rgba[i + 1]!;
      const b = rgba[i + 2]!;
      const ink = (Math.max(r, g, b) - 60) / 150; // the navy backdrop sits well under 60
      if (ink < 0.1 || (ink < 0.6 && rand() > ink * 1.4)) continue;
      pts.push({ ox: x, oy: y, band: Math.min(4, Math.floor(((r + g + b) / 765) * 5)) });
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  const bw = Math.max(1, x1 - x0);
  const bh = Math.max(1, y1 - y0);
  for (const p of pts) {
    p.ox = (p.ox - x0) / bw;
    p.oy = (p.oy - y0) / bh;
  }
  return { pts: pts.sort((p, q) => p.band - q.band), aspect: bw / bh };
}

function animate(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, img: HTMLImageElement, swell: number, api: { current: Api | null }) {
  const off = document.createElement("canvas");
  off.width = SRC;
  off.height = SRC;
  const g = off.getContext("2d", { willReadFrequently: true });
  if (!g) return () => {};
  g.drawImage(img, 0, 0, SRC, SRC);
  const { pts, aspect } = sampleLogo(g.getImageData(0, 0, SRC, SRC).data, SRC, SRC, STEP, Math.random);
  const parts: Particle[] = pts.map((p) => ({
    ...p,
    k: 1 + Math.floor(Math.random() * 3),
    ph: Math.random() * TAU,
    sx: Math.random() * 2.4 - 1.2,
    sy: Math.random() * 2.4 - 1.2,
    px: 0,
    py: 0,
    vx: 0,
    vy: 0,
    wait: 0,
  }));

  // leftmost reach of the mark per horizontal slice, used to fit it beside the hero copy
  const SLICES = 48;
  const reach = new Float32Array(SLICES).fill(2);
  for (const p of parts) {
    const i = Math.min(SLICES - 1, Math.floor(p.oy * SLICES));
    reach[i] = Math.min(reach[i]!, p.ox);
  }
  // line boxes of the hero copy (text ink, not the full-width blocks), relative to the canvas
  const copyLines = () => {
    const c = canvas.getBoundingClientRect();
    const range = document.createRange();
    return [...(document.querySelector("[data-hero-copy]")?.children ?? [])].flatMap((el) => {
      range.selectNodeContents(el);
      return [...range.getClientRects()].map((r) => ({ t: r.top - c.top, b: r.bottom - c.top, r: r.right - c.left }));
    });
  };

  let pal = PALETTE[document.documentElement.dataset.theme === "dark" ? "dark" : "light"];
  let w = 0;
  let h = 0;
  let fade = 1;
  let placed = false;
  let box = { x: 0, y: 0, w: 0, h: 0 };
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const dock = document.querySelector("[data-hero-dock]")?.getBoundingClientRect();
    const floor = dock ? dock.top - canvas.getBoundingClientRect().top + 40 : h - 140; // the tails tuck just behind the tide table
    const text = copyLines();
    // largest mark, bleeding 7% off the right edge, whose every slice stays clear of the copy
    const fits = (bw: number) => {
      const bh = bw / aspect;
      const x = w - bw * 0.93;
      const y = floor - bh;
      return text.every((r) =>
        reach.every((ox, i) => {
          const top = y + (i / SLICES) * bh;
          return top + bh / SLICES < r.t - 20 || top > r.b + 20 || x + ox * bw > r.r + 32;
        }),
      );
    };
    let lo = 0;
    let hi = Math.min(w * 0.8, (floor - 72) * aspect);
    for (let k = 0; k < 18; k++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    if (lo >= Math.max(360, w * 0.38)) {
      box = { x: w - lo * 0.93, y: floor - lo / aspect, w: lo, h: lo / aspect };
      fade = 1;
    } else {
      // no room beside the copy (phones, portrait tablets): the mark sits faint and low behind the buttons
      const bw = w * 1.2;
      const bh = bw / aspect;
      box = { x: w * 0.6 - bw / 2, y: h * 0.64 - bh / 2, w: bw, h: bh };
      fade = 0.22;
    }
    if (!placed) {
      for (const p of parts) {
        // a loose spray off to the right that rolls left into the mark, like the waves themselves
        p.px = box.x + box.w * (0.75 + (Math.random() + Math.random() - 1) * 0.6);
        p.py = box.y + box.h * (0.5 + (Math.random() + Math.random() - 1) * 0.6);
        p.wait = (1 - p.ox) * 650 + Math.random() * 250; // the big wave lands first, the small ones roll in after
      }
      placed = true;
    }
  };

  let amp = 0.45 + swell * 0.9;
  let ampTarget = amp;
  let disperse = 0;
  const pointer = { x: 0, y: 0, on: false };
  const splash = { x: 0, y: 0, at: -1e9 };
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let start = 0;
  let last = 0;
  const draw = (now: number) => {
    start ||= now;
    const elapsed = now - start;
    const u = reduced ? 1.2 : ((elapsed / 1000 / LOOP) % 1) * TAU;
    const n = last ? Math.min(2.5, (now - last) / 16.667) : 1;
    last = now;
    amp += (ampTarget - amp) * Math.min(1, n * 0.012);
    const damp = 0.78 ** n;
    const pull = 0.055 * n;
    const dot = Math.max(1.2, Math.min(2.4, box.w / 320));
    const scale = 1 + Math.sin(u) * 0.012;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const orbit = 5 * amp;
    const spread = disperse * 260;
    const alpha = fade * (1 - disperse * 0.85) * (reduced ? 1 : Math.min(1, elapsed / 400));
    const age = (now - splash.at) / 1000;
    const ring = age < 1.2 ? age * 520 : -1;

    ctx.clearRect(0, 0, w, h);
    let band = -1;
    for (const p of parts) {
      if (p.band !== band) {
        band = p.band;
        ctx.fillStyle = pal[band]!;
        ctx.globalAlpha = (0.6 + band * 0.1) * alpha;
      }
      // orbital swell rolling right to left like the mark's breaking crests; crests swing wider than troughs
      const phase = p.ox * TAU * 1.5 + u;
      const lift = orbit * (0.35 + 0.65 * (1 - p.oy));
      let hx = cx + (p.ox - 0.5) * box.w * scale + Math.cos(phase) * lift + Math.sin(u * p.k + p.ph) * 1.2;
      let hy = cy + (p.oy - 0.5) * box.h * scale - Math.sin(phase) * lift + Math.cos(u * p.k + p.ph * 1.7) * 1.2;
      if (band === 4) {
        // foam lifts off the crest as the swell peak passes under it
        const s = Math.max(0, Math.sin(phase)) ** 6 * 10 * amp;
        hx += (p.sx - 0.6) * s;
        hy -= Math.abs(p.sy) * s;
      }
      let x = hx;
      let y = hy;
      if (!reduced) {
        if (elapsed < p.wait) {
          x = p.px;
          y = p.py;
        } else {
          p.vx += (hx - p.px) * pull;
          p.vy += (hy - p.py) * pull;
          if (pointer.on) {
            const dx = p.px - pointer.x;
            const dy = p.py - pointer.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < 8100) {
              const d = Math.sqrt(d2) || 1;
              const f = (1 - d / 90) * 1.6 * n;
              p.vx += (dx / d) * f;
              p.vy += (dy / d) * f;
            }
          }
          if (ring > 0) {
            const dx = p.px - splash.x;
            const dy = p.py - splash.y;
            const d = Math.sqrt(dx * dx + dy * dy) || 1;
            const edge = Math.abs(d - ring);
            if (edge < 40) {
              const f = (1 - edge / 40) * 2.4 * (1 - age / 1.2) * n;
              p.vx += (dx / d) * f;
              p.vy += (dy / d) * f;
            }
          }
          p.vx *= damp;
          p.vy *= damp;
          p.px += p.vx * n;
          p.py += p.vy * n;
          x = p.px + p.sx * spread;
          y = p.py + p.sy * spread * 0.6;
        }
      }
      ctx.fillRect(x, y, dot, dot);
    }
    ctx.globalAlpha = 1;
  };

  let raf = 0;
  let running = false;
  let visible = true;
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

  let live = true;
  const refit = () => {
    if (!live) return;
    resize();
    if (reduced) still();
  };
  const ro = new ResizeObserver(refit);
  ro.observe(canvas);
  const copy = document.querySelector("[data-hero-copy]");
  if (copy) ro.observe(copy);
  resize();
  void document.fonts.ready.then(refit); // the display face changes the headline's width when it swaps in
  const io = new IntersectionObserver(([e]) => {
    visible = !!e?.isIntersecting;
    if (visible) play();
    else pause();
  });
  io.observe(canvas);
  const onVisibility = () => (document.hidden ? pause() : play());
  const local = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, inside: e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom };
  };
  const onMove = (e: PointerEvent) => {
    const { x, y } = local(e);
    Object.assign(pointer, { x, y, on: true });
  };
  const onDown = (e: PointerEvent) => {
    const { x, y, inside } = local(e);
    if (inside) Object.assign(splash, { x, y, at: performance.now() });
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") pointer.on = false;
  };
  const onLeave = () => (pointer.on = false);
  const onScroll = () => (disperse = Math.max(0, Math.min(1, window.scrollY / (h * 0.7))));
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerdown", onDown, { passive: true });
  window.addEventListener("pointerup", onUp, { passive: true });
  document.documentElement.addEventListener("pointerleave", onLeave);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  if (reduced) still();
  else play();

  api.current = {
    setTheme: (t) => {
      pal = PALETTE[t];
      if (reduced) still();
    },
    setSwell: (s) => (ampTarget = 0.45 + Math.max(0, Math.min(1, s)) * 0.9),
  };

  return () => {
    live = false;
    pause();
    ro.disconnect();
    io.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointerup", onUp);
    document.documentElement.removeEventListener("pointerleave", onLeave);
    window.removeEventListener("scroll", onScroll);
    api.current = null;
  };
}

/** Hero mark made of particles: the OMNITIDE waves roll on a seamless loop, part around the cursor, splash on click and scatter as you scroll. `swell` 0..1 follows the market. */
export function WaveField({ swell = 0.5, className = "" }: { swell?: number; className?: string }) {
  const host = useRef<HTMLCanvasElement>(null);
  const api = useRef<Api | null>(null);
  const swellRef = useRef(swell);
  const { theme } = useTheme();

  useEffect(() => {
    const canvas = host.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let stop = () => {};
    let dead = false;
    const img = new Image();
    img.src = LOGO;
    img.decode().then(
      () => {
        if (!dead) stop = animate(canvas, ctx, img, swellRef.current, api);
      },
      () => {},
    );
    return () => {
      dead = true;
      stop();
    };
  }, []);

  useEffect(() => {
    api.current?.setTheme(theme);
  }, [theme]);
  useEffect(() => {
    swellRef.current = swell;
    api.current?.setSwell(swell);
  }, [swell]);

  return <canvas ref={host} aria-hidden className={`block h-full w-full ${className}`} />;
}
