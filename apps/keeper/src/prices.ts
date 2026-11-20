import { MARKETS, type MarketConfig } from "@omnitide/contracts/markets";

export interface Quote {
  feed: string;
  price: string; // decimal USD string as quoted by the venue
  change24h: number | null; // percent
  source: "coinbase" | "nasdaq";
  observed: number; // ms
}

const UA = { "User-Agent": "Mozilla/5.0 (OMNITIDE keeper)", Accept: "application/json" };
export const NASDAQ_CLASS: Record<string, string> = { SPY: "etf", FXI: "etf" };

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(6_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/** "$383.9575" / "+1.01%" / "1,234.5" → plain decimal string. */
export function cleanNumber(raw: string): string {
  const s = raw.replace(/[$,%+\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`not a number: ${raw}`);
  return s;
}

export async function coinbaseQuote(m: MarketConfig): Promise<Quote> {
  const stats = (await getJson(`https://api.exchange.coinbase.com/products/${m.feed}/stats`)) as { open: string; last: string };
  const last = cleanNumber(stats.last);
  const open = Number(stats.open);
  return { feed: m.feed, price: last, change24h: open > 0 ? ((Number(last) - open) / open) * 100 : null, source: "coinbase", observed: Date.now() };
}

export async function nasdaqQuote(m: MarketConfig): Promise<Quote> {
  const cls = NASDAQ_CLASS[m.symbol] ?? "stocks";
  const body = (await getJson(`https://api.nasdaq.com/api/quote/${m.symbol}/info?assetclass=${cls}`)) as {
    data?: { primaryData?: { lastSalePrice?: string; percentageChange?: string } };
  };
  const p = body.data?.primaryData;
  if (!p?.lastSalePrice) throw new Error(`nasdaq: no price for ${m.symbol}`);
  return {
    feed: m.feed,
    price: cleanNumber(p.lastSalePrice),
    change24h: p.percentageChange ? Number(cleanNumber(p.percentageChange)) : null,
    source: "nasdaq",
    observed: Date.now(),
  };
}

export function quoteFor(m: MarketConfig) {
  return m.kind === "crypto" ? coinbaseQuote(m) : nasdaqQuote(m);
}

export const FEEDS = MARKETS.map((m) => m.feed);
