import type { ChainKey } from "@omnitide/contracts/chains";
import type { SeaWall } from "./hooks";

export type Session = "open" | "pre" | "after" | "closed";

/** US equities session in New York time. shortcut: ignores exchange holidays and half days, fine for a badge; use an exchange calendar if it ever gates trading. */
export function usSession(now = new Date()): Session {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  if (p.weekday === "Sat" || p.weekday === "Sun") return "closed";
  const m = Number(p.hour) * 60 + Number(p.minute);
  if (m >= 570 && m < 960) return "open";
  if (m >= 240 && m < 570) return "pre";
  if (m >= 960 && m < 1200) return "after";
  return "closed";
}

export const SESSION_LABEL: Record<Session, string> = { open: "NYSE open", pre: "Pre-market", after: "After hours", closed: "NYSE closed" };

/** Sparkline geometry on a w×h box with a 2px inset; a flat series sits on the midline. */
export function sparkGeometry(v: number[], w: number, h: number) {
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const xy = v.map((y, i) => [(i / Math.max(1, v.length - 1)) * w, 2 + (1 - (hi === lo ? 0.5 : (y - lo) / (hi - lo))) * (h - 4)] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  return { xy, line, area: `${line}L${w},${h}L0,${h}Z` };
}

export interface LaneRow {
  from: ChainKey;
  to: ChainKey;
  limit: number;
  available: number;
  window: number;
  confirmations: number;
  dvns: number;
  paused: boolean;
}

/** Every directed LayerZero lane the Sea Wall reads, in tdUSD. */
export const laneRows = (w: SeaWall | undefined): LaneRow[] =>
  w?.chains.flatMap((c) =>
    c.lanes.map((l) => ({
      from: c.chain as ChainKey,
      to: l.to as ChainKey,
      limit: Number(l.limit) / 1e6,
      available: Number(l.available) / 1e6,
      window: l.window,
      confirmations: l.confirmations,
      dvns: l.dvns,
      paused: c.paused,
    })),
  ) ?? [];

/** Rate-limit window in words: 86400 → "24h", 3600 → "1h", 600 → "10m". */
export const windowLabel = (s: number) => (s >= 3600 ? `${Math.round(s / 3600)}h` : `${Math.max(1, Math.round(s / 60))}m`);

/** An eased fade from one colour to the next, mixed in oklab so the middle stays sea-blue instead of going grey; evenly spaced stops so the header haze can read it back. */
export function tideGradient(from: string, to: string, steps = 8) {
  const stops = Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    return `color-mix(in oklab, ${to} ${+(t * t * (3 - 2 * t) * 100).toFixed(2)}%, ${from})`;
  });
  return `linear-gradient(to bottom, ${stops.join(", ")})`;
}
