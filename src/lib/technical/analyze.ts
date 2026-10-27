import type { Candle } from "../prices";
import * as I from "./indicators";
import { detectPatterns, type PatternHit } from "./patterns";

export type Direction = "bull" | "bear" | "neutral";
export type VoteGroup = "Trend" | "Momentum" | "Volatility" | "Price Action" | "Candlestick";

/** Stable id per technique — the backtest learns one weight per key. All candlestick patterns share "candles". */
export const FEATURE_KEYS = [
  "ema", "sma", "macdSignal", "macdHist", "adx", "ichimoku", "sar", "regression",
  "rsi", "stoch", "cci", "willr", "roc", "bollinger", "structure", "sr", "candles",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export interface Vote {
  key: FeatureKey;
  technique: string;
  group: VoteGroup;
  direction: Direction;
  weight: number; // how much this technique's vote counts in the raw poll
  strength: number; // 0..1 conviction of this particular vote
  detail: string;
}

export interface TechnicalResult {
  bullPct: number; // probability used downstream (calibrated when a backtest model exists)
  bearPct: number;
  rawBullPct: number; // plain weighted vote share
  votes: Vote[];
  patterns: PatternHit[];
  tally: { bull: number; bear: number; neutral: number };
  lastPrice: number;
  atrPct: number;
}

const fmt = (v: number, d = 2) => (isFinite(v) ? v.toFixed(d) : "n/a");

/** Every indicator series needed by the votes, computed once over the whole candle history. */
export interface TechSeries {
  closes: number[];
  ema20: number[];
  ema50: number[];
  sma100: number[];
  sma200: number[];
  macd: ReturnType<typeof I.macd>;
  adx: ReturnType<typeof I.adx>;
  ich: ReturnType<typeof I.ichimokuSeries>;
  sar: ReturnType<typeof I.parabolicSarSeries>;
  atr: number[];
  rsi: number[];
  stoch: ReturnType<typeof I.stochastic>;
  cci: number[];
  willR: number[];
  roc: number[];
  bb: ReturnType<typeof I.bollinger>;
  swings: ReturnType<typeof I.swings>;
}

export function computeSeries(candles: Candle[]): TechSeries {
  const closes = candles.map((c) => c.close);
  return {
    closes,
    ema20: I.ema(closes, 20),
    ema50: I.ema(closes, 50),
    sma100: I.sma(closes, 100),
    sma200: I.sma(closes, 200),
    macd: I.macd(closes),
    adx: I.adx(candles),
    ich: I.ichimokuSeries(candles),
    sar: I.parabolicSarSeries(candles),
    atr: I.atr(candles),
    rsi: I.rsi(closes),
    stoch: I.stochastic(candles),
    cci: I.cci(candles),
    willR: I.williamsR(candles),
    roc: I.roc(closes),
    bb: I.bollinger(closes),
    swings: I.swings(candles, 3),
  };
}

/** Index of the last element with `.i <= max` in a list sorted by `.i` (-1 if none). */
function lastAtOrBefore(arr: { i: number }[], max: number) {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].i <= max) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/**
 * Every technique casts a vote using only information available at bar `i`.
 * The live analyzer calls this for the latest bar; the backtest calls it for every past bar,
 * so both use exactly the same logic.
 */
