import type { Candle } from "../prices";

export interface PatternHit {
  name: string;
  direction: "bull" | "bear" | "neutral";
  strength: number; // 0..1 reliability weight
  candles: number; // how many candles form the pattern
  description: string;
  endIndex: number; // index of the candle that completes the pattern
}

const body = (c: Candle) => Math.abs(c.close - c.open);
const range = (c: Candle) => c.high - c.low || 1e-12;
const upperWick = (c: Candle) => c.high - Math.max(c.open, c.close);
const lowerWick = (c: Candle) => Math.min(c.open, c.close) - c.low;
const isBull = (c: Candle) => c.close > c.open;
const isBear = (c: Candle) => c.close < c.open;
const mid = (c: Candle) => (c.open + c.close) / 2;

/** Direction of the short-term trend leading into the pattern (-1 down, 0 flat, 1 up). */
function priorTrend(c: Candle[], end: number, n = 8): number {
  const start = Math.max(0, end - n);
  if (end - start < 3) return 0;
  const change = (c[end].close - c[start].close) / c[start].close;
  const avgRange = c.slice(start, end + 1).reduce((a, x) => a + range(x), 0) / (end - start + 1) / c[end].close;
  if (change > avgRange * 1.5) return 1;
  if (change < -avgRange * 1.5) return -1;
  return 0;
}

/**
 * Scan the most recent candles for classic Japanese candlestick patterns.
 * Only patterns completing on the latest bar (or the one before) are reported,
 * since older patterns have already played out.
 */
