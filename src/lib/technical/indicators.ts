import type { Candle } from "../prices";

// All functions return arrays aligned with the input (NaN where not yet defined).

export function sma(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  const k = 2 / (period + 1);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    if (i === period - 1) {
      prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
      out[i] = prev;
    } else if (i >= period) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

/** Wilder's smoothing (used by RSI, ATR, ADX). */
function wilder(values: number[], period: number): number[] {
  const out = new Array(values.length).fill(NaN);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    if (i === period - 1) {
      prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
      out[i] = prev;
    } else if (i >= period) {
      prev = (prev * (period - 1) + values[i]) / period;
      out[i] = prev;
    }
  }
  return out;
}

export function rsi(closes: number[], period = 14): number[] {
  const gains = [0], losses = [0];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(Math.max(d, 0));
    losses.push(Math.max(-d, 0));
  }
  const ag = wilder(gains.slice(1), period);
  const al = wilder(losses.slice(1), period);
  const out = [NaN];
  for (let i = 0; i < ag.length; i++) {
    if (isNaN(ag[i])) out.push(NaN);
    else if (al[i] === 0) out.push(100);
    else out.push(100 - 100 / (1 + ag[i] / al[i]));
  }
  return out;
}

export function macd(closes: number[], fast = 12, slow = 26, signal = 9) {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const line = closes.map((_, i) => ef[i] - es[i]);
  const firstValid = line.findIndex((v) => !isNaN(v));
  const sig = new Array(closes.length).fill(NaN);
  if (firstValid >= 0) {
    const s = ema(line.slice(firstValid), signal);
    s.forEach((v, i) => (sig[firstValid + i] = v));
  }
  const hist = line.map((v, i) => v - sig[i]);
  return { line, signal: sig, hist };
}

export function bollinger(closes: number[], period = 20, mult = 2) {
  const mid = sma(closes, period);
  const upper: number[] = [], lower: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (isNaN(mid[i])) {
      upper.push(NaN);
      lower.push(NaN);
      continue;
    }
    const slice = closes.slice(i - period + 1, i + 1);
    const sd = Math.sqrt(slice.reduce((a, v) => a + (v - mid[i]) ** 2, 0) / period);
    upper.push(mid[i] + mult * sd);
    lower.push(mid[i] - mult * sd);
  }
  return { mid, upper, lower };
}

export function stochastic(c: Candle[], kPeriod = 14, dPeriod = 3) {
  const k = c.map((_, i) => {
    if (i < kPeriod - 1) return NaN;
    const w = c.slice(i - kPeriod + 1, i + 1);
    const hh = Math.max(...w.map((x) => x.high));
    const ll = Math.min(...w.map((x) => x.low));
    return hh === ll ? 50 : ((c[i].close - ll) / (hh - ll)) * 100;
  });
  const first = k.findIndex((v) => !isNaN(v));
  const d = new Array(c.length).fill(NaN);
  if (first >= 0) sma(k.slice(first), dPeriod).forEach((v, i) => (d[first + i] = v));
  return { k, d };
}

export function atr(c: Candle[], period = 14): number[] {
  const tr = c.map((x, i) =>
    i === 0
      ? x.high - x.low
      : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close)),
  );
  return wilder(tr, period);
}

export function adx(c: Candle[], period = 14) {
  const plusDM = [0], minusDM = [0], tr = [c[0] ? c[0].high - c[0].low : 0];
  for (let i = 1; i < c.length; i++) {
    const up = c[i].high - c[i - 1].high;
    const down = c[i - 1].low - c[i].low;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    tr.push(
      Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)),
    );
  }
  const str = wilder(tr, period), sp = wilder(plusDM, period), sm = wilder(minusDM, period);
  const plusDI = str.map((t, i) => (t ? (100 * sp[i]) / t : NaN));
  const minusDI = str.map((t, i) => (t ? (100 * sm[i]) / t : NaN));
  const dx = plusDI.map((p, i) => {
    const s = p + minusDI[i];
    return s ? (100 * Math.abs(p - minusDI[i])) / s : NaN;
  });
  const first = dx.findIndex((v) => !isNaN(v));
  const adxArr = new Array(c.length).fill(NaN);
  if (first >= 0) wilder(dx.slice(first), period).forEach((v, i) => (adxArr[first + i] = v));
  return { adx: adxArr, plusDI, minusDI };
}

export function cci(c: Candle[], period = 20): number[] {
  const tp = c.map((x) => (x.high + x.low + x.close) / 3);
  const m = sma(tp, period);
  return tp.map((v, i) => {
    if (isNaN(m[i])) return NaN;
    const w = tp.slice(i - period + 1, i + 1);
    const md = w.reduce((a, x) => a + Math.abs(x - m[i]), 0) / period;
    return md === 0 ? 0 : (v - m[i]) / (0.015 * md);
  });
}