export function votesAt(S: TechSeries, candles: Candle[], i: number): { votes: Vote[]; patterns: PatternHit[]; atrPct: number } {
  const votes: Vote[] = [];
  const price = S.closes[i];
  const vote = (v: Vote) => {
    if (isFinite(v.strength)) votes.push({ ...v, strength: Math.max(0, Math.min(1, v.strength)) });
  };
  const dir = (x: number, deadband = 0): Direction => (x > deadband ? "bull" : x < -deadband ? "bear" : "neutral");
  const at = (a: number[], back = 0) => (i - back >= 0 ? a[i - back] : NaN);

  // ---------- Trend ----------
  const ema20 = at(S.ema20), ema50 = at(S.ema50);
  if (isFinite(ema50)) {
    const gap = (ema20 - ema50) / ema50;
    const crossedRecently = Math.sign(at(S.ema20, 3) - at(S.ema50, 3)) !== Math.sign(ema20 - ema50);
    vote({
      key: "ema",
      technique: "EMA 20/50 crossover",
      group: "Trend",
      direction: dir(gap),
      weight: 1.5,
      strength: crossedRecently ? 1 : Math.min(1, 0.5 + Math.abs(gap) * 200),
      detail: `EMA20 ${fmt(ema20, 5)} is ${gap > 0 ? "above" : "below"} EMA50 ${fmt(ema50, 5)}${crossedRecently ? " — fresh crossover" : ""}.`,
    });
  }

  const longP = i + 1 >= 200 ? 200 : 100;
  const smaLong = at(longP === 200 ? S.sma200 : S.sma100);
  if (isFinite(smaLong)) {
    const d = (price - smaLong) / smaLong;
    vote({
      key: "sma",
      technique: `Price vs SMA ${longP}`,
      group: "Trend",
      direction: dir(d),
      weight: 1.5,
      strength: Math.min(1, 0.4 + Math.abs(d) * 100),
      detail: `Price is ${fmt(Math.abs(d) * 100)}% ${d > 0 ? "above" : "below"} the ${longP}-period average (long-term trend filter).`,
    });
  }

  const ml = at(S.macd.line), ms = at(S.macd.signal), mh = at(S.macd.hist), mhPrev = at(S.macd.hist, 1);
  if (isFinite(ms) && isFinite(mhPrev)) {
    vote({
      key: "macdSignal",
      technique: "MACD signal line",
      group: "Momentum",
      direction: dir(ml - ms),
      weight: 1.2,
      strength: Math.sign(mh) !== Math.sign(mhPrev) ? 1 : 0.65,
      detail: `MACD ${ml > ms ? "above" : "below"} its signal line${Math.sign(mh) !== Math.sign(mhPrev) ? " (just crossed)" : ""}.`,
    });
    vote({
      key: "macdHist",
      technique: "MACD histogram slope",
      group: "Momentum",
      direction: dir(mh - mhPrev),
      weight: 0.8,
      strength: 0.5,
      detail: `Histogram is ${mh > mhPrev ? "rising" : "falling"} — momentum ${mh > mhPrev ? "improving" : "fading"}.`,
    });
  }

  const adxV = at(S.adx.adx), pdi = at(S.adx.plusDI), mdi = at(S.adx.minusDI);
  if (isFinite(adxV)) {
    const trending = adxV >= 20;
    vote({
      key: "adx",
      technique: "ADX / DMI",
      group: "Trend",
      direction: trending ? dir(pdi - mdi) : "neutral",
      weight: 1.2,
      strength: trending ? Math.min(1, adxV / 40) : 0.5,
      detail: `ADX ${fmt(adxV, 1)} (${trending ? "trending" : "ranging"}); +DI ${fmt(pdi, 1)} vs −DI ${fmt(mdi, 1)}.`,
    });
  }

  const spanA = at(S.ich.spanA), spanB = at(S.ich.spanB);
  if (isFinite(spanA) && isFinite(spanB)) {
    const top = Math.max(spanA, spanB), bot = Math.min(spanA, spanB);
    const pos = price > top ? 1 : price < bot ? -1 : 0;
    const tk = at(S.ich.tenkan) - at(S.ich.kijun);
    vote({
      key: "ichimoku",
      technique: "Ichimoku cloud",
      group: "Trend",
      direction: pos !== 0 ? dir(pos) : "neutral",
      weight: 1.2,
      strength: pos !== 0 && Math.sign(tk) === pos ? 0.9 : 0.55,
      detail: `Price is ${pos > 0 ? "above" : pos < 0 ? "below" : "inside"} the cloud; Tenkan ${tk > 0 ? "above" : "below"} Kijun.`,
    });
  }

  if (S.sar && isFinite(S.sar.sar[i])) {
    const up = S.sar.up[i];
    vote({
      key: "sar",
      technique: "Parabolic SAR",
      group: "Trend",
      direction: up ? "bull" : "bear",
      weight: 0.8,
      strength: 0.6,
      detail: `SAR at ${fmt(S.sar.sar[i], 5)} is ${up ? "below" : "above"} price.`,
    });
  }

  const atrPct = (at(S.atr) / price) * 100;
  if (i >= 29) {
    const slope = I.regressionSlope(S.closes.slice(i - 29, i + 1), 30);
    vote({
      key: "regression",
      technique: "Linear regression (30 bars)",
      group: "Trend",
      direction: dir(slope, atrPct * 0.02),
      weight: 1,
      strength: Math.min(1, Math.abs(slope) / (atrPct * 0.1 || 1e-9)),
      detail: `Regression slope ${fmt(slope, 4)}% per bar.`,
    });
  }

  // ---------- Momentum / oscillators ----------
  const r = at(S.rsi), rPrev = at(S.rsi, 3);
  if (isFinite(r)) {
    let d: Direction, s: number, why: string;
    if (r >= 70) [d, s, why] = ["bear", Math.min(1, (r - 65) / 20), "overbought — pullback risk"];
    else if (r <= 30) [d, s, why] = ["bull", Math.min(1, (35 - r) / 20), "oversold — bounce potential"];
    else if (r > 55) [d, s, why] = ["bull", 0.5, "bullish momentum zone"];
    else if (r < 45) [d, s, why] = ["bear", 0.5, "bearish momentum zone"];
    else [d, s, why] = ["neutral", 0.5, "neutral"];
    vote({ key: "rsi", technique: "RSI (14)", group: "Momentum", direction: d, weight: 1.2, strength: s, detail: `RSI ${fmt(r, 1)} (${why}), ${r > rPrev ? "rising" : "falling"}.` });
  }

  const k = at(S.stoch.k), dd = at(S.stoch.d);
  if (isFinite(dd)) {
    let d: Direction = dir(k - dd);
    let why = `%K ${k > dd ? "above" : "below"} %D`;
    if (k > 80 && k < dd) [d, why] = ["bear", "bearish cross in overbought zone"];
    else if (k < 20 && k > dd) [d, why] = ["bull", "bullish cross in oversold zone"];
    vote({ key: "stoch", technique: "Stochastic (14,3)", group: "Momentum", direction: d, weight: 0.9, strength: why.includes("zone") ? 0.9 : 0.5, detail: `%K ${fmt(k, 1)}, %D ${fmt(dd, 1)} — ${why}.` });
  }

  const c = at(S.cci);
  if (isFinite(c)) {
    const d: Direction = c > 200 ? "bear" : c < -200 ? "bull" : c > 100 ? "bull" : c < -100 ? "bear" : "neutral";
    vote({ key: "cci", technique: "CCI (20)", group: "Momentum", direction: d, weight: 0.7, strength: Math.abs(c) > 200 ? 0.7 : 0.5, detail: `CCI ${fmt(c, 0)}${Math.abs(c) > 200 ? " (extreme — mean-reversion)" : ""}.` });
  }

  const w = at(S.willR);
  if (isFinite(w)) {
    const d: Direction = w > -20 ? "bear" : w < -80 ? "bull" : w > -50 ? "bull" : "bear";
    vote({ key: "willr", technique: "Williams %R", group: "Momentum", direction: d, weight: 0.6, strength: w > -20 || w < -80 ? 0.7 : 0.35, detail: `%R ${fmt(w, 1)}.` });
  }

  const rc = at(S.roc);
  if (isFinite(rc)) {
    vote({ key: "roc", technique: "Rate of change (12)", group: "Momentum", direction: dir(rc, atrPct * 0.1), weight: 0.7, strength: Math.min(1, Math.abs(rc) / (atrPct * 2 || 1e-9)), detail: `Price changed ${fmt(rc, 3)}% over 12 bars.` });
  }

  // ---------- Volatility ----------
  const up = at(S.bb.upper), lo = at(S.bb.lower), md = at(S.bb.mid);
  if (isFinite(up)) {
    const pctB = (price - lo) / (up - lo || 1e-12);
    let d: Direction, why: string, s = 0.5;
    if (pctB > 1) [d, why, s] = ["bear", "closed above upper band — stretched", 0.7];
    else if (pctB < 0) [d, why, s] = ["bull", "closed below lower band — stretched", 0.7];
    else if (price > md) [d, why] = ["bull", "trading in upper half of bands"];
    else [d, why] = ["bear", "trading in lower half of bands"];
    vote({ key: "bollinger", technique: "Bollinger Bands (20,2)", group: "Volatility", direction: d, weight: 0.9, strength: s, detail: `%B ${fmt(pctB)} — ${why}.` });
  }

  // ---------- Price action / market structure ----------
  // Swings confirmed by bar i (3 bars on each side) inside the last 120 bars.
  const winStart = Math.max(0, i - 119) + 3;
  const hi = lastAtOrBefore(S.swings.highs, i - 3), li = lastAtOrBefore(S.swings.lows, i - 3);
  if (hi >= 1 && li >= 1 && S.swings.highs[hi - 1].i >= winStart && S.swings.lows[li - 1].i >= winStart) {
    const h1 = S.swings.highs[hi - 1], h2 = S.swings.highs[hi], l1 = S.swings.lows[li - 1], l2 = S.swings.lows[li];
    const hh = h2.v > h1.v, hl = l2.v > l1.v;
    const d: Direction = hh && hl ? "bull" : !hh && !hl ? "bear" : "neutral";
    vote({ key: "structure", technique: "Market structure (swings)", group: "Price Action", direction: d, weight: 1.3, strength: d === "neutral" ? 0.5 : 0.8, detail: `${hh ? "Higher" : "Lower"} high and ${hl ? "higher" : "lower"} low${d === "neutral" ? " — mixed structure" : ""}.` });

    const resistance = h2.v, support = l2.v;
    const distR = ((resistance - price) / price) * 100, distS = ((price - support) / price) * 100;
    if (price > resistance) {
      vote({ key: "sr", technique: "Support / resistance", group: "Price Action", direction: "bull", weight: 1, strength: 0.75, detail: `Broke above recent swing high ${fmt(resistance, 5)}.` });
    } else if (price < support) {
      vote({ key: "sr", technique: "Support / resistance", group: "Price Action", direction: "bear", weight: 1, strength: 0.75, detail: `Broke below recent swing low ${fmt(support, 5)}.` });
    } else {
      const nearR = distR < atrPct, nearS = distS < atrPct;
      vote({
        key: "sr",
        technique: "Support / resistance",
        group: "Price Action",
        direction: nearR && !nearS ? "bear" : nearS && !nearR ? "bull" : "neutral",
        weight: 1,
        strength: 0.5,
        detail: `Resistance ${fmt(resistance, 5)} (${fmt(distR)}% away), support ${fmt(support, 5)} (${fmt(distS)}% away).`,
      });
    }
  }

  // ---------- Candlesticks ----------
  // Patterns only look a few bars back, so a short window is equivalent to the full history.
  const from = Math.max(0, i - 30);
  const patterns = detectPatterns(candles.slice(from, i + 1)).map((p) => ({ ...p, endIndex: p.endIndex + from }));
  for (const p of patterns) {
    vote({ key: "candles", technique: p.name, group: "Candlestick", direction: p.direction, weight: 1.4, strength: p.strength, detail: p.description });
  }
  if (!patterns.length) {
    const lastC = candles[i];
    vote({ key: "candles", technique: "Latest candle", group: "Candlestick", direction: dir(lastC.close - lastC.open), weight: 0.4, strength: 0.4, detail: `No classic pattern; last candle is ${lastC.close >= lastC.open ? "bullish" : "bearish"}.` });
  }

  return { votes, patterns, atrPct };
}

