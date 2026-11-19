"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "./theme";

const LOOP = 12; // seconds for one full repeat of every trace
const SPEED = 60; // px of paper per second; LOOP * SPEED is a multiple of the 80px major grid so the paper wraps cleanly too
const CHANNELS = ["CH1 SWELL", "CH2 BTC", "CH3 ETH", "CH4 SOL", "CH5 NVDA", "CH6 TIDE"];

// integer cycles per loop keep every trace seamless when the loop wraps
const HARMONICS = CHANNELS.map((_, i) => [
  { n: 2 + i, a: 0.55, p: i * 1.7 },
  { n: 7 + 2 * i, a: 0.28, p: i * 0.9 + 1 },
  { n: 19 + 3 * i, a: 0.1, p: i * 2.3 },
]);

/** -1..1 signal for channel `c` at loop phase `u` (0..1). */
export function signal(c: number, u: number) {
  let v = 0;
  for (const h of HARMONICS[c]!) v += h.a * Math.sin(Math.PI * 2 * h.n * u + h.p);
  // one sharp pen kick per loop, wrapped so it never splits at the seam
  const d = Math.abs(u - ((0.31 + c * 0.13) % 1));
  const w = Math.min(d, 1 - d) / 0.006;
  return v + 0.75 * Math.exp(-w * w) * (c % 2 ? -1 : 1);
}

/** Polygraph strip for the hero: ink pens trace the sea on scrolling chart paper. `swell` 0..1 sets the pen swing. */
export function Polygraph({ swell = 0.5, className = "" }: { swell?: number; className?: string }) {
  const host = useRef<HTMLCanvasElement>(null);
  const api = useRef<{ setTheme: () => void; setSwell: (s: number) => void } | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    const canvas = host.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let ink = { line: "", strong: "", accent: "", text2: "", text3: "", mono: "" };
    const readTheme = () => {
      const root = getComputedStyle(document.documentElement);
      const v = (k: string) => root.getPropertyValue(k).trim();
      const mono = getComputedStyle(document.body).getPropertyValue("--font-geist-mono").trim();
      ink = { line: v("--line"), strong: v("--line-strong"), accent: v("--accent"), text2: v("--text-2"), text3: v("--text-3"), mono: mono || "ui-monospace, monospace" };
    };
    readTheme();

    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 1.5);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    let amp = 0.45 + swell * 0.9;
    let ampTarget = amp;

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const scroll = (t * SPEED) % 80;
      const top = h * 0.4;
      const bottom = h * 0.97;
      const lane = (bottom - top) / CHANNELS.length;
      const penX = w * (w < 640 ? 0.9 : 0.84);
      const wide = w >= 1024; // wide screens keep the strip right of the copy column

      // chart paper: minor every 16px, major every 80px, scrolling with the strip
      ctx.lineWidth = 1;
      for (let x = -scroll; x < w; x += 16) {
        const major = Math.round((x + scroll) / 16) % 5 === 0;
        ctx.strokeStyle = major ? ink.strong : ink.line;
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, top - lane * 0.5);
        ctx.lineTo(Math.round(x) + 0.5, h);
        ctx.stroke();
      }
      for (let i = 0; i <= CHANNELS.length; i++) {
        const y = Math.round(top + i * lane) + 0.5;
        ctx.strokeStyle = ink.strong;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      ctx.font = `10px ${ink.mono}`;
      ctx.textBaseline = "top";
      for (let c = 0; c < CHANNELS.length; c++) {
        const base = top + (c + 0.5) * lane;
        const swing = lane * 0.36 * amp;
        const color = c === 0 ? ink.accent : c % 2 ? ink.text3 : ink.text2;
        const at = (x: number) => base - signal(c, ((((t - (penX - x) / SPEED) / LOOP) % 1) + 1) % 1) * swing;

        ctx.strokeStyle = color;
        ctx.lineWidth = c === 0 ? 1.4 : 1.1;
        ctx.lineJoin = "round";
        ctx.beginPath();
        for (let x = 0; x <= penX; x += 2) x === 0 ? ctx.moveTo(x, at(x)) : ctx.lineTo(x, at(x));
        ctx.stroke();

        // pen arm from its pivot at the right margin down to the tip on the paper
        const tip = at(penX);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(penX, tip);
        ctx.lineTo(penX + 44, base);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(penX, tip, 2.2, 0, Math.PI * 2);
        ctx.arc(penX + 44, base, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = ink.text3;
        ctx.fillText(CHANNELS[c]!, wide ? w * 0.52 : 16, top + c * lane + 6);
      }

      // the paper fades into the page under the headline and the copy
      ctx.globalCompositeOperation = "destination-out";
      const fadeTop = ctx.createLinearGradient(0, 0, 0, top);
      fadeTop.addColorStop(0.55, "#000");
      fadeTop.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = fadeTop;
      ctx.fillRect(0, 0, w, top);
      const fadeLeft = ctx.createLinearGradient(w * (wide ? 0.25 : 0), 0, w * (wide ? 0.55 : 0.18), 0);
      fadeLeft.addColorStop(0, wide ? "#000" : "rgba(0,0,0,0.85)");
      fadeLeft.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = fadeLeft;
      ctx.fillRect(0, top - lane, w * (wide ? 0.55 : 0.18), h - top + lane);
      if (!wide) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(0, 0, w, h);
      }
      ctx.globalCompositeOperation = "source-over";
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const still = () => draw(LOOP * 0.6);
    const ro = new ResizeObserver(() => {
      resize();
      if (reduced) still();
    });
    ro.observe(canvas);
    resize();

    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting));
    io.observe(canvas);

    let raf = 0;
    let last = performance.now();
    let t = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (!visible || document.hidden) return;
      t = (t + dt) % LOOP;
      amp += (ampTarget - amp) * Math.min(1, dt * 0.8);
      draw(t);
    };
    if (reduced) still();
    else raf = requestAnimationFrame(frame);

    api.current = {
      setTheme: () => {
        readTheme();
        if (reduced) still();
      },
      setSwell: (s) => (ampTarget = 0.45 + Math.max(0, Math.min(1, s)) * 0.9),
    };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      api.current = null;
    };
    // drawn once; theme and swell flow in through api.current
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
