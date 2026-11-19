"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "./theme";

const MW = 520; // offscreen engraving size; particles are sampled from it
const MH = 560;
const STEP = 3;

type Pt = [number, number];
type Particle = { ox: number; oy: number; band: number; ph: number; sp: number; sx: number; sy: number; px: number; py: number; vx: number; vy: number; wait: number };

function bezier(a: Pt, b: Pt, c: Pt, d: Pt, n = 40): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0], u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1]]);
  }
  return out;
}

// the curling wave in unit space: lip tip D, outer skin D→E→F→G, inner barrel D→C→B→A
const A: Pt = [0.3, 0.86], B: Pt = [0.48, 0.42], C: Pt = [0.34, 0.25], D: Pt = [0.18, 0.37], E: Pt = [0.32, 0.1], F: Pt = [0.58, 0.09], G: Pt = [1, 0.68];
const OUTER = [...bezier(D, [0.12, 0.24], [0.2, 0.12], E), ...bezier(E, [0.42, 0.07], [0.5, 0.06], F), ...bezier(F, [0.75, 0.15], [0.85, 0.5], G)];
const INNER = [...bezier(D, [0.2, 0.3], [0.26, 0.25], C), ...bezier(C, [0.42, 0.25], [0.45, 0.3], B), ...bezier(B, [0.52, 0.58], [0.46, 0.8], A)];

