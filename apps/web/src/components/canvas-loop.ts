export type Pointer = { x: number; y: number; on: boolean; down: number };
export type Frame = { w: number; h: number; t: number; dt: number; pointer: Pointer };
export type Loop = { redraw: () => void; stop: () => void };

/**
 * Drives a background canvas: keeps it sized to its box, tracks the pointer in canvas space, runs `frame` only while
 * it is on screen and the tab is visible, and draws a single still frame for reduced motion (or `animate: false`).
 */
export function runLoop(canvas: HTMLCanvasElement, o: { resize?: (w: number, h: number, dpr: number) => void; frame: (f: Frame) => void; animate?: boolean; maxDpr?: number; still?: number }): Loop {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const animate = o.animate !== false && !reduced;
  const pointer: Pointer = { x: -1e4, y: -1e4, on: false, down: -1e9 };
  let w = 1;
  let h = 1;
  let t = o.still ?? 0;
  let last = 0;
  let raf = 0;
  let running = false;
  let visible = false;

  const draw = (dt: number) => o.frame({ w, h, t, dt, pointer });
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, o.maxDpr ?? 2);
    w = canvas.clientWidth || 1;
    h = canvas.clientHeight || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    o.resize?.(w, h, dpr);
    if (!running) draw(0);
  };
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    t += dt;
    draw(dt);
  };
  const play = () => {
    if (!animate || running || !visible || document.hidden) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(tick);
  };
  const pause = () => {
    running = false;
    cancelAnimationFrame(raf);
  };

  const local = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    pointer.x = e.clientX - r.left;
    pointer.y = e.clientY - r.top;
    pointer.on = pointer.x >= 0 && pointer.y >= 0 && pointer.x <= r.width && pointer.y <= r.height;
    return pointer.on;
  };
  const onMove = (e: PointerEvent) => void local(e);
  const onDown = (e: PointerEvent) => {
    if (local(e)) pointer.down = t;
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") pointer.on = false;
  };
  const onLeave = () => (pointer.on = false);
  const onVisibility = () => (document.hidden ? pause() : play());

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  const io = new IntersectionObserver(
    ([e]) => {
      visible = !!e?.isIntersecting;
      if (visible) play();
      else pause();
    },
    { rootMargin: "120px" },
  );
  io.observe(canvas);
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerdown", onDown, { passive: true });
  window.addEventListener("pointerup", onUp, { passive: true });
  document.documentElement.addEventListener("pointerleave", onLeave);
  document.addEventListener("visibilitychange", onVisibility);
  resize();

  return {
    redraw: () => {
      if (!running) draw(0);
    },
    stop: () => {
      pause();
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}

/** 2D context scaled to CSS pixels on every resize. */
export function scaled2d(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  return { ctx, resize: (_w: number, _h: number, dpr: number) => ctx.setTransform(dpr, 0, 0, dpr, 0, 0) };
}
