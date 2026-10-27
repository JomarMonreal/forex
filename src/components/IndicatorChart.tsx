"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { IndicatorSeries } from "@/lib/technical/analyze";

export type IndicatorKind =
  | "ema" | "sma" | "bollinger" | "ichimoku" | "sar" | "regression" | "structure" | "sr"
  | "macd" | "rsi" | "stoch" | "adx" | "cci" | "willr" | "roc" | "candles";

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

type Num = number | null;
interface LegendItem {
  name: string;
  color: string;
  series: ISeriesApi<SeriesType>;
  digits: number;
  dashed?: boolean;
}

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Map a vote's technique name to the chart that explains it. */
export function chartKindFor(technique: string, group: string): IndicatorKind | null {
  if (group === "Candlestick") return "candles";
  const t = technique.toLowerCase();
  if (t.startsWith("ema")) return "ema";
  if (t.startsWith("price vs sma")) return "sma";
  if (t.startsWith("macd")) return "macd";
  if (t.startsWith("adx")) return "adx";
  if (t.startsWith("ichimoku")) return "ichimoku";
  if (t.startsWith("parabolic")) return "sar";
  if (t.startsWith("linear regression")) return "regression";
  if (t.startsWith("rsi")) return "rsi";
  if (t.startsWith("stochastic")) return "stoch";
  if (t.startsWith("cci")) return "cci";
  if (t.startsWith("williams")) return "willr";
  if (t.startsWith("rate of change")) return "roc";
  if (t.startsWith("bollinger")) return "bollinger";
  if (t.startsWith("market structure")) return "structure";
  if (t.startsWith("support")) return "sr";
  return null;
}