/** Paints the wave as a white ink engraving whose alpha becomes particle density. */
function paintWave(g: CanvasRenderingContext2D, rand: () => number) {
  const s = (p: Pt): Pt => [p[0] * MW, p[1] * MH];
  const line = (pts: Pt[]) => {
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(...s(p)) : g.moveTo(...s(p))));
  };

  // sea surface rolling under the wave
  g.fillStyle = "rgba(255,255,255,0.1)";
  g.fillRect(0, MH * 0.84, MW, MH * 0.16);
  g.strokeStyle = "rgba(255,255,255,0.7)";
  g.lineWidth = 1.4;
  for (let y = 0.845, i = 0; y < 1; y += 0.022, i++) line(Array.from({ length: 61 }, (_, k): Pt => [k / 60, y + 0.007 * Math.sin((k / 60) * 22 + i * 1.3)])), g.stroke();

  // body
  line([...OUTER, [1, 0.97], [0.3, 0.97], ...[...INNER].reverse()]);
  g.closePath();
  g.fillStyle = "rgba(255,255,255,0.14)";
  g.fill();

  // engraved contours sweeping from the lip down the face, packed toward the crest
  for (let i = 1; i < 22; i++) {
    const k = (i / 22) ** 1.2;
    g.strokeStyle = `rgba(255,255,255,${0.95 - k * 0.3})`;
    g.lineWidth = 2.2;
    line(OUTER.map((o, j): Pt => [o[0] + (INNER[j]![0] - o[0]) * k, o[1] + (INNER[j]![1] - o[1]) * k]));
    g.stroke();
  }
  g.strokeStyle = "#fff";
  g.lineWidth = 2.6;
  line(OUTER);
  g.stroke();

  // foam claws along the lip and spray over the crest
  g.fillStyle = "#fff";
  for (let j = 0; j < 70; j++) {
    const [x, y] = OUTER[j]!;
    const r = 2 + rand() * 6 * (1 - j / 70);
    g.beginPath();
    g.arc(x * MW - rand() * 10, y * MH - rand() * 12, r, 0, Math.PI * 2);
    g.fill();
  }
  for (let j = 0; j < 260; j++) {
    const [x, y] = OUTER[Math.floor(rand() * 90)]!;
    g.globalAlpha = 0.4 + rand() * 0.6;
    g.fillRect(x * MW + (rand() - 0.6) * 60, y * MH - rand() * 50, 2.5, 2.5);
  }
  // foam at the toe of the face
  for (let j = 0; j < 120; j++) {
    g.globalAlpha = 0.5 + rand() * 0.5;
    g.beginPath();
    g.arc((A[0] - 0.2 + rand() * 0.28) * MW, (A[1] - 0.02 + rand() * 0.06) * MH, 1 + rand() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

/** Stipple: one particle per STEP cell, faint cells kept with probability so tone survives as density. */
export function sampleParticles(alpha: Uint8ClampedArray, w: number, h: number, step: number, rand: () => number) {
  const out: { ox: number; oy: number; band: number }[] = [];
  for (let y = 0; y < h; y += step)
    for (let x = 0; x < w; x += step) {
      const a = alpha[(y * w + x) * 4 + 3]! / 255;
      if (a < 0.08 || (a < 0.5 && rand() > a * 1.6)) continue;
      out.push({ ox: x / w, oy: y / h, band: Math.min(4, Math.floor(a * 5)) });
    }
  return out.sort((p, q) => p.band - q.band);
}

/** Hero wave made of ink particles. Loops with the swell, parts around the cursor, scatters as you scroll. `swell` 0..1 follows the market. */
export function WaveField({ swell = 0.5, className = "" }: { swell?: number; className?: string }) {
  const host = useRef<HTMLCanvasElement>(null);
  const api = useRef<{ setTheme: () => void; setSwell: (s: number) => void } | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const canvas = host.current;
    const ctx = canvas?.getContext("2d");
    const off = document.createElement("canvas");
    off.width = MW;
    off.height = MH;
    const g = off.getContext("2d", { willReadFrequently: true });
    if (!canvas || !ctx || !g) return;

    paintWave(g, Math.random);
    const parts: Particle[] = sampleParticles(g.getImageData(0, 0, MW, MH).data, MW, MH, STEP, Math.random).map((p) => ({
      ...p,
      ph: Math.random() * Math.PI * 2,
      sp: 0.5 + Math.random(),
      sx: (Math.random() - 0.5) * 2.4,
      sy: (Math.random() - 0.5) * 2.4,
      px: 0,
      py: 0,
      vx: 0,
      vy: 0,
      wait: 0,
    }));

    let color = "";
    const readTheme = () => {
      const root = getComputedStyle(document.documentElement);
      color = root.getPropertyValue(document.documentElement.dataset.theme === "dark" ? "--text" : "--accent").trim();
    };
    readTheme();

    let w = 0;
    let h = 0;
    let box = { x: 0, y: 0, w: 0, h: 0 };
    let fade = 1;
    let placed = false;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const wide = w >= 820;
      let bh = h * (wide ? 0.78 : 0.62);
      let bw = bh * (MW / MH);
      const cap = w * (wide ? 0.52 : 0.95);
      if (bw > cap) (bw = cap), (bh = bw / (MW / MH));
      // narrow screens: the wave sits behind the copy, so it hangs off the right edge and stays faint
      box = { x: wide ? w - bw - w * 0.03 : w - bw * 0.78, y: h * (wide ? 0.8 : 0.74) - bh, w: bw, h: bh };
      fade = wide ? 1 : 0.5;
      if (!placed) {
        for (const p of parts) {
          const sx = Math.random() ** 1.3 * w;
          p.px = sx;
          p.py = box.y + p.oy * box.h + (Math.random() - 0.5) * box.h * 0.5;
          p.wait = (1 - sx / w) * 500 + Math.random() * 240;
        }
        placed = true;
      }
    };

    let amp = 0.45 + swell * 0.9;
    let ampTarget = amp;
    let disperse = 0;
    const pointer = { x: -9999, y: -9999, on: false };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let start = 0;
    let last = 0;
    const draw = (now: number) => {
      start ||= now;
      const t = (now - start) / 1000;
      const n = last ? Math.min(2.5, (now - last) / 16.667) : 1;
      last = now;
      const elapsed = now - start;
      const damp = 0.78 ** n;
      const pull = 0.055 * n;
      const dot = Math.max(1.1, Math.min(2, box.w / 360));
      const spread = disperse * 260;
      const alpha = fade * (1 - disperse * 0.85) * (reduced ? 1 : Math.min(1, elapsed / 400));
      amp += (ampTarget - amp) * Math.min(1, n * 0.012);

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = color;
      let band = -1;
      for (const p of parts) {
        if (p.band !== band) (band = p.band), (ctx.globalAlpha = ((band + 0.6) / 5) * alpha);
        // looping swell: the crest heaves, the sea rolls under it, every grain drifts on its own phase
        const heave = Math.sin(t * 0.9 + p.ox * 3) * (1 - p.oy) * 7 * amp;
        const roll = p.oy > 0.82 ? Math.sin(p.ox * 14 - t * 1.6) * 4 * amp : 0;
        const hx = box.x + p.ox * box.w + (reduced ? 0 : Math.sin(t * 0.9 * p.sp + p.ph) * 1.8 + Math.cos(t * 0.5 + p.oy * 5) * 3 * amp);
        const hy = box.y + p.oy * box.h + (reduced ? 0 : Math.cos(t * 0.7 * p.sp + p.ph * 1.7) * 1.8 - heave + roll);
        if (reduced) {
          ctx.fillRect(hx, hy, dot, dot);
          continue;
        }
        if (elapsed < p.wait) {
          ctx.fillRect(p.px, p.py, dot, dot);
          continue;
        }
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
        p.vx *= damp;
        p.vy *= damp;
        p.px += p.vx * n;
        p.py += p.vy * n;
        ctx.fillRect(p.px + p.sx * spread, p.py + p.sy * spread * 0.6, dot, dot);
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

    const ro = new ResizeObserver(() => {
      resize();
      if (reduced) still();
    });
    ro.observe(canvas);
    resize();
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      if (visible) play();
      else pause();
    });
    io.observe(canvas);
    const onVisibility = () => (document.hidden ? pause() : play());
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
      pointer.on = true;
    };
    const onLeave = () => (pointer.on = false);
    const onScroll = () => {
      disperse = Math.max(0, Math.min(1, window.scrollY / (h * 0.7)));
      if (reduced) still();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    if (reduced) still();
    else play();

    api.current = {
      setTheme: () => {
        readTheme();
        if (reduced) still();
      },
      setSwell: (s) => (ampTarget = 0.45 + Math.max(0, Math.min(1, s)) * 0.9),
    };

    return () => {
      pause();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("scroll", onScroll);
      api.current = null;
    };
    // built once; theme and swell flow in through api.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.current?.setTheme();
  }, [theme]);
  useEffect(() => {
    api.current?.setSwell(swell);
  }, [swell]);

  return <canvas ref={host} aria-hidden className={`block h-full w-full ${className}`} />;
}
