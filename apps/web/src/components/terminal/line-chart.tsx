"use client";

import { useEffect, useRef } from "react";
import { AreaSeries, ColorType, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useTheme } from "../theme";

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** One area series over time (equity curve, Harbor share price), themed like the price chart. */
export function LineChart({ points, precision = 2, className = "h-56" }: { points: { time: number; value: number }[]; precision?: number; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Area"> | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!host.current) return;
    const c = createChart(host.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, fontFamily: "var(--font-geist-mono), monospace", fontSize: 11, attributionLogo: false },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      handleScroll: false,
      handleScale: false,
    });
    series.current = c.addSeries(AreaSeries, { lineWidth: 2, priceFormat: { type: "price", precision, minMove: 10 ** -precision } });
    chart.current = c;
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
    };
  }, [precision]);

  useEffect(() => {
    const accent = css("--accent");
    chart.current?.applyOptions({ layout: { textColor: css("--text-3") }, grid: { vertLines: { visible: false }, horzLines: { color: css("--line") } } });
    series.current?.applyOptions({ lineColor: accent, topColor: `${accent}55`, bottomColor: `${accent}00` });
  }, [theme, precision]);

  useEffect(() => {
    if (!series.current || points.length === 0) return;
    // lightweight-charts needs strictly increasing times
    const seen = new Set<number>();
    series.current.setData(points.filter((p) => !seen.has(p.time) && seen.add(p.time)).map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    chart.current?.timeScale().fitContent();
  }, [points, precision]);

  return <div ref={host} className={`w-full ${className}`} />;
}