export function williamsR(c: Candle[], period = 14): number[] {
  return c.map((x, i) => {
    if (i < period - 1) return NaN;
    const w = c.slice(i - period + 1, i + 1);
    const hh = Math.max(...w.map((y) => y.high));
    const ll = Math.min(...w.map((y) => y.low));
    return hh === ll ? -50 : ((hh - x.close) / (hh - ll)) * -100;
  });
}

export function roc(closes: number[], period = 12): number[] {
  return closes.map((v, i) => (i < period ? NaN : ((v - closes[i - period]) / closes[i - period]) * 100));
}

/**
 * Ichimoku (9/26/52) as series aligned to each bar. Span A/B are the cloud values sitting
 * under that bar (the cloud is plotted 26 bars ahead, so they were computed 26 bars earlier).
 */
export function ichimokuSeries(c: Candle[]) {
  const mid = (from: number, to: number) => {
    if (from < 0) return NaN;
    const w = c.slice(from, to + 1);
    return (Math.max(...w.map((x) => x.high)) + Math.min(...w.map((x) => x.low))) / 2;
  };
  const tenkan = c.map((_, i) => mid(i - 8, i));
  const kijun = c.map((_, i) => mid(i - 25, i));
  const spanA = c.map((_, i) => (tenkan[i - 26] + kijun[i - 26]) / 2);
  const spanB = c.map((_, i) => mid(i - 26 - 51, i - 26));
  return { tenkan, kijun, spanA, spanB };
}

/** Ichimoku values for the *current* bar. */
export function ichimoku(c: Candle[]) {
  if (c.length < 78) return null;
  const s = ichimokuSeries(c);
  return { tenkan: last(s.tenkan), kijun: last(s.kijun), spanA: last(s.spanA), spanB: last(s.spanB) };
}

/** Parabolic SAR. Returns the latest SAR value and whether it's below price (uptrend). */
export function parabolicSar(c: Candle[], step = 0.02, max = 0.2) {
  const s = parabolicSarSeries(c, step, max);
  if (!s) return null;
  return { sar: last(s.sar), up: s.up[s.up.length - 1] };
}

/** Parabolic SAR for every bar (NaN for the first two). */
export function parabolicSarSeries(c: Candle[], step = 0.02, max = 0.2) {
  if (c.length < 5) return null;
  const sarArr: number[] = [NaN, NaN];
  const upArr: boolean[] = [true, true];
  let up = c[1].close >= c[0].close;
  let sar = up ? c[0].low : c[0].high;
  let ep = up ? c[1].high : c[1].low;
  let af = step;
  for (let i = 2; i < c.length; i++) {
    sar = sar + af * (ep - sar);
    if (up) {
      sar = Math.min(sar, c[i - 1].low, c[i - 2].low);
      if (c[i].low < sar) {
        up = false;
        sar = ep;
        ep = c[i].low;
        af = step;
      } else if (c[i].high > ep) {
        ep = c[i].high;
        af = Math.min(af + step, max);
      }
    } else {
      sar = Math.max(sar, c[i - 1].high, c[i - 2].high);
      if (c[i].high > sar) {
        up = true;
        sar = ep;
        ep = c[i].high;
        af = step;
      } else if (c[i].low < ep) {
        ep = c[i].low;
        af = Math.min(af + step, max);
      }
    }
    sarArr.push(sar);
    upArr.push(up);
  }
  return { sar: sarArr, up: upArr };
}

/** Least-squares fit of the last `n` closes: slope (price per bar) and the value at the first bar. */
export function regression(closes: number[], n: number) {
  const w = closes.slice(-n);
  const len = w.length;
  if (len < 3) return null;
  const xm = (len - 1) / 2;
  const ym = w.reduce((a, b) => a + b, 0) / len;
  let num = 0, den = 0;
  w.forEach((y, x) => {
    num += (x - xm) * (y - ym);
    den += (x - xm) ** 2;
  });
  const slope = num / den;
  return { slope, intercept: ym - slope * xm, mean: ym, len };
}

/** Least-squares slope of the last `n` closes, as % of price per bar. */
export function regressionSlope(closes: number[], n: number): number {
  const r = regression(closes, n);
  return r ? (r.slope / r.mean) * 100 : 0;
}

/** Swing highs/lows using a simple fractal (pivot with `k` bars on each side). */
export function swings(c: Candle[], k = 3) {
  const highs: { i: number; v: number }[] = [];
  const lows: { i: number; v: number }[] = [];
  for (let i = k; i < c.length - k; i++) {
    const w = c.slice(i - k, i + k + 1);
    if (c[i].high === Math.max(...w.map((x) => x.high))) highs.push({ i, v: c[i].high });
    if (c[i].low === Math.min(...w.map((x) => x.low))) lows.push({ i, v: c[i].low });
  }
  return { highs, lows };
}

export const last = (a: number[], back = 0) => a[a.length - 1 - back];
