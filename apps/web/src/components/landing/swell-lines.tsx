"use client";

import { useEffect, useRef } from "react";

const ROWS = 26;
const STEP = 7;

/** An engraved sea surface in perspective: rows of dots that swell, and rise toward the cursor. */
export function SwellLines({ className = "" }: { className?: string }) {
  const host = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = host.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    const pointer = { x: -1e4, y: -1e4, k: 0, on: false };
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      pointer.k += ((pointer.on ? 1 : 0) - pointer.k) * 0.06;
      const horizon = h * 0.38;
      for (let r = 0; r < ROWS; r++) {
        const depth = (r + 1) / ROWS; // 0 far, 1 near
        const y0 = horizon + depth ** 1.7 * (h - horizon);
        const amp = 2 + depth * 14;
        const size = 0.8 + depth * 1.6;
        ctx.globalAlpha = 0.12 + depth * 0.5;
        ctx.fillStyle = r % 7 === 3 ? "#8ea2ff" : "#ffffff";
        for (let x = (r % 2) * (STEP / 2); x < w; x += STEP * (1.6 - depth * 0.6)) {
          let y = y0 + Math.sin(x * 0.012 * (1.4 - depth * 0.6) + t * 0.0009 + r * 0.55) * amp + Math.sin(x * 0.031 - t * 0.0013 + r) * amp * 0.25;
          const dx = x - pointer.x;
          const dy = y0 - pointer.y;
          y -= Math.exp(-(dx * dx) / 9000 - (dy * dy) / 14000) * 26 * depth * pointer.k;
          ctx.fillRect(x, y, size, size);
        }
      }
      ctx.globalAlpha = 1;
    };

    let raf = 0;
    let running = false;
    let visible = false;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      draw(t);
    };
    const play = () => {
      if (reduced || running || !visible || document.hidden) return;
      running = true;
      raf = requestAnimationFrame(frame);
    };
    const pause = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    const ro = new ResizeObserver(() => {
      resize();
      if (reduced) draw(0);
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      if (visible) play();
      else pause();
    });
    io.observe(canvas);
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer.x = e.clientX - r.left;
      pointer.y = e.clientY - r.top;
      pointer.on = pointer.y >= 0 && pointer.y <= r.height;
    };
    const onVisibility = () => (document.hidden ? pause() : play());
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    resize();
    if (reduced) draw(0);
    return () => {
      pause();
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={host} aria-hidden className={`block h-full w-full ${className}`} />;
}
