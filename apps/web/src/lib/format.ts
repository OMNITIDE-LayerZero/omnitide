const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });

/** Price with precision that suits its size: $63,910 · $1,790.79 · $0.05932. */
export function price(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (p >= 10_000) return usd0.format(p);
  if (p >= 1) return usd2.format(p);
  return `$${p.toPrecision(4)}`;
}

export const money = (v: number) => usd2.format(v);
// under $1K the compact form drops cents ($255.5), so fall back to the full format
export const moneyCompact = (v: number) => (Math.abs(v) < 1000 ? money(v) : compact.format(v));

export function pct(v: number, digits = 2): string {
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}%`;
}

export function signedMoney(v: number): string {
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${usd2.format(Math.abs(v))}`;
}

/** 1e18 fixed point (bigint or decimal string) to a JS number; display only. */
export const wad = (v: bigint | string) => Number(BigInt(v)) / 1e18;
/** tdUSD 1e6 units to a JS number; display only. */
export const units6 = (v: bigint | string) => Number(BigInt(v)) / 1e6;

export const shortHash = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;

export function ago(unixSec: number, now = Date.now()): string {
  const s = Math.max(1, Math.round(now / 1000 - unixSec));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** Max leverage from initial margin: 1000 bps → "10×", 1500 → "6.7×", 2500 → "4×". */
export const leverage = (imBps: number) => `${Number((10_000 / imBps).toFixed(1))}×`;
