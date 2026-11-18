"use client";

import { useEffect, useRef } from "react";
import { CandlestickSeries, ColorType, createChart, LineStyle, type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useCandles, usePrices } from "@/lib/hooks";
import { useTheme } from "../theme";

export interface ChartLine {
  price: number;
  label: string;
  tone: "accent" | "ebb" | "flood" | "muted";
}

function css(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Candles from the keeper's Postgres history, the last bar kept live from the price feed. */
export function PriceChart({ feed, interval, lines = [] }: { feed: string; interval: 60 | 900 | 3600; lines?: ChartLine[] }) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLines = useRef<IPriceLine[]>([]);
  const last = useRef<{ time: number; open: number; high: number; low: number; close: number } | null>(null);
  const { data: candles } = useCandles(feed, interval);
  const { data: prices } = usePrices();
  const { theme } = useTheme();

  useEffect(() => {
    if (!host.current) return;
    const c = createChart(host.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, fontFamily: "var(--font-geist-mono), monospace", fontSize: 11, attributionLogo: false },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { horzLine: { labelBackgroundColor: "#1f3dff" }, vertLine: { labelBackgroundColor: "#1f3dff" } },
    });
    series.current = c.addSeries(CandlestickSeries, { priceLineVisible: true, lastValueVisible: true });
    chart.current = c;
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
      priceLines.current = [];
    };
  }, []);

  // theme: everything neutral, one flood and one ebb
  useEffect(() => {
    const c = chart.current;
    const s = series.current;
    if (!c || !s) return;
    const text = css("--text-3");
    const line = css("--line");
    const up = css("--flood");
    const down = css("--ebb");
    c.applyOptions({ layout: { textColor: text }, grid: { vertLines: { color: line }, horzLines: { color: line } } });
    s.applyOptions({ upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false });
  }, [theme]);

  useEffect(() => {
    if (!series.current || !candles?.length) return;
    series.current.setData(candles.map((k) => ({ ...k, time: k.time as UTCTimestamp })));
    last.current = { ...candles[candles.length - 1]! };
    // short series (one stock session) fill the width; long ones follow the live edge
    if (candles.length < 120) chart.current?.timeScale().fitContent();
    else chart.current?.timeScale().scrollToRealTime();
  }, [candles]);

  // live last bar from the 3 s price poll
  useEffect(() => {
    const p = prices?.[feed]?.price;
    const s = series.current;
    if (p === undefined || !s || !last.current) return;
    const bucket = Math.floor(Date.now() / 1000 / interval) * interval;
    const bar = bucket > last.current.time ? { time: bucket, open: last.current.close, high: p, low: p, close: p } : { ...last.current, high: Math.max(last.current.high, p), low: Math.min(last.current.low, p), close: p };
    last.current = bar;
    s.update({ ...bar, time: bar.time as UTCTimestamp });
  }, [prices, feed, interval]);

  const linesKey = JSON.stringify(lines);
  useEffect(() => {
    const s = series.current;
    if (!s) return;
    priceLines.current.forEach((l) => s.removePriceLine(l));
    const color = { accent: css("--accent"), ebb: css("--ebb"), flood: css("--flood"), muted: css("--text-3") };
    priceLines.current = lines.map((l) => s.createPriceLine({ price: l.price, color: color[l.tone], lineWidth: 1, lineStyle: l.tone === "muted" ? LineStyle.Dotted : LineStyle.Dashed, axisLabelVisible: true, title: l.label }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linesKey, theme]);

  return <div ref={host} className="h-full min-h-[320px] w-full" />;
}
