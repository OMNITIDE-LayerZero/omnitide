import type { Frame } from "../canvas-loop";

const TAU = Math.PI * 2;

/** Small seeded PRNG so layouts stay put between renders. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const monoFont = (px: number) => `${px}px ${getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() || "ui-monospace, monospace"}`;

/** A soft round glow, drawn once and stamped with drawImage. */
function glowSprite(color: string) {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, color);
  grad.addColorStop(0.25, color.replace(/[\d.]+\)$/, "0.45)"));
  grad.addColorStop(1, color.replace(/[\d.]+\)$/, "0)"));
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c;
}

// ───────────────────────── V2 Current: drift along the flow ─────────────────────────

/** Flow direction at a point: westward with slow meanders, like the current the tier is named for. */
export function flowAngle(x: number, y: number, t: number) {
  return Math.PI + 0.55 * Math.sin(y * 0.0045 + t * 0.25) + 0.35 * Math.sin(x * 0.003 - y * 0.002 + t * 0.18);
}

/** Particles riding the current, faster when more collateral has crossed chains; the cursor stirs an eddy. */
export function currentScene(ctx: CanvasRenderingContext2D, count: number, speed: () => number) {
  type P = { x: number; y: number; v: number; accent: boolean };
  const rand = rng(7);
  let parts: P[] = [];
  const respawn = (p: P, w: number, h: number, anywhere: boolean) => {
    p.x = anywhere ? rand() * w : w + rand() * 60;
    p.y = rand() * h;
    p.v = 0.5 + rand() * 0.9;
  };
  return ({ w, h, t, dt, pointer }: Frame) => {
    if (parts.length === 0) parts = Array.from({ length: count }, (_, i) => {
      const p = { x: 0, y: 0, v: 1, accent: i % 6 === 0 };
      respawn(p, w, h, true);
      return p;
    });
    if (dt === 0) {
      // still frame: the streamlines themselves
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(201, 211, 255, 0.16)";
      ctx.beginPath();
      for (const p of parts.slice(0, 70)) {
        let x = p.x;
        let y = p.y;
        ctx.moveTo(x, y);
        for (let k = 0; k < 60; k++) {
          const a = flowAngle(x, y, t);
          x += Math.cos(a) * 6;
          y += Math.sin(a) * 3.6;
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      return;
    }
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0, 0, 0, 0.07)";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
    const s = speed() * 70;
    ctx.lineWidth = 1.2;
    ctx.lineCap = "round";
    for (const accent of [false, true]) {
      ctx.strokeStyle = accent ? "rgba(142, 162, 255, 0.55)" : "rgba(214, 222, 255, 0.3)";
      ctx.beginPath();
      for (const p of parts) {
        if (p.accent !== accent) continue;
        const a = flowAngle(p.x, p.y, t);
        let vx = Math.cos(a) * p.v * s;
        let vy = Math.sin(a) * p.v * s * 0.6;
        if (pointer.on) {
          const dx = p.x - pointer.x;
          const dy = p.y - pointer.y;
          const d = Math.hypot(dx, dy);
          if (d < 150 && d > 1) {
            const k = (1 - d / 150) * 160;
            vx += (-dy / d) * k;
            vy += (dx / d) * k;
          }
        }
        const nx = p.x + vx * dt;
        const ny = p.y + vy * dt;
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(nx, ny);
        p.x = nx;
        p.y = ny;
        if (p.x < -20 || p.y < -20 || p.y > h + 20 || p.x > w + 80) respawn(p, w, h, false);
      }
      ctx.stroke();
    }
  };
}

// ───────────────────────── V3 Deep Water: bioluminescence ─────────────────────────

/** Plankton that wake up blue under the cursor (or a tap's ring) and flash on their own now and then. */
export function deepScene(ctx: CanvasRenderingContext2D, count: number) {
  const rand = rng(11);
  const dots = Array.from({ length: count }, () => ({ x: rand(), y: rand(), ph: rand() * TAU, e: 0, s: 0.6 + rand() * 1.1 }));
  const blue = glowSprite("rgba(98, 196, 255, 1)");
  const violet = glowSprite("rgba(142, 162, 255, 1)");
  return ({ w, h, t, dt, pointer }: Frame) => {
    ctx.clearRect(0, 0, w, h);
    const age = t - pointer.down;
    const ring = age < 1.6 ? age * 520 : -1;
    const decay = Math.pow(0.08, dt);
    ctx.globalCompositeOperation = "lighter";
    for (const [i, d] of dots.entries()) {
      d.x = (d.x + Math.sin(t * 0.13 + d.ph) * 0.000012 * d.s + 1) % 1;
      d.y = (d.y - 0.0000055 * d.s * (dt * 60) + 1) % 1;
      const x = d.x * w + Math.sin(t * 0.4 + d.ph) * 6;
      const y = d.y * h;
      let e = d.e * decay;
      if (pointer.on) e = Math.max(e, 1 - Math.hypot(x - pointer.x, y - pointer.y) / 180);
      if (ring > 0 && Math.abs(Math.hypot(x - pointer.x, y - pointer.y) - ring) < 36) e = 1;
      if (dt > 0 && Math.random() < dt * 0.025) e = Math.max(e, 0.85);
      d.e = e;
      ctx.globalAlpha = 0.22 + e * 0.6;
      ctx.fillStyle = "#cfe3ff";
      ctx.fillRect(x, y, d.s, d.s);
      if (e > 0.04) {
        const r = 10 + e * 22 * d.s;
        ctx.globalAlpha = e * 0.85;
        ctx.drawImage(i % 3 ? blue : violet, x - r, y - r, r * 2, r * 2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  };
}

// ───────────────────────── Markets: bathymetry from the tape ─────────────────────────

export type Seamount = { id: string; x: number; y: number; z: number; label: string };

/** One seamount per market on a jittered grid; rallies stand up as peaks, sell-offs sink as trenches. */
export function seamounts(markets: { symbol: string; change?: number }[], cols = 6) {
  const rows = Math.ceil(markets.length / cols);
  const rand = rng(31);
  return markets.map((m, i): Seamount => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const chg = m.change ?? 0;
    const sign = chg < 0 ? "−" : "+";
    return {
      id: m.symbol,
      x: (c + 0.2 + rand() * 0.6) / cols,
      y: (r + 0.2 + rand() * 0.6) / rows,
      z: Math.sign(chg || 1) * (0.35 + Math.min(1, Math.abs(chg) / 4) * 0.9),
      label: m.change === undefined ? m.symbol : `${m.symbol} ${sign}${Math.abs(chg).toFixed(1)}`,
    };
  });
}

/** Height of the sea floor: the seamounts plus a slow swell of the shelf. */
export function depthAt(peaks: Seamount[], w: number, h: number, x: number, y: number) {
  const sigma = Math.max(60, Math.min(140, (w + h) * 0.032));
  let z = 0.16 * Math.sin(x * 0.004) * Math.cos(y * 0.005);
  for (const p of peaks) {
    const dx = x - p.x * w;
    const dy = y - p.y * h;
    z += p.z * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
  }
  return z;
}

/** Marching squares on a sampled grid: flat [x1, y1, x2, y2, …] segments where the field crosses `level`. */
export function contour(grid: Float32Array, cols: number, rows: number, cell: number, level: number) {
  const out: number[] = [];
  const at = (a: number, b: number) => (level - a) / (b - a || 1e-9);
  for (let j = 0; j < rows - 1; j++)
    for (let i = 0; i < cols - 1; i++) {
      const a = grid[j * cols + i]!;
      const b = grid[j * cols + i + 1]!;
      const c = grid[(j + 1) * cols + i + 1]!;
      const d = grid[(j + 1) * cols + i]!;
      const pts: number[] = [];
      const x = i * cell;
      const y = j * cell;
      if (a < level !== b < level) pts.push(x + at(a, b) * cell, y);
      if (b < level !== c < level) pts.push(x + cell, y + at(b, c) * cell);
      if (c < level !== d < level) pts.push(x + cell - at(c, d) * cell, y + cell);
      if (d < level !== a < level) pts.push(x, y + cell - at(d, a) * cell);
      if (pts.length >= 4) out.push(pts[0]!, pts[1]!, pts[2]!, pts[3]!);
      if (pts.length === 8) out.push(pts[4]!, pts[5]!, pts[6]!, pts[7]!);
    }
  return out;
}

/** The nautical chart: contours every 0.1, trenches dashed, soundings at each seamount, the hovered market in accent. */
export function drawBathymetry(ctx: CanvasRenderingContext2D, w: number, h: number, peaks: Seamount[], hover: string | null, ink: string, accent: string) {
  ctx.clearRect(0, 0, w, h);
  const cell = 10;
  const cols = Math.ceil(w / cell) + 1;
  const rows = Math.ceil(h / cell) + 1;
  const grid = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) grid[j * cols + i] = depthAt(peaks, w, h, i * cell, j * cell);
  const stroke = (segs: number[]) => {
    ctx.beginPath();
    for (let k = 0; k < segs.length; k += 4) {
      ctx.moveTo(segs[k]!, segs[k + 1]!);
      ctx.lineTo(segs[k + 2]!, segs[k + 3]!);
    }
    ctx.stroke();
  };
  ctx.strokeStyle = ink;
  for (let n = -13; n <= 13; n++) {
    if (n === 0) continue;
    ctx.globalAlpha = n % 5 === 0 ? 0.42 : 0.22;
    ctx.lineWidth = n % 5 === 0 ? 1.1 : 0.8;
    ctx.setLineDash(n < 0 ? [3, 4] : []);
    stroke(contour(grid, cols, rows, cell, n / 10));
  }
  ctx.setLineDash([]);
  const sigma = Math.max(60, Math.min(140, (w + h) * 0.032));
  ctx.font = monoFont(10);
  ctx.textBaseline = "middle";
  for (const p of peaks) {
    const x = p.x * w;
    const y = p.y * h;
    const on = p.id === hover;
    if (on) {
      // the hovered market's own rings, lifted out in the accent
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, sigma * 2.4, 0, TAU);
      ctx.clip();
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.65;
      ctx.lineWidth = 1.3;
      for (let n = 1; n <= 13; n++) stroke(contour(grid, cols, rows, cell, (Math.sign(p.z) * n) / 10));
      ctx.restore();
    }
    ctx.globalAlpha = on ? 1 : 0.5;
    ctx.strokeStyle = ctx.fillStyle = on ? accent : ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 4, y);
    ctx.lineTo(x + 4, y);
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x, y + 4);
    ctx.stroke();
    ctx.fillText(p.label, x + 7, y);
  }
  ctx.globalAlpha = 1;
}