/**
 * Raw poll: weighted share of bullish conviction. Neutral votes, and the unsure part of every
 * vote, are split evenly so that indecisive techniques pull the result toward 50%.
 */
export function pollVotes(votes: Vote[]) {
  let bull = 0, bear = 0, neutral = 0;
  const tally = { bull: 0, bear: 0, neutral: 0 };
  for (const v of votes) {
    const pts = v.weight * v.strength;
    tally[v.direction]++;
    if (v.direction === "bull") bull += pts;
    else if (v.direction === "bear") bear += pts;
    else neutral += v.weight * 0.5;
    if (v.direction !== "neutral") neutral += v.weight * (1 - v.strength) * 0.5;
  }
  const total = bull + bear + neutral || 1;
  return { bullPct: ((bull + neutral / 2) / total) * 100, tally };
}

/** Feature vector for the learned model: signed conviction per technique, in FEATURE_KEYS order. */
export function featuresFromVotes(votes: Vote[]): number[] {
  const f: Record<string, number> = {};
  for (const v of votes) {
    const s = v.direction === "bull" ? v.strength : v.direction === "bear" ? -v.strength : 0;
    f[v.key] = (f[v.key] ?? 0) + s;
  }
  return FEATURE_KEYS.map((k) => Math.max(-1, Math.min(1, f[k] ?? 0)));
}

