import { MARKETS, type MarketConfig } from "@omnitide/contracts/markets";
import { accountHealth, liquidationPrice, type Pos } from "@omnitide/contracts/margin";

// ───────── Tidal Lens: stress scenarios ─────────

export interface Scenario {
  id: string;
  name: string;
  blurb: string;
  shock: (m: MarketConfig) => number; // fractional price move, −0.2 = −20%
}

const TECH = new Set(["NVDA", "AAPL", "TSLA"]);
const CRYPTO_EQUITY = new Set(["COIN", "HOOD"]);

export const SCENARIOS: Scenario[] = [
  { id: "flash", name: "Flash crash", blurb: "Crypto gaps −20% inside a minute while US equities slip −5%.", shock: (m) => (m.kind === "crypto" ? -0.2 : -0.05) },
  {
    id: "rotation",
    name: "Tech rotation",
    blurb: "Megacap tech bleeds −12%, COIN and HOOD −15%, SPY −4%, while bitcoin catches a +3% bid.",
    shock: (m) => (TECH.has(m.symbol) ? -0.12 : CRYPTO_EQUITY.has(m.symbol) ? -0.15 : m.symbol === "SPY" ? -0.04 : m.kind === "crypto" ? 0.03 : 0),
  },
  { id: "swan", name: "Black swan", blurb: "Correlations go to one: crypto −40%, every stock −15%.", shock: (m) => (m.kind === "crypto" ? -0.4 : -0.15) },
  { id: "squeeze", name: "Short squeeze", blurb: "Shorts get run over: crypto +25%, stocks +8%.", shock: (m) => (m.kind === "crypto" ? 0.25 : 0.08) },
];

export const shocked = (prices: Record<string, number>, s: Scenario) =>
  Object.fromEntries(MARKETS.flatMap((m) => (prices[m.feed] !== undefined ? [[m.feed, prices[m.feed]! * (1 + s.shock(m))]] : [])));

/** One account under a scenario: equity, maintenance and whether the clearinghouse could liquidate it. */
export function stressAccount(collateral: number, positions: Pos[], prices: Record<string, number>, s: Scenario) {
  const now = accountHealth(collateral, positions, prices);
  const after = accountHealth(collateral, positions, shocked(prices, s));
  return { before: now, after, pnl: after.equity - now.equity, liquidated: positions.length > 0 && after.equity < after.mm };
}

/** Whole-book view: traders' PnL under the scenario; the Tide Pool (Harbor) is the other side of it. */
export function stressBook(book: Pos[], prices: Record<string, number>, s: Scenario) {
  const p2 = shocked(prices, s);
  let traders = 0;
  let notional = 0;
  for (const p of book) {
    const m = MARKETS[p.marketId];
    const a = m && prices[m.feed];
    const b = m && p2[m.feed];
    if (!a || !b) continue;
    traders += p.size * (b - a);
    notional += Math.abs(p.size) * a;
  }
  return { tradersPnl: traders, poolPnl: -traders, notional };
}

// ───────── RADAR and Book Rank ─────────

export interface Radar {
  leverage: number;
  concentration: number;
  direction: number;
  cluster: number;
  gap: number;
  proximity: number;
}

export const RADAR_AXES: { key: keyof Radar; label: string; hint: string }[] = [
  { key: "proximity", label: "Wall distance", hint: "How close equity is to maintenance margin" },
  { key: "leverage", label: "Leverage", hint: "Notional over equity, 10× reads as full" },
  { key: "concentration", label: "Concentration", hint: "Herfindahl index of position notional" },
  { key: "direction", label: "One-way bet", hint: "Net exposure over gross exposure" },
  { key: "cluster", label: "Asset cluster", hint: "Share of notional in a single asset class" },
  { key: "gap", label: "Gap risk", hint: "Share of notional in stocks that can gap at the open" },
];

