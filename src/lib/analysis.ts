import "server-only";
import { getPair, type ForexPair } from "./pairs";
import { getCandles, HORIZONS, HORIZON_CONFIG, type Candle, type Horizon } from "./prices";
import { analyzeTechnical, indicatorSeries, type IndicatorSeries, type TechnicalResult } from "./technical/analyze";
import { analyzeFundamental, type FundamentalHorizon, type FundamentalResult } from "./fundamental/analyze";
import { calibrate, VERDICT_LABEL, type Calibration } from "./backtest/model";
import { ensureBacktest } from "./backtest/run";
import { logPredictions } from "./tracker";

export type Agreement = "confirmed" | "conflicting" | "neutral";

export interface HorizonAnalysis {
  horizon: Horizon;
  label: string;
  candleLabel: string;
  bullPct: number;
  bearPct: number;
  trend: "Bullish" | "Bearish" | "Neutral";
  agreement: Agreement;
  weights: { technical: number; fundamental: number };
  technical: TechnicalResult | null;
  /** How the technical probability was derived from the backtest (null without technicals). */
  calibration: Calibration | null;
  fundamental: FundamentalHorizon;
  reasons: string[];
  candles: Candle[];
  /** Indicator series aligned index-for-index with `candles` (for charts). */
  indicators: IndicatorSeries | null;
  error?: string;
}

export interface PairAnalysis {
  pair: ForexPair;
  price: number | null;
  horizons: HorizonAnalysis[];
  fundamental: Omit<FundamentalResult, "horizons">;
  generatedAt: number;
}

/**
 * How much fundamentals matter per horizon. Short horizons are dominated by price action,
 * long horizons by monetary policy and macro trends.
 */
const FUNDAMENTAL_BASE_WEIGHT: Record<Horizon, number> = { hour: 0.2, day: 0.35, week: 0.5, year: 0.65 };

const side = (p: number) => (p >= 53 ? 1 : p <= 47 ? -1 : 0);

function combine(h: Horizon, tech: TechnicalResult | null, fund: FundamentalHorizon | null) {
  if (!fund) {
    // Technical-only pass (fundamentals not fetched yet).
    const bull = tech ? Math.min(97, Math.max(3, tech.bullPct)) : 50;
    return { bull, agreement: "neutral" as Agreement, weights: { technical: tech ? 1 : 0, fundamental: 0 } };
  }
  // Fundamentals with little evidence get down-weighted automatically.
  let wF = FUNDAMENTAL_BASE_WEIGHT[h] * (0.35 + 0.65 * fund.confidence);
  if (!tech) wF = 1;
  const wT = 1 - wF;
  let bull = (tech ? tech.bullPct * wT : 0) + fund.bullPct * wF;

  // Cross-check: when the two disciplines disagree, shrink conviction toward 50%.
  const ts = tech ? side(tech.bullPct) : 0, fs = side(fund.bullPct);
  let agreement: Agreement = "neutral";
  if (ts && fs && ts === fs) {
    agreement = "confirmed";
    bull = 50 + (bull - 50) * 1.1; // confluence bonus
  } else if (ts && fs && ts !== fs) {
    agreement = "conflicting";
    bull = 50 + (bull - 50) * 0.7;
  }
  bull = Math.min(97, Math.max(3, bull));
  return { bull, agreement, weights: { technical: wT, fundamental: wF } };
}