/** Live analysis of the latest bar. */
export function analyzeTechnical(candles: Candle[]): TechnicalResult {
  const S = computeSeries(candles);
  const i = candles.length - 1;
  const { votes, patterns, atrPct } = votesAt(S, candles, i);
  const { bullPct, tally } = pollVotes(votes);
  return { bullPct, bearPct: 100 - bullPct, rawBullPct: bullPct, votes, patterns, tally, lastPrice: S.closes[i], atrPct };
}

// ---------------------------------------------------------------- chart data

type Series = (number | null)[];

export interface IndicatorSeries {
  ema20: Series;
  ema50: Series;
  smaLong: Series;
  smaLongPeriod: number;
  bbUpper: Series;
  bbMid: Series;
  bbLower: Series;
  ichTenkan: Series;
  ichKijun: Series;
  ichSpanA: Series;
  ichSpanB: Series;
  sar: Series;
  sarUp: (boolean | null)[];
  regression: Series; // fitted line over the last 30 bars, null elsewhere
  rsi: Series;
  macd: Series;
  macdSignal: Series;
  macdHist: Series;
  stochK: Series;
  stochD: Series;
  adx: Series;
  plusDI: Series;
  minusDI: Series;
  cci: Series;
  willR: Series;
  roc: Series;
  swingHighs: { i: number; v: number }[]; // indices into the returned window
  swingLows: { i: number; v: number }[];
  support: number | null;
  resistance: number | null;
  patterns: { i: number; name: string; direction: Direction }[];
}

