import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { cleanNumber } from "./prices.js";
import { bucketStart } from "./candles.js";
import { oracleDomain, REPORT_TYPES, signReport } from "./reports.js";
import { orderTriggered } from "./executor.js";
import { aggregate, nasdaqPointToUtc } from "./backfill.js";

describe("keeper", () => {
  it("parses venue number formats", () => {
    expect(cleanNumber("$383.9575")).toBe("383.9575");
    expect(cleanNumber("+1.01%")).toBe("1.01");
    expect(cleanNumber("-0.5%")).toBe("-0.5");
    expect(cleanNumber("2,173.05")).toBe("2173.05");
    expect(() => cleanNumber("N/A")).toThrow();
  });

  it("buckets candles on interval boundaries", () => {
    const t = Date.UTC(2026, 10, 18, 14, 7, 31, 500);
    expect(bucketStart(t, 60).toISOString()).toBe("2026-11-18T14:07:00.000Z");
    expect(bucketStart(t, 900).toISOString()).toBe("2026-11-18T14:00:00.000Z");
    expect(bucketStart(t, 3600).toISOString()).toBe("2026-11-18T14:00:00.000Z");
  });

  it("signs reports the oracle can recover", async () => {
    const acct = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
    const domain = oracleDomain(46630, "0x00000000000000000000000000000000000000aa");
    const r = await signReport(acct, domain, "BTC-USD", "63926.17", 1_800_000_000);
    expect(r.price).toBe("63926170000000000000000");
    const signer = await recoverTypedDataAddress({
      domain,
      types: REPORT_TYPES,
      primaryType: "PriceReport",
      message: { feed: r.feed, price: BigInt(r.price), timestamp: BigInt(r.timestamp) },
      signature: r.signature,
    });
    expect(signer).toBe(acct.address);
  });

  it("matches on-chain trigger rules", () => {
    const P = 100n;
    expect(orderTriggered(0, 1n, P, 99n)).toBe(true); // limit buy below
    expect(orderTriggered(0, 1n, P, 101n)).toBe(false);
    expect(orderTriggered(2, -1n, P, 101n)).toBe(true); // take-profit sell above
    expect(orderTriggered(1, -1n, P, 99n)).toBe(true); // stop sell below
    expect(orderTriggered(1, -1n, P, 101n)).toBe(false);
  });

  it("converts Nasdaq wall-clock points and aggregates bars", () => {
    // "4:00 AM ET" on 2026-11-18 (EST, UTC-5) is 09:00 UTC
    expect(new Date(nasdaqPointToUtc(Date.UTC(2026, 10, 18, 4, 0))).toISOString()).toBe("2026-11-18T09:00:00.000Z");
    // July is EDT, UTC-4
    expect(new Date(nasdaqPointToUtc(Date.UTC(2026, 6, 1, 9, 30))).toISOString()).toBe("2026-07-01T13:30:00.000Z");
    const t0 = Date.UTC(2026, 10, 18, 14, 0);
    const bars = [1, 3, 2].map((p, i) => ({ start: t0 + i * 60_000, open: p, high: p, low: p, close: p }));
    expect(aggregate(bars, 900)).toEqual([{ start: t0, open: 1, high: 3, low: 1, close: 2 }]);
  });
});