// ───────────────────────── Sea Wall: the water line ─────────────────────────

/** Water height as a share of the band: 100% coverage fills the lowest fifth, under the copy; overfunding rises a little above it. */
export function waterLevel(coverPct: number) {
  return 0.04 + (0.16 * Math.max(0, Math.min(coverPct, 115))) / 100;
}

/** Water filling the band to the reserve coverage, with a staff gauge and the fully-backed mark. */
export function seaWallScene(ctx: CanvasRenderingContext2D, cover: () => number | undefined) {
  let level = 0;
  return ({ w, h, t, dt }: Frame) => {
    ctx.clearRect(0, 0, w, h);
    const c = cover();
    if (c === undefined) return;
    const target = waterLevel(c);
    level = dt === 0 ? target : level + (target - level) * Math.min(1, dt * 1.2);
    const y0 = h * (1 - level);
    const surf = (x: number, lag: number) => y0 + 7 * Math.sin(x * 0.011 + t * 1.1 + lag) + 3 * Math.sin(x * 0.029 - t * 1.6 + lag * 2);

    const body = ctx.createLinearGradient(0, y0 - 10, 0, h);
    body.addColorStop(0, "rgba(7, 12, 72, 0.18)");
    body.addColorStop(1, "rgba(7, 12, 72, 0.42)");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w + 8; x += 8) ctx.lineTo(x, surf(x, 0));
    ctx.lineTo(w, h);
    ctx.fill();
    for (const [lag, alpha] of [[1.9, 0.22], [0, 0.6]] as const) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.lineWidth = lag ? 1 : 1.5;
      ctx.beginPath();
      for (let x = 0; x <= w + 8; x += 8) ctx[x ? "lineTo" : "moveTo"](x, surf(x, lag) + (lag ? 9 : 0));
      ctx.stroke();
    }

    // staff gauge on the right edge, 0 to 110%
    const staff = w - 18;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let p = 0; p <= 110; p += 5) {
      const y = h * (1 - waterLevel(p));
      ctx.moveTo(staff - (p % 50 === 0 ? 12 : p % 10 === 0 ? 8 : 4), y);
      ctx.lineTo(staff, y);
    }
    ctx.moveTo(staff, h * (1 - waterLevel(110)));
    ctx.lineTo(staff, h);
    ctx.stroke();

    const full = h * (1 - waterLevel(100));
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.beginPath();
    ctx.moveTo(0, full);
    ctx.lineTo(staff - 16, full);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = monoFont(11);
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.fillText(`100% · fully backed · water at ${c.toFixed(2)}%`, staff - 20, full - 6);
    ctx.textAlign = "left";
  };
}