export default function IndicatorChart({
  kind,
  candles,
  ind,
  digits,
  height = 200,
}: {
  kind: IndicatorKind;
  candles: Candle[];
  ind: IndicatorSeries;
  digits: number;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [legend, setLegend] = useState<{ name: string; color: string; value: string; dashed?: boolean }[]>([]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !candles.length) return;
    const c = {
      surface: cssVar("--surface"), text: cssVar("--text-2"), grid: cssVar("--border"), muted: cssVar("--muted"),
      bull: cssVar("--bull"), bear: cssVar("--bear"), s1: cssVar("--s1"), s2: cssVar("--s2"), s3: cssVar("--s3"), price: cssVar("--price"),
    };
    const chart: IChartApi = createChart(el, {
      height,
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: c.surface }, textColor: c.text, fontSize: 10, attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: c.grid } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 1 },
      handleScroll: false,
      handleScale: false,
    });

    // Strictly ascending times are required; drop any duplicate bars, keeping indices aligned.
    const keep: number[] = [];
    let lastT = -Infinity;
    candles.forEach((k, i) => {
      if (k.time > lastT) {
        keep.push(i);
        lastT = k.time;
      }
    });
    const kept = new Set(keep);
    const t = (i: number) => candles[i].time as UTCTimestamp;
    const line = (arr: Num[]) => keep.filter((i) => arr[i] != null).map((i) => ({ time: t(i), value: arr[i] as number }));
    const closes = candles.map((k) => k.close);
    const items: LegendItem[] = [];
    const priceFmt = { type: "price" as const, precision: digits, minMove: 1 / 10 ** digits };
    const oscFmt = { type: "price" as const, precision: 2, minMove: 0.01 };

    const addLine = (name: string, data: Num[], color: string, opts: { dashed?: boolean; width?: 1 | 2; osc?: boolean } = {}) => {
      const s = chart.addSeries(LineSeries, {
        color,
        lineWidth: opts.width ?? 2,
        lineStyle: opts.dashed ? LineStyle.Dashed : LineStyle.Solid,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerRadius: 4,
        priceFormat: opts.osc ? oscFmt : priceFmt,
      });
      s.setData(line(data));
      items.push({ name, color, series: s, digits: opts.osc ? 2 : digits, dashed: opts.dashed });
      return s;
    };
    const price = () => addLine("Price", closes, c.price, { width: 1 });
    const level = (s: ISeriesApi<SeriesType>, value: number, title = "", color = c.muted) =>
      s.createPriceLine({ price: value, color, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title });

    switch (kind) {
      case "ema":
        price();
        addLine("EMA 20", ind.ema20, c.s1);
        addLine("EMA 50", ind.ema50, c.s3);
        break;
      case "sma":
        price();
        addLine(`SMA ${ind.smaLongPeriod}`, ind.smaLong, c.s1);
        break;
      case "bollinger":
        price();
        addLine("Upper", ind.bbUpper, c.s2);
        addLine("Middle", ind.bbMid, c.s3, { dashed: true, width: 1 });
        addLine("Lower", ind.bbLower, c.s2);
        break;
      case "ichimoku":
        price();
        addLine("Tenkan", ind.ichTenkan, c.s1, { width: 1 });
        addLine("Kijun", ind.ichKijun, c.s3, { width: 1 });
        addLine("Span A", ind.ichSpanA, c.s2);
        addLine("Span B", ind.ichSpanB, c.s2, { dashed: true });
        break;
      case "sar": {
        price();
        const s = chart.addSeries(LineSeries, {
          color: c.muted,
          lineVisible: false,
          pointMarkersVisible: true,
          pointMarkersRadius: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          priceFormat: priceFmt,
        });
        s.setData(keep.filter((i) => ind.sar[i] != null).map((i) => ({ time: t(i), value: ind.sar[i] as number, color: ind.sarUp[i] ? c.bull : c.bear })));
        items.push({ name: "SAR (blue = below price, red = above)", color: c.muted, series: s, digits });
        break;
      }
      case "regression":
        price();
        addLine("Regression (30 bars)", ind.regression, c.s1);
        break;
      case "structure": {
        const p = price();
        const highs = ind.swingHighs, lows = ind.swingLows;
        const markers: SeriesMarker<Time>[] = [
          // Label against the previous swing, then keep only the latest 4 of each so labels don't pile up
          // (the vote itself compares the last two).
          ...highs
            .map((h, j) => ({ h, text: j === 0 ? "H" : h.v > highs[j - 1].v ? "HH" : "LH" }))
            .filter(({ h }) => kept.has(h.i))
            .slice(-4)
            .map(({ h, text }) => ({ time: t(h.i), position: "aboveBar" as const, shape: "circle" as const, size: 0.6, color: c.s1, text })),
          ...lows
            .map((l, j) => ({ l, text: j === 0 ? "L" : l.v > lows[j - 1].v ? "HL" : "LL" }))
            .filter(({ l }) => kept.has(l.i))
            .slice(-4)
            .map(({ l, text }) => ({ time: t(l.i), position: "belowBar" as const, shape: "circle" as const, size: 0.6, color: c.s3, text })),
        ].sort((a, b) => (a.time as number) - (b.time as number));
        createSeriesMarkers(p, markers);
        items.push({ name: "Swing highs (HH/LH)", color: c.s1, series: p, digits });
        items.push({ name: "Swing lows (HL/LL)", color: c.s3, series: p, digits });
        break;
      }
      case "sr": {
        const p = price();
        if (ind.resistance != null) level(p, ind.resistance, "Resistance", c.s1);
        if (ind.support != null) level(p, ind.support, "Support", c.s3);
        break;
      }
      case "candles": {
        const s = chart.addSeries(CandlestickSeries, {
          upColor: c.bull, downColor: c.bear, wickUpColor: c.bull, wickDownColor: c.bear, borderVisible: false, priceFormat: priceFmt,
        });
        s.setData(keep.map((i) => ({ time: t(i), open: candles[i].open, high: candles[i].high, low: candles[i].low, close: candles[i].close })));
        createSeriesMarkers(
          s,
          ind.patterns
            .filter((p) => kept.has(p.i))
            .map((p) => ({
              time: t(p.i),
              position: p.direction === "bear" ? ("aboveBar" as const) : ("belowBar" as const),
              shape: p.direction === "bull" ? ("arrowUp" as const) : p.direction === "bear" ? ("arrowDown" as const) : ("circle" as const),
              color: p.direction === "bull" ? c.bull : p.direction === "bear" ? c.bear : c.muted,
              text: p.name.replace(" (prev. bar)", ""),
            }))
            .sort((a, b) => (a.time as number) - (b.time as number)),
        );
        items.push({ name: "Close", color: c.price, series: s, digits });
        break;
      }
      case "rsi": {
        const s = addLine("RSI 14", ind.rsi, c.s3, { osc: true });
        level(s, 70, "70");
        level(s, 30, "30");
        level(s, 50);
        break;
      }
      case "macd": {
        const h = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "price", precision: 6, minMove: 1e-6 } });
        h.setData(keep.filter((i) => ind.macdHist[i] != null).map((i) => ({ time: t(i), value: ind.macdHist[i] as number, color: (ind.macdHist[i] as number) >= 0 ? c.bull : c.bear })));
        items.push({ name: "Histogram", color: c.muted, series: h, digits: 6 });
        const m = addLine("MACD", ind.macd, c.s1);
        m.applyOptions({ priceFormat: { type: "price", precision: 6, minMove: 1e-6 } });
        items[items.length - 1].digits = 6;
        const sg = addLine("Signal", ind.macdSignal, c.s3);
        sg.applyOptions({ priceFormat: { type: "price", precision: 6, minMove: 1e-6 } });
        items[items.length - 1].digits = 6;
        break;
      }
      case "stoch": {
        const k = addLine("%K", ind.stochK, c.s1, { osc: true });
        addLine("%D", ind.stochD, c.s3, { osc: true, dashed: true });
        level(k, 80, "80");
        level(k, 20, "20");
        break;
      }
      case "adx": {
        const a = addLine("ADX", ind.adx, c.s1, { osc: true });
        addLine("+DI", ind.plusDI, c.bull, { osc: true, width: 1 });
        addLine("−DI", ind.minusDI, c.bear, { osc: true, width: 1 });
        level(a, 20, "trend");
        break;
      }
      case "cci": {
        const s = addLine("CCI 20", ind.cci, c.s3, { osc: true });
        level(s, 100, "+100");
        level(s, -100, "−100");
        break;
      }
      case "willr": {
        const s = addLine("%R 14", ind.willR, c.s3, { osc: true });
        level(s, -20, "−20");
        level(s, -80, "−80");
        break;
      }
      case "roc": {
        const s = addLine("ROC 12 (%)", ind.roc, c.s3, { osc: true });
        level(s, 0, "0");
        break;
      }
    }

    chart.timeScale().fitContent();
    if (kind === "candles" && keep.length > 40) {
      chart.timeScale().setVisibleLogicalRange({ from: keep.length - 40, to: keep.length + 1 });
    }

    // Legend shows latest values, or the hovered bar's values while the crosshair is over the chart.
    const valueOf = (it: LegendItem, data: unknown) => {
      const d = data as { value?: number; close?: number } | undefined;
      const v = d?.value ?? d?.close;
      return v == null ? "—" : v.toFixed(it.digits);
    };
    const lastValues = () =>
      items.map((it) => {
        const data = it.series.data();
        return { name: it.name, color: it.color, dashed: it.dashed, value: valueOf(it, data[data.length - 1]) };
      });
    setLegend(lastValues());
    chart.subscribeCrosshairMove((param) => {
      if (!param.time) return setLegend(lastValues());
      setLegend(items.map((it) => ({ name: it.name, color: it.color, dashed: it.dashed, value: valueOf(it, param.seriesData.get(it.series)) })));
    });
    return () => chart.remove();
  }, [kind, candles, ind, digits, height]);

  return (
    <div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] mb-1 min-h-4">
        {legend.map((l) => (
          <span key={l.name} className="flex items-center gap-1 text-ink-2">
            <span
              className="inline-block w-3"
              style={{ borderTop: `2px ${l.dashed ? "dashed" : "solid"} ${l.color}` }}
              aria-hidden
            />
            {l.name}
            {!l.name.startsWith("Swing") && <span className="tabular text-ink">{l.value}</span>}
          </span>
        ))}
      </div>
      <div ref={ref} style={{ height }} className="w-full" />
    </div>
  );
}
