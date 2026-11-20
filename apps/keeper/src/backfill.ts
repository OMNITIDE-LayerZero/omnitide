import type { PrismaClient } from "@omnitide/db";
import type { MarketConfig } from "@omnitide/contracts/markets";
import { bucketStart, INTERVALS } from "./candles.js";
import { NASDAQ_CLASS } from "./prices.js";

interface Bar {
  start: number; // ms UTC
  open: number;
  high: number;
  low: number;
  close: number;
}

const UA = { "User-Agent": "Mozilla/5.0 (OMNITIDE keeper)", Accept: "application/json" };

/** Offset of New York from UTC at `utcMs`, e.g. -5h in winter, -4h in summer. */
export function newYorkOffsetMs(utcMs: number): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "shortOffset" })
    .formatToParts(new Date(utcMs))
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const [, sign, h, m] = /GMT([+-])(\d+)(?::(\d+))?/.exec(name) ?? [, "-", "5", "0"];
  return (sign === "-" ? -1 : 1) * (Number(h) * 60 + Number(m ?? 0)) * 60_000;
}

/** Nasdaq chart `x` is New York wall-clock time written as if it were UTC. */
export function nasdaqPointToUtc(x: number): number {
  return x - newYorkOffsetMs(x);
}

/** Groups finer bars into `intervalSec` buckets. Input must be sorted by start. */
export function aggregate(bars: Bar[], intervalSec: number): Bar[] {
  const out = new Map<number, Bar>();
  for (const b of bars) {
    const start = bucketStart(b.start, intervalSec).getTime();
    const cur = out.get(start);
    if (!cur) out.set(start, { ...b, start });
    else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
    }
  }
  return [...out.values()];
}

async function coinbaseBars(m: MarketConfig, intervalSec: number): Promise<Bar[]> {
  const res = await fetch(`https://api.exchange.coinbase.com/products/${m.feed}/candles?granularity=${intervalSec}`, { headers: UA, signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`coinbase candles ${res.status}`);
  const rows = (await res.json()) as [number, number, number, number, number, number][];
  return rows.map(([t, low, high, open, close]) => ({ start: t * 1000, open, high, low, close })).sort((a, b) => a.start - b.start);
}

async function nasdaqMinuteBars(m: MarketConfig): Promise<Bar[]> {
  const cls = NASDAQ_CLASS[m.symbol] ?? "stocks";
  const res = await fetch(`https://api.nasdaq.com/api/quote/${m.symbol}/chart?assetclass=${cls}`, { headers: UA, signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`nasdaq chart ${res.status}`);
  const body = (await res.json()) as { data?: { chart?: { x: number; y: number }[] } };
  const points = (body.data?.chart ?? []).map((p) => ({ start: nasdaqPointToUtc(p.x), open: p.y, high: p.y, low: p.y, close: p.y }));
  return aggregate(points.sort((a, b) => a.start - b.start), 60);
}

async function insertBars(db: PrismaClient, feed: string, interval: number, bars: Bar[]) {
  for (const b of bars) {
    // never overwrite candles the live loop already built
    await db.$executeRaw`
      INSERT INTO "Candle" ("feed","interval","start","open","high","low","close","ticks")
      VALUES (${feed}, ${interval}, ${new Date(b.start)}, ${b.open}::numeric, ${b.high}::numeric, ${b.low}::numeric, ${b.close}::numeric, 0)
      ON CONFLICT DO NOTHING`;
  }
}

/** Seeds history so charts have depth from the first visit. */
export async function backfill(db: PrismaClient, markets: MarketConfig[], log: (m: string) => void) {
  for (const m of markets) {
    try {
      if (m.kind === "crypto") {
        for (const interval of INTERVALS) await insertBars(db, m.feed, interval, await coinbaseBars(m, interval));
      } else {
        const minutes = await nasdaqMinuteBars(m);
        for (const interval of INTERVALS) await insertBars(db, m.feed, interval, interval === 60 ? minutes : aggregate(minutes, interval));
      }
    } catch (e) {
      log(`backfill ${m.feed}: ${(e as Error).message}`);
    }
  }
  log("backfill done");
}