// ───────────────────────── $OMNITIDE: a star chart of the chains ─────────────────────────

export type Star = { key: string; label?: string; x: number; y: number };
export type Pulse = { from: number; to: number; at: number; strong: boolean };

/** Background stars, the chains as bright stars joined by their LayerZero lanes; pulses sail the lanes, strong ones for real messages. */
export function starScene(ctx: CanvasRenderingContext2D, stars: Star[], lanes: [number, number][], drain: () => [number, number][]) {
  const rand = rng(5);
  const field = Array.from({ length: 240 }, () => ({ x: rand(), y: rand(), s: rand() < 0.1 ? 1.6 : 0.6 + rand() * 0.7, ph: rand() * TAU, f: 0.6 + rand() * 1.8 }));
  const glow = glowSprite("rgba(201, 211, 255, 1)");
  const pulses: Pulse[] = [];
  const flare = stars.map(() => 0);
  let next = 1.2;
  const DUR = 2.4;
  const at = (s: Star, w: number, h: number) => [s.x * w, s.y * h] as const;
  // lanes bow upward a little, like a great-circle course on a chart
  const course = (a: readonly [number, number], b: readonly [number, number], u: number) => {
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2 - Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.12;
    const v = 1 - u;
    return [v * v * a[0] + 2 * v * u * mx + u * u * b[0], v * v * a[1] + 2 * v * u * my + u * u * b[1]] as const;
  };
  return ({ w, h, t, dt, pointer }: Frame) => {
    ctx.clearRect(0, 0, w, h);
    for (const [from, to] of drain()) pulses.push({ from, to, at: t, strong: true });
    if (dt > 0 && t > next && lanes.length) {
      const [a, b] = lanes[Math.floor(Math.random() * lanes.length)]!;
      pulses.push(Math.random() < 0.5 ? { from: a, to: b, at: t, strong: false } : { from: b, to: a, at: t, strong: false });
      next = t + 3 + Math.random() * 3.5;
    }

    for (const s of field) {
      const x = s.x * w;
      const y = s.y * h;
      const near = pointer.on ? Math.max(0, 1 - Math.hypot(x - pointer.x, y - pointer.y) / 140) : 0;
      ctx.globalAlpha = Math.min(1, 0.25 + 0.3 * Math.sin(t * s.f + s.ph) ** 2 + near * 0.7);
      ctx.fillStyle = "#e8ecff";
      ctx.fillRect(x, y, s.s + near, s.s + near);
    }

    ctx.lineWidth = 1;
    ctx.setLineDash([2, 5]);
    ctx.strokeStyle = "rgba(201, 211, 255, 0.3)";
    ctx.globalAlpha = 1;
    ctx.beginPath();
    for (const [a, b] of lanes) {
      const pa = at(stars[a]!, w, h);
      const pb = at(stars[b]!, w, h);
      for (let k = 0; k <= 32; k++) ctx[k ? "lineTo" : "moveTo"](...course(pa, pb, k / 32));
    }
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalCompositeOperation = "lighter";
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i]!;
      const u = (t - p.at) / DUR;
      if (u >= 1) {
        flare[p.to] = Math.max(flare[p.to]!, p.strong ? 1 : 0.45);
        pulses.splice(i, 1);
        continue;
      }
      const pa = at(stars[p.from]!, w, h);
      const pb = at(stars[p.to]!, w, h);
      const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
      for (let k = 0; k < 8; k++) {
        const [x, y] = course(pa, pb, Math.max(0, e - k * 0.012));
        const r = (p.strong ? 14 : 9) * (1 - k / 8);
        ctx.globalAlpha = (p.strong ? 0.9 : 0.5) * (1 - k / 8);
        ctx.drawImage(glow, x - r, y - r, r * 2, r * 2);
      }
    }
    ctx.font = monoFont(11);
    ctx.textBaseline = "middle";
    for (const [i, s] of stars.entries()) {
      const [x, y] = at(s, w, h);
      flare[i] = flare[i]! * Math.pow(0.25, dt);
      const r = 16 + flare[i]! * 26 + Math.sin(t * 1.3 + i) * 2;
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.55 + flare[i]! * 0.45;
      ctx.drawImage(glow, x - r, y - r, r * 2, r * 2);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(x - 7, y);
      ctx.lineTo(x + 7, y);
      ctx.moveTo(x, y - 7);
      ctx.lineTo(x, y + 7);
      ctx.stroke();
      if (!s.label) continue;
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(s.label, x + 14, y + 1);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  };
}
