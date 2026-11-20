import { describe, expect, it } from "vitest";
import { SCENARIOS, bookRank, radar, simulateMargin, stressAccount, stressBook } from "./risk";

const px = { "BTC-USD": 60_000, "ETH-USD": 3_000, NVDA: 100, SPY: 500 };
const flash = SCENARIOS.find((s) => s.id === "flash")!;
const swan = SCENARIOS.find((s) => s.id === "swan")!;

describe("Tidal Lens", () => {
  it("applies the flash crash to a 5x BTC long and flags the liquidation", () => {
    const pos = [{ marketId: 0, size: 5_000 / 60_000, entry: 60_000 }];
    const r = stressAccount(1_000, pos, px, flash);
    expect(r.pnl).toBeCloseTo(-1_000, 6); // −20% on $5k notional
    expect(r.liquidated).toBe(true);
    expect(stressAccount(1_000, [{ marketId: 0, size: 1_000 / 60_000, entry: 60_000 }], px, flash).liquidated).toBe(false);
  });

  it("gaps China ADRs on the Hang Seng scenario and barely touches the rest", () => {
    const hk = SCENARIOS.find((s) => s.id === "hangseng")!;
    const pos = [
      { marketId: 12, size: 100, entry: 80 }, // BABA long $8k
      { marketId: 7, size: 20, entry: 100 }, // NVDA long $2k
    ];
    const r = stressAccount(5_000, pos, { ...px, BABA: 80 }, hk);
    expect(r.pnl).toBeCloseTo(-8_000 * 0.15 - 2_000 * 0.02, 6);
  });

  it("puts the Tide Pool on the other side of the whole book", () => {
    const book = [
      { marketId: 0, size: 1, entry: 60_000 },
      { marketId: 1, size: -10, entry: 3_000 },
    ];
    const r = stressBook(book, px, swan);
    // long 1 BTC loses 24k, short 10 ETH gains 12k
    expect(r.tradersPnl).toBeCloseTo(-12_000, 6);
    expect(r.poolPnl).toBeCloseTo(12_000, 6);
  });
});

describe("RADAR and Book Rank", () => {
  it("reads a single leveraged long as concentrated and one-way", () => {
    const r = radar(1_000, [{ marketId: 0, size: 8_000 / 60_000, entry: 60_000 }], px);
    expect(r.concentration).toBe(1);
    expect(r.direction).toBe(1);
    expect(r.leverage).toBeCloseTo(0.8, 6);
    expect(r.gap).toBe(0);
  });

  it("rewards a hedged, low-leverage book and punishes failed scenarios", () => {
    const calm = radar(10_000, [
      { marketId: 0, size: 1_000 / 60_000, entry: 60_000 },
      { marketId: 11, size: -2, entry: 500 },
    ], px);
    expect(bookRank(calm, [true, true, true, true]).grade).toBe("A");
    const hot = radar(1_000, [{ marketId: 0, size: 9_000 / 60_000, entry: 60_000 }], px);
    const r = bookRank(hot, [false, true, false, true]);
    expect(["C", "D"]).toContain(r.grade);
    expect(r.failures).toBe(2);
  });
});

describe("margin simulator", () => {
  it("isolated margin keeps the healthy leg when one leg blows up", () => {
    const legs = [
      { marketId: 0, side: 1 as const, notional: 4_000 },
      { marketId: 11, side: 1 as const, notional: 2_000 },
    ];
    const r = simulateMargin(1_000, legs, px, swan);
    expect(r.shared.liquidated).toBe(true);
    expect(r.shared.kept).toBe(0);
    expect(r.isolated.legs.find((l) => l.marketId === 0)!.liquidated).toBe(true);
    expect(r.isolated.legs.reduce((a, l) => a + l.alloc, 0)).toBeCloseTo(1_000, 6);
  });
});

import { csv, pnlReport } from "./report";
describe("PnL report", () => {
  it("sums realized PnL and fees, and quotes CSV cells safely", () => {
    const r = pnlReport([{ realizedPnl: "1500000", fee: "250000" }, { realizedPnl: "-500000", fee: "250000" }], [{ kind: "inflow", amount: "100000000" }, { kind: "ebb", amount: "40000000" }]);
    expect(r).toEqual({ realized: 1, fees: 0.5, fills: 2, deposited: 100, withdrawn: 40 });
    expect(csv(["a", "b"], [["x,y", 'q"t']])).toBe('a,b\n"x,y","q""t"\n');
  });
});
