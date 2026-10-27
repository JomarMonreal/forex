import "server-only";
import { fetchRetry } from "./http";

export interface Candle {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
}

export type Horizon = "hour" | "day" | "week" | "year";

export const HORIZONS: Horizon[] = ["hour", "day", "week", "year"];

/** Candle resolution used to analyse each forecast horizon. */
export const HORIZON_CONFIG: Record<
  Horizon,
  { label: string; interval: string; range: string; candleLabel: string; ttl: number }
> = {
  hour: { label: "Next Hour", interval: "5m", range: "5d", candleLabel: "5-minute candles", ttl: 60 },
  day: { label: "Next Day", interval: "1h", range: "1mo", candleLabel: "1-hour candles", ttl: 300 },
  week: { label: "Next Week", interval: "1d", range: "1y", candleLabel: "daily candles", ttl: 1800 },
  year: { label: "Next Year", interval: "1wk", range: "10y", candleLabel: "weekly candles", ttl: 3600 },
};

export interface Quote {
  symbol: string;
  price: number;
  previousClose: number;
  changePct: number;
  dayHigh: number;
  dayLow: number;
  spark: number[];
  time: number;
}

const cache = new Map<string, { at: number; data: unknown }>();

async function cached<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlSec * 1000) return hit.data as T;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  return data;
}

const yahooSymbol = (pair: string) => `${pair}=X`;

interface YahooChart {
  meta: {
    regularMarketPrice: number;
    chartPreviousClose?: number;
    previousClose?: number;
    regularMarketDayHigh?: number;
    regularMarketDayLow?: number;
    regularMarketTime?: number;
  };
  timestamp?: number[];
  indicators: { quote: { open: (number | null)[]; high: (number | null)[]; low: (number | null)[]; close: (number | null)[] }[] };
}

async function fetchYahoo(pair: string, interval: string, range: string): Promise<YahooChart> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    yahooSymbol(pair),
  )}?interval=${interval}&range=${range}`;
  const res = await fetchRetry(url, { headers: { "User-Agent": "Mozilla/5.0 (forex-analyzer)" } });
  if (!res.ok) throw new Error(`Price feed error ${res.status} for ${pair}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No price data for ${pair}`);
  return result as YahooChart;
}

function toCandles(chart: YahooChart): Candle[] {
  const ts = chart.timestamp ?? [];
  const q = chart.indicators.quote[0];
  const out: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if (o == null || h == null || l == null || c == null) continue;
    // Yahoo sometimes emits flat placeholder candles for illiquid exotics — keep them, they're harmless.
    out.push({ time: ts[i], open: o, high: h, low: l, close: c });
  }
  // Yahoo's FX opens are unreliable (daily opens sit ~0.2% away from the prior close, which made
  // half of all daily bars look like dojis). FX trades continuously, so each candle opens where
  // the previous one closed; widen the range if needed so the open stays inside it.
  for (let i = 1; i < out.length; i++) {
    const open = out[i - 1].close;
    out[i] = { ...out[i], open, high: Math.max(out[i].high, open), low: Math.min(out[i].low, open) };
  }
  return out;
}

/** Long uncached history for backtesting. */
export async function getHistory(pair: string, interval: string, range: string): Promise<Candle[]> {
  return toCandles(await fetchYahoo(pair, interval, range));
}

export function getCandles(pair: string, horizon: Horizon): Promise<Candle[]> {
  const cfg = HORIZON_CONFIG[horizon];
  return cached(`candles:${pair}:${horizon}`, cfg.ttl, async () =>
    toCandles(await fetchYahoo(pair, cfg.interval, cfg.range)),
  );
}

export function getQuote(pair: string): Promise<Quote> {
  return cached(`quote:${pair}`, 60, async () => {
    const chart = await fetchYahoo(pair, "30m", "5d");
    const candles = toCandles(chart);
    const m = chart.meta;
    // 24h change: compare against the last candle that is at least 24h older than the latest one.
    const last = candles[candles.length - 1];
    const ref = last ? [...candles].reverse().find((c) => c.time <= last.time - 86400) : undefined;
    const prev = ref?.close ?? candles[0]?.open ?? m.regularMarketPrice;
    // Last ~24h of 30-minute closes for the sparkline.
    const spark = candles.slice(-48).map((c) => c.close);
    return {
      symbol: pair,
      price: m.regularMarketPrice,
      previousClose: prev,
      changePct: prev ? ((m.regularMarketPrice - prev) / prev) * 100 : 0,
      dayHigh: m.regularMarketDayHigh ?? Math.max(...spark),
      dayLow: m.regularMarketDayLow ?? Math.min(...spark),
      spark,
      time: m.regularMarketTime ?? Math.floor(Date.now() / 1000),
    };
  });
}
