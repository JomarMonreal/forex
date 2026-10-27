"use client";

import { useEffect, useRef } from "react";
import { CandlestickSeries, ColorType, createChart, type UTCTimestamp } from "lightweight-charts";

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export default function CandleChart({ candles, height = 320, digits = 5 }: { candles: Candle[]; height?: number; digits?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || !candles.length) return;
    const chart = createChart(ref.current, {
      height,
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: cssVar("--surface") }, textColor: cssVar("--text-2"), fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: cssVar("--border") } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 1 },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: cssVar("--bull"),
      downColor: cssVar("--bear"),
      wickUpColor: cssVar("--bull"),
      wickDownColor: cssVar("--bear"),
      borderVisible: false,
      priceFormat: { type: "price", precision: digits, minMove: 1 / 10 ** digits },
    });
    // lightweight-charts requires strictly ascending, unique timestamps.
    const seen = new Set<number>();
    const data = candles
      .filter((c) => !seen.has(c.time) && seen.add(c.time))
      .sort((a, b) => a.time - b.time)
      .map((c) => ({ ...c, time: c.time as UTCTimestamp }));
    series.setData(data);
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [candles, height, digits]);

  return <div ref={ref} style={{ height }} className="w-full" />;
}
