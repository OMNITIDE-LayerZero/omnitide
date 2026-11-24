import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import webpush from "web-push";
import { riptideMessage } from "@omnitide/contracts/riptide";
import { createCurrent } from "./current.js";
import { loadEnv } from "./env.js";
import { cleanNumber } from "./prices.js";
import { bucketStart } from "./candles.js";
import { oracleDomain, REPORT_TYPES, signReport } from "./reports.js";
import { needsMark, orderTriggered, traderPnlUnits } from "./executor.js";
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

describe("Riptide Alerts subscriptions", () => {
  const signer = privateKeyToAccount(generatePrivateKey());
  const upserts: unknown[] = [];
  const db = { alertSubscription: { upsert: async (x: unknown) => upserts.push(x), deleteMany: async () => ({}) } };
  const vapid = webpush.generateVAPIDKeys();
  const current = createCurrent({
    env: loadEnv({ DATABASE_URL: "postgresql://x@localhost/x", KEEPER_PRIVATE_KEY: `0x${"1".repeat(64)}`, HUB_RPC_URL: "http://localhost", VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey }),
    db: db as never,
    hub: {} as never,
    clearinghouse: "0x0000000000000000000000000000000000000001",
    harbor: "0x0000000000000000000000000000000000000002",
    prices: () => ({}),
    log: () => {},
  });
  const base = { action: "subscribe" as const, account: signer.address, channel: "push" as const, threshold: 0.3, deliverTo: "this browser" };
  const target = { endpoint: "https://push.example/abc", keys: { p256dh: "k", auth: "a" } };

  it("stores a subscription signed by the account owner", async () => {
    const req = { ...base, issuedAt: new Date().toISOString() };
    const r = await current.handleRequest({ ...req, target, signature: await signer.signMessage({ message: riptideMessage(req) }) });
    expect(r.status).toBe(200);
    expect(upserts).toHaveLength(1);
  });

  it("rejects stale, foreign and channel-mismatched requests", async () => {
    const stale = { ...base, issuedAt: new Date(Date.now() - 11 * 60_000).toISOString() };
    expect((await current.handleRequest({ ...stale, target, signature: await signer.signMessage({ message: riptideMessage(stale) }) })).status).toBe(400);
    const other = privateKeyToAccount(generatePrivateKey());
    const req = { ...base, issuedAt: new Date().toISOString() };
    expect((await current.handleRequest({ ...req, target, signature: await other.signMessage({ message: riptideMessage(req) }) })).status).toBe(401);
    expect((await current.handleRequest({ ...req, target: { email: "a@b.co" }, signature: await signer.signMessage({ message: riptideMessage(req) }) })).status).toBe(400);
    const email = { ...req, channel: "email" as const };
    expect((await current.handleRequest({ ...email, target: { email: "a@b.co" }, signature: await signer.signMessage({ message: riptideMessage(email) }) })).status).toBe(400); // email channel off
  });
});

describe("Harbor marks", () => {
  const E18 = 10n ** 18n;
  it("prices open trader PnL like the clearinghouse and re-marks only on real drift", () => {
    // 0.1 BTC long at 60k, 0.05 short at 60k → net 0.05, basis 0.05·60k
    const legs = [{ net: E18 / 20n, costBasis: (E18 / 10n) * 60_000n * E18 - (E18 / 20n) * 60_000n * E18, price: 63_000n * E18 }];
    expect(traderPnlUnits(legs)).toBe(150_000_000n);
    expect(needsMark(150_000_000n, 0n, 2_000_000_000n)).toBe(true);
    expect(needsMark(150_000_000n, 140_000_000n, 2_000_000_000n)).toBe(false); // within 1% of the pool
    expect(needsMark(5_000n, 0n, 0n)).toBe(false); // under the 0.01 floor
  });
});