function buildReasons(tech: TechnicalResult | null, cal: Calibration | null, fund: FundamentalHorizon | null, bull: number, agreement: Agreement) {
  const want = bull >= 50 ? "bull" : "bear";
  const reasons: string[] = [];
  if (tech) {
    const t = tech.tally;
    reasons.push(`Technical poll: ${t.bull} bullish, ${t.bear} bearish, ${t.neutral} neutral votes (raw vote share ${tech.rawBullPct.toFixed(0)}% bullish).`);
    if (cal && cal.status !== "none") {
      reasons.push(
        `Backtested model turns those votes into ${tech.bullPct.toFixed(0)}% bullish — ${VERDICT_LABEL[cal.verdict ?? "none"].toLowerCase()} at this horizon (${((cal.oosAccuracy ?? 0) * 100).toFixed(1)}% out-of-sample hit rate).`,
      );
    } else {
      reasons.push("No backtest yet — technical % is the uncalibrated vote share.");
    }
    const top = tech.votes
      .filter((v) => v.direction === want)
      .sort((a, b) => b.weight * b.strength - a.weight * a.strength)
      .slice(0, 3);
    top.forEach((v) => reasons.push(`${v.technique}: ${v.detail}`));
    const pats = tech.patterns.filter((p) => p.direction !== "neutral");
    if (pats.length) reasons.push(`Candlesticks: ${pats.map((p) => `${p.name} (${p.direction})`).join(", ")}.`);
  }
  if (!fund) {
    reasons.push("Fundamentals not analysed yet — technical-only estimate.");
    return reasons;
  }
  reasons.push(`Fundamental read: ${fund.bullPct.toFixed(0)}% bullish (confidence ${(fund.confidence * 100).toFixed(0)}%).`);
  fund.reasons.slice(0, 2).forEach((r) => reasons.push(r));
  if (agreement === "confirmed") reasons.push("✔ Technical and fundamental analysis agree — higher-conviction signal.");
  if (agreement === "conflicting") reasons.push("⚠ Technicals and fundamentals disagree — conviction reduced; wait for confirmation.");
  return reasons;
}

const PENDING_FUNDAMENTAL: FundamentalHorizon = { bullPct: 50, confidence: 0, reasons: ["Fundamental analysis pending."] };

/** `fundamentals: false` runs a fast technical-only pass (used by the market-wide scanner). */
export async function analyzePair(symbol: string, opts: { fundamentals?: boolean } = {}): Promise<PairAnalysis> {
  const pair = getPair(symbol);
  if (!pair) throw new Error(`Unknown pair ${symbol}`);
  const withFund = opts.fundamentals !== false;
  ensureBacktest(); // no-op unless the saved backtest is missing or stale

  const [fundamental, ...candleSets] = await Promise.all([
    withFund
      ? analyzeFundamental(pair)
      : Promise.resolve<FundamentalResult>({
          engine: "pending",
          summary: "",
          headlines: [],
          generatedAt: Date.now(),
          horizons: { hour: PENDING_FUNDAMENTAL, day: PENDING_FUNDAMENTAL, week: PENDING_FUNDAMENTAL, year: PENDING_FUNDAMENTAL },
        }),
    ...HORIZONS.map((h) => getCandles(pair.symbol, h).catch((e: Error) => e)),
  ]);

  const horizons: HorizonAnalysis[] = HORIZONS.map((h, i) => {
    const cs = candleSets[i];
    const candles = cs instanceof Error ? [] : cs;
    const tech = candles.length >= 60 ? analyzeTechnical(candles) : null;
    let cal: Calibration | null = null;
    if (tech) {
      // Replace the raw vote share with the backtested probability when a model exists.
      cal = calibrate(h, tech.votes, tech.rawBullPct, pair.symbol);
      tech.bullPct = cal.bullPct;
      tech.bearPct = 100 - cal.bullPct;
    }
    const fund = fundamental.horizons[h];
    const { bull, agreement, weights } = combine(h, tech, withFund ? fund : null);
    return {
      horizon: h,
      label: HORIZON_CONFIG[h].label,
      candleLabel: HORIZON_CONFIG[h].candleLabel,
      bullPct: bull,
      bearPct: 100 - bull,
      trend: bull >= 55 ? "Bullish" : bull <= 45 ? "Bearish" : "Neutral",
      agreement,
      weights,
      technical: tech,
      calibration: cal,
      fundamental: fund,
      reasons: buildReasons(tech, cal, withFund ? fund : null, bull, agreement),
      candles: candles.slice(-200),
      indicators: tech && withFund ? indicatorSeries(candles, 200) : null,
      error: cs instanceof Error ? cs.message : !tech ? "Not enough price history for technical analysis" : undefined,
    };
  });

  const { horizons: _h, ...fundRest } = fundamental;
  void _h;
  const lastCandles = horizons[0].candles;
  const result: PairAnalysis = {
    pair,
    price: lastCandles.length ? lastCandles[lastCandles.length - 1].close : null,
    horizons,
    fundamental: fundRest,
    generatedAt: Date.now(),
  };
  // Only full (technical + fundamental) analyses are logged — that's what the user sees.
  if (withFund) logPredictions(result).catch((e) => console.error("[tracker] log failed", e));
  return result;
}
