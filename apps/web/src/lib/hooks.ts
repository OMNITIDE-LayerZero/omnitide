"use client";

import { useQuery } from "@tanstack/react-query";
import { MARKETS } from "@omnitide/contracts/markets";

export interface Price {
  feed: string;
  price: number;
  change24h: number | null;
  source: string;
  observed: number;
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return (await res.json()) as T;
}

export function usePrices() {
  return useQuery({
    queryKey: ["prices"],
    queryFn: () => get<{ prices: Price[] }>("/api/prices"),
    refetchInterval: 3_000,
    select: (d) => Object.fromEntries(d.prices.map((p) => [p.feed, p])) as Record<string, Price>,
  });
}

/** Feed → last price, for margin math. */
export function usePriceMap() {
  const { data } = usePrices();
  return Object.fromEntries(Object.values(data ?? {}).map((p) => [p.feed, p.price])) as Record<string, number>;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export function useCandles(feed: string, interval: 60 | 900 | 3600) {
  return useQuery({
    queryKey: ["candles", feed, interval],
    queryFn: () => get<{ candles: Candle[] }>(`/api/candles?feed=${encodeURIComponent(feed)}&interval=${interval}&limit=400`),
    refetchInterval: interval === 60 ? 15_000 : 60_000,
    select: (d) => d.candles,
  });
}

export interface IndexerStats {
  global: { trades: number; volumeUsd: string; feesPaid: string; inflows: number; ebbs: number; bridged: string; drips: number; liquidations: number } | null;
  markets: { id: number; feed: string; volumeUsd: string; trades: number; maxOpenInterestUsd: string; active: boolean }[];
}

export function useStats() {
  return useQuery({ queryKey: ["stats"], queryFn: () => get<IndexerStats>("/api/indexer/stats"), refetchInterval: 15_000 });
}

export function useIndexer<T>(path: "trades" | "positions" | "orders" | "flows" | "bridge" | "leaderboard" | "harbor" | "tide" | "book" | "sealed" | "lighthouse" | "vaults" | "deep", account?: string, enabled = true) {
  const qs = account ? `?account=${account}` : "";
  return useQuery({
    queryKey: ["indexer", path, account ?? ""],
    queryFn: () => get<T>(`/api/indexer/${path}${qs}`),
    refetchInterval: 6_000,
    enabled,
  });
}

export interface SeaWall {
  at: number;
  reserves: { held: string; collateral: string; pool: string; depositCap: string; paused: boolean };
  chains: { chain: string; chainId: number; eid: number; supply: string; paused: boolean; lanes: { to: string; limit: string; window: number; available: string; confirmations: number; dvns: number }[] }[];
}

export function useSeaWall() {
  return useQuery({ queryKey: ["seawall"], queryFn: () => get<SeaWall>("/api/seawall"), refetchInterval: 30_000 });
}

/** 0..1 swell from how far the crypto majors moved over 24h. */
export function useSwell() {
  const { data } = usePrices();
  const moves = MARKETS.filter((m) => m.kind === "crypto")
    .map((m) => data?.[m.feed]?.change24h)
    .filter((v): v is number => typeof v === "number");
  if (moves.length === 0) return 0.45;
  const avg = moves.reduce((a, b) => a + Math.abs(b), 0) / moves.length;
  return Math.min(1, avg / 6);
}