export function detectPatterns(candles: Candle[]): PatternHit[] {
  const hits: PatternHit[] = [];
  const n = candles.length;
  if (n < 12) return hits;
  const avgBody = candles.slice(-20).reduce((a, x) => a + body(x), 0) / 20 || 1e-12;

  for (const endOffset of [0, 1]) {
    const i = n - 1 - endOffset;
    const c0 = candles[i], c1 = candles[i - 1], c2 = candles[i - 2];
    const trend = priorTrend(candles, i - 1);
    const fade = endOffset === 0 ? 1 : 0.7; // older patterns count less
    const add = (h: Omit<PatternHit, "endIndex">) =>
      hits.push({ ...h, endIndex: i, strength: h.strength * fade, name: endOffset ? `${h.name} (prev. bar)` : h.name });

    // --- single-candle ---
    const smallBody = body(c0) <= range(c0) * 0.1;
    if (smallBody) {
      if (lowerWick(c0) > range(c0) * 0.6 && trend <= 0)
        add({ name: "Dragonfly Doji", direction: "bull", strength: 0.55, candles: 1, description: "Sellers pushed price down but buyers closed it back near the high — possible bottom." });
      else if (upperWick(c0) > range(c0) * 0.6 && trend >= 0)
        add({ name: "Gravestone Doji", direction: "bear", strength: 0.55, candles: 1, description: "Buyers pushed price up but sellers closed it back near the low — possible top." });
      else
        add({ name: "Doji", direction: "neutral", strength: 0.3, candles: 1, description: "Open ≈ close: indecision between buyers and sellers." });
    } else {
      const hammerShape = lowerWick(c0) >= body(c0) * 2 && upperWick(c0) <= body(c0) * 0.6;
      const starShape = upperWick(c0) >= body(c0) * 2 && lowerWick(c0) <= body(c0) * 0.6;
      if (hammerShape && trend < 0)
        add({ name: "Hammer", direction: "bull", strength: 0.6, candles: 1, description: "Long lower wick after a decline: buyers rejected lower prices." });
      if (hammerShape && trend > 0)
        add({ name: "Hanging Man", direction: "bear", strength: 0.5, candles: 1, description: "Hammer shape after a rally: warning that selling pressure is appearing." });
      if (starShape && trend > 0)
        add({ name: "Shooting Star", direction: "bear", strength: 0.6, candles: 1, description: "Long upper wick after a rally: buyers were rejected at the highs." });
      if (starShape && trend < 0)
        add({ name: "Inverted Hammer", direction: "bull", strength: 0.45, candles: 1, description: "Long upper wick after a decline: early sign of buying interest." });
      if (body(c0) > avgBody * 1.8 && body(c0) > range(c0) * 0.85)
        add({ name: isBull(c0) ? "Bullish Marubozu" : "Bearish Marubozu", direction: isBull(c0) ? "bull" : "bear", strength: 0.5, candles: 1, description: "Full-bodied candle with almost no wicks: one side was in complete control." });
    }

    // --- two-candle ---
    if (isBear(c1) && isBull(c0) && c0.close >= c1.open && c0.open <= c1.close && body(c0) > body(c1))
      add({ name: "Bullish Engulfing", direction: "bull", strength: trend < 0 ? 0.8 : 0.55, candles: 2, description: "A bullish body fully engulfed the prior bearish body." });
    if (isBull(c1) && isBear(c0) && c0.open >= c1.close && c0.close <= c1.open && body(c0) > body(c1))
      add({ name: "Bearish Engulfing", direction: "bear", strength: trend > 0 ? 0.8 : 0.55, candles: 2, description: "A bearish body fully engulfed the prior bullish body." });
    if (isBear(c1) && isBull(c0) && body(c1) > avgBody && c0.open < c1.close && c0.close > mid(c1) && c0.close < c1.open)
      add({ name: "Piercing Line", direction: "bull", strength: 0.6, candles: 2, description: "Bullish candle closed above the midpoint of the previous bearish candle." });
    if (isBull(c1) && isBear(c0) && body(c1) > avgBody && c0.open > c1.close && c0.close < mid(c1) && c0.close > c1.open)
      add({ name: "Dark Cloud Cover", direction: "bear", strength: 0.6, candles: 2, description: "Bearish candle closed below the midpoint of the previous bullish candle." });
    if (body(c1) > avgBody * 1.2 && body(c0) < body(c1) * 0.5 && Math.max(c0.open, c0.close) < Math.max(c1.open, c1.close) && Math.min(c0.open, c0.close) > Math.min(c1.open, c1.close)) {
      if (isBear(c1) && trend <= 0) add({ name: "Bullish Harami", direction: "bull", strength: 0.45, candles: 2, description: "Small candle inside a large bearish one: selling momentum is stalling." });
      if (isBull(c1) && trend >= 0) add({ name: "Bearish Harami", direction: "bear", strength: 0.45, candles: 2, description: "Small candle inside a large bullish one: buying momentum is stalling." });
    }
    const tol = avgBody * 0.1;
    if (Math.abs(c0.low - c1.low) <= tol && isBear(c1) && isBull(c0) && trend < 0)
      add({ name: "Tweezer Bottom", direction: "bull", strength: 0.5, candles: 2, description: "Two candles rejected the same low — support is holding." });
    if (Math.abs(c0.high - c1.high) <= tol && isBull(c1) && isBear(c0) && trend > 0)
      add({ name: "Tweezer Top", direction: "bear", strength: 0.5, candles: 2, description: "Two candles rejected the same high — resistance is holding." });

    // --- three-candle ---
    if (isBear(c2) && body(c2) > avgBody && body(c1) < avgBody * 0.5 && isBull(c0) && c0.close > mid(c2))
      add({ name: "Morning Star", direction: "bull", strength: 0.85, candles: 3, description: "Bearish candle, small indecision candle, then a strong bullish close — classic bottom reversal." });
    if (isBull(c2) && body(c2) > avgBody && body(c1) < avgBody * 0.5 && isBear(c0) && c0.close < mid(c2))
      add({ name: "Evening Star", direction: "bear", strength: 0.85, candles: 3, description: "Bullish candle, small indecision candle, then a strong bearish close — classic top reversal." });
    if ([c2, c1, c0].every(isBull) && c1.close > c2.close && c0.close > c1.close && [c2, c1, c0].every((x) => body(x) > avgBody * 0.7 && upperWick(x) < body(x) * 0.5))
      add({ name: "Three White Soldiers", direction: "bull", strength: 0.75, candles: 3, description: "Three consecutive strong bullish candles — sustained buying." });
    if ([c2, c1, c0].every(isBear) && c1.close < c2.close && c0.close < c1.close && [c2, c1, c0].every((x) => body(x) > avgBody * 0.7 && lowerWick(x) < body(x) * 0.5))
      add({ name: "Three Black Crows", direction: "bear", strength: 0.75, candles: 3, description: "Three consecutive strong bearish candles — sustained selling." });
    if (isBear(c2) && body(c1) < body(c2) && Math.max(c1.open, c1.close) < c2.open && Math.min(c1.open, c1.close) > c2.close && isBull(c0) && c0.close > c2.open)
      add({ name: "Three Inside Up", direction: "bull", strength: 0.65, candles: 3, description: "Bullish harami confirmed by a close above the first candle." });
    if (isBull(c2) && body(c1) < body(c2) && Math.max(c1.open, c1.close) < c2.close && Math.min(c1.open, c1.close) > c2.open && isBear(c0) && c0.close < c2.open)
      add({ name: "Three Inside Down", direction: "bear", strength: 0.65, candles: 3, description: "Bearish harami confirmed by a close below the first candle." });
  }

  return hits;
}
