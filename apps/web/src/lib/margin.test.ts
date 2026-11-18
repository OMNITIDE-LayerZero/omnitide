import { describe, expect, it } from "vitest";
import { accountHealth, liquidationPrice } from "./margin";
import { price, pct, signedMoney } from "./format";
import { inflowRoute } from "./chains";

describe("margin math", () => {
  it("matches the clearinghouse for a 5x BTC long", () => {
    const h = accountHealth(1000, [{ marketId: 0, size: 0.078125, entry: 64000 }], { "BTC-USD": 64000 });
    expect(h.equity).toBe(1000);
    expect(h.notional).toBe(5000);
    expect(h.im).toBe(500);
    expect(h.mm).toBe(250);
    expect(h.leverage).toBe(5);
  });

  it("finds the liquidation price where equity meets maintenance", () => {
    const p = liquidationPrice(1, 0.078125, 64000, 1000, 500)!;
    const equityAtP = 1000 + 0.078125 * (p - 64000);
    expect(equityAtP).toBeCloseTo(0.078125 * p * 0.05, 6);
    expect(p).toBeLessThan(64000);
  });
});

describe("format", () => {
  it("formats prices by size and signs changes", () => {
    expect(price(63910.68)).toBe("$63,911");
    expect(price(1790.79)).toBe("$1,790.79");
    expect(price(0.05932)).toBe("$0.05932");
    expect(pct(1.234)).toBe("+1.23%");
    expect(pct(-0.5)).toBe("−0.50%");
    expect(signedMoney(-12.5)).toBe("−$12.50");
  });
});

describe("routes", () => {
  it("routes Monad and Arc through Sepolia, Fuji direct", () => {
    expect(inflowRoute("fuji")).toEqual(["robinhoodTestnet"]);
    expect(inflowRoute("monadTestnet")).toEqual(["sepolia", "robinhoodTestnet"]);
    expect(inflowRoute("arcTestnet")).toEqual(["sepolia", "robinhoodTestnet"]);
  });
});
