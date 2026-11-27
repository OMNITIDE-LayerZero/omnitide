import { describe, expect, it } from "vitest";
import { anchorHold, borrowApr, borrowRoom, liquidationPrice, supplyApr } from "./lending";

// the launch model: 0% at idle, 4% at the 80% kink, 60% when fully lent
const M = { baseRate: 0, kinkRate: 0.04, maxRate: 0.6, kink: 0.8 };

describe("lending math", () => {
  it("matches the contract's kinked rate curve", () => {
    expect(borrowApr(M, 0)).toBe(0);
    expect(borrowApr(M, 0.4)).toBeCloseTo(0.02);
    expect(borrowApr(M, 0.8)).toBeCloseTo(0.04);
    expect(borrowApr(M, 0.9)).toBeCloseTo(0.32);
    expect(borrowApr(M, 1)).toBeCloseTo(0.6);
    expect(borrowApr(M, 3)).toBeCloseTo(0.6);
    expect(supplyApr(M, 0.8, 0.1)).toBeCloseTo(0.04 * 0.8 * 0.9);
  });

  it("finds the liquidation price, the gauge level and the room left", () => {
    // 1 ETH, $1,400 owed: liquidated when 80% of the ETH is worth $1,400 → $1,750
    expect(liquidationPrice(1400, 1, 0.8)).toBeCloseTo(1750);
    expect(liquidationPrice(0, 1, 0.8)).toBeNull();
    expect(anchorHold(0, 2000, 0.8)).toBe(1);
    expect(anchorHold(1400, 2000, 0.8)).toBeCloseTo(0.125);
    expect(anchorHold(1700, 2000, 0.8)).toBe(0);
    expect(borrowRoom(1, 2000, 0.7, 1000)).toBeCloseTo(400);
    expect(borrowRoom(1, 2000, 0.7, 1500)).toBe(0);
  });
});
