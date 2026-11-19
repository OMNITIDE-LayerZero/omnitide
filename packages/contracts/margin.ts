import { MARKETS } from "@omnitide/contracts/markets";

export interface Pos {
  marketId: number;
  size: number; // base units, signed
  entry: number; // USD
}

/** Mirrors OmnitideClearinghouse._accountMargin with display numbers. */
export function accountHealth(collateral: number, positions: Pos[], prices: Record<string, number>) {
  let equity = collateral;
  let im = 0;
  let mm = 0;
  let notional = 0;
  for (const p of positions) {
    const m = MARKETS[p.marketId];
    const px = m ? prices[m.feed] : undefined;
    if (!m || px === undefined) continue;
    equity += p.size * (px - p.entry);
    const n = Math.abs(p.size) * px;
    notional += n;
    im += (n * m.initialMarginBps) / 10_000;
    mm += (n * m.maintenanceMarginBps) / 10_000;
  }
  // 1 = untouched, 0 = at the sea wall (maintenance margin)
  const level = notional === 0 ? 1 : Math.max(0, Math.min(1, (equity - mm) / Math.max(equity, 1e-9)));
  return { equity, im, mm, notional, free: equity - im, level, leverage: equity > 0 ? notional / equity : 0 };
}

/** Price where this single position alone hits maintenance margin, given the account's other equity. */
export function liquidationPrice(side: 1 | -1, size: number, entry: number, equity: number, mmBps: number): number | null {
  // equity + side*size*(P-entry) = |size|*P*mm  →  solve for P
  const s = side * Math.abs(size);
  const k = Math.abs(size) * (mmBps / 10_000);
  const denom = s - k;
  if (denom === 0) return null;
  const p = (s * entry - equity) / denom;
  return p > 0 ? p : null;
}