/** Six risk dials, each 0 (calm water) to 1 (rip current). */
export function radar(collateral: number, positions: Pos[], prices: Record<string, number>): Radar {
  const h = accountHealth(collateral, positions, prices);
  const legs = positions.flatMap((p) => {
    const m = MARKETS[p.marketId];
    const px = m && prices[m.feed];
    return m && px ? [{ n: Math.abs(p.size) * px, signed: p.size * px, kind: m.kind }] : [];
  });
  const gross = legs.reduce((a, l) => a + l.n, 0);
  if (gross === 0) return { leverage: 0, concentration: 0, direction: 0, cluster: 0, gap: 0, proximity: 0 };
  const share = (k: "crypto" | "stock") => legs.filter((l) => l.kind === k).reduce((a, l) => a + l.n, 0) / gross;
  return {
    leverage: Math.min(1, h.leverage / 10),
    concentration: legs.reduce((a, l) => a + (l.n / gross) ** 2, 0),
    direction: Math.abs(legs.reduce((a, l) => a + l.signed, 0)) / gross,
    cluster: Math.max(share("crypto"), share("stock")),
    gap: share("stock"),
    proximity: 1 - h.level,
  };
}

const WEIGHTS: Radar = { proximity: 0.35, leverage: 0.25, concentration: 0.15, direction: 0.1, cluster: 0.1, gap: 0.05 };

/** Book Rank: 0–100 score and an A–D grade; surviving every Tidal Lens scenario is required for A. */
export function bookRank(r: Radar, survives: boolean[]) {
  const raw = 100 - (Object.keys(WEIGHTS) as (keyof Radar)[]).reduce((a, k) => a + WEIGHTS[k] * r[k] * 100, 0);
  const failures = survives.filter((s) => !s).length;
  const score = Math.max(0, Math.round(raw - failures * 12));
  const grade = score >= 80 && failures === 0 ? "A" : score >= 60 ? "B" : score >= 40 ? "C" : "D";
  return { score, grade, failures };
}

// ───────── Margin simulator: shared (cross) vs isolated ─────────

export interface SimLeg {
  marketId: number;
  side: 1 | -1;
  notional: number; // USD at the current mark
}

/** Same collateral, same legs: one shared pool vs per-leg isolated margin sized by initial margin. */
export function simulateMargin(collateral: number, legs: SimLeg[], prices: Record<string, number>, s?: Scenario) {
  const positions = legs.flatMap((l) => {
    const m = MARKETS[l.marketId];
    const px = m && prices[m.feed];
    return m && px ? [{ leg: l, m, pos: { marketId: l.marketId, size: (l.side * l.notional) / px, entry: px } }] : [];
  });
  const after = s ? shocked(prices, s) : prices;
  const pos = positions.map((p) => p.pos);
  const shared = accountHealth(collateral, pos, after);
  const sharedLiquidated = pos.length > 0 && shared.equity < shared.mm;
  const totalIm = positions.reduce((a, p) => a + (p.leg.notional * p.m.initialMarginBps) / 10_000, 0);

  const isolated = positions.map((p) => {
    const alloc = totalIm > 0 ? (collateral * (p.leg.notional * p.m.initialMarginBps)) / 10_000 / totalIm : 0;
    const h = accountHealth(alloc, [p.pos], after);
    return {
      marketId: p.leg.marketId,
      alloc,
      equity: h.equity,
      liquidated: h.equity < h.mm,
      liqPrice: liquidationPrice(p.leg.side, p.pos.size, p.pos.entry, alloc, p.m.maintenanceMarginBps),
    };
  });
  const sharedLiq = positions.map((p) => liquidationPrice(p.leg.side, p.pos.size, p.pos.entry, collateral, p.m.maintenanceMarginBps));
  return {
    shared: { equity: shared.equity, mm: shared.mm, liquidated: sharedLiquidated, kept: sharedLiquidated ? 0 : shared.equity, liqPrices: sharedLiq },
    isolated: { legs: isolated, kept: isolated.reduce((a, l) => a + (l.liquidated ? 0 : l.equity), 0), liquidated: isolated.filter((l) => l.liquidated).length },
  };
}