/**
 * Full indicator series for charting. Computed on all candles (so warm-up periods are
 * correct) and then cut to the last `keep` bars, aligned index-for-index with that window.
 */
export function indicatorSeries(candles: Candle[], keep = 200): IndicatorSeries {
  const n = candles.length;
  const start = Math.max(0, n - keep);
  const closes = candles.map((c) => c.close);
  const r = (v: number) => (isFinite(v) ? Number(v.toPrecision(7)) : null);
  const cut = (a: number[]) => a.slice(start).map(r);

  const longP = n >= 200 ? 200 : 100;
  const bb = I.bollinger(closes);
  const ich = I.ichimokuSeries(candles);
  const sar = I.parabolicSarSeries(candles);
  const m = I.macd(closes);
  const st = I.stochastic(candles);
  const a = I.adx(candles);

  const reg = I.regression(closes, 30);
  const regression: Series = new Array(n).fill(null);
  if (reg) for (let x = 0; x < reg.len; x++) regression[n - reg.len + x] = r(reg.intercept + reg.slope * x);

  // Same window the market-structure vote uses (last 120 bars).
  const swWindow = Math.min(120, n);
  const sw = I.swings(candles.slice(-swWindow), 3);
  const toWin = (i: number) => n - swWindow + i - start;
  const swingHighs = sw.highs.map((s) => ({ i: toWin(s.i), v: s.v })).filter((s) => s.i >= 0);
  const swingLows = sw.lows.map((s) => ({ i: toWin(s.i), v: s.v })).filter((s) => s.i >= 0);

  return {
    ema20: cut(I.ema(closes, 20)),
    ema50: cut(I.ema(closes, 50)),
    smaLong: cut(I.sma(closes, longP)),
    smaLongPeriod: longP,
    bbUpper: cut(bb.upper),
    bbMid: cut(bb.mid),
    bbLower: cut(bb.lower),
    ichTenkan: cut(ich.tenkan),
    ichKijun: cut(ich.kijun),
    ichSpanA: cut(ich.spanA),
    ichSpanB: cut(ich.spanB),
    sar: sar ? cut(sar.sar) : [],
    sarUp: sar ? sar.up.slice(start) : [],
    regression: regression.slice(start),
    rsi: cut(I.rsi(closes)),
    macd: cut(m.line),
    macdSignal: cut(m.signal),
    macdHist: cut(m.hist),
    stochK: cut(st.k),
    stochD: cut(st.d),
    adx: cut(a.adx),
    plusDI: cut(a.plusDI),
    minusDI: cut(a.minusDI),
    cci: cut(I.cci(candles)),
    willR: cut(I.williamsR(candles)),
    roc: cut(I.roc(closes)),
    swingHighs,
    swingLows,
    resistance: sw.highs.length ? sw.highs[sw.highs.length - 1].v : null,
    support: sw.lows.length ? sw.lows[sw.lows.length - 1].v : null,
    patterns: detectPatterns(candles).map((p) => ({ i: p.endIndex - start, name: p.name, direction: p.direction })),
  };
}
