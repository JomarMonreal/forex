import "server-only";
import { analyzePair, type Agreement, type PairAnalysis } from "./analysis";
import { PAIRS, type ForexPair } from "./pairs";
import { HORIZONS, type Horizon } from "./prices";
import { modelStamp, type Verdict } from "./backtest/model";

/** Compact per-horizon prediction used for ranking (no candles). */
export interface Prediction {
  symbol: string;
  pair: ForexPair;
  horizon: Horizon;
  label: string;
  direction: "bull" | "bear";
  confidence: number; // probability of the predicted direction, 50..100
  bullPct: number;
  trend: "Bullish" | "Bearish" | "Neutral";
  agreement: Agreement;
  techBull: number | null;
  fundBull: number | null;
  fundConfidence: number;
  fundamentalsDone: boolean;
  /** Backtest verdict for the technical model at this horizon (undefined before the first backtest). */
  verdict?: Verdict;
  /** Ranking score: confidence edge, rewarded when technicals and fundamentals agree. */
  score: number;
  reasons: string[];
  patterns: string[];
}

export interface PairSummary {
  symbol: string;
  pair: ForexPair;
  price: number | null;
  fundamentalsDone: boolean;
  engine: string;
  predictions: Prediction[];
  /** Cross-horizon consensus: how strongly all horizons lean the same way (-100..100). */
  consensus: number;
  updatedAt: number;
}

export interface ScanState {
  phase: "idle" | "technical" | "fundamental" | "done";
  startedAt?: number;
  finishedAt?: number;
  progress: { technical: number; fundamental: number; total: number };
  current?: string;
  modelStamp?: number; // backtest the results were computed with
  results: Record<string, PairSummary>;
  errors: Record<string, string>;
}

const RESCAN_MS = Number(process.env.SCAN_REFRESH_MINUTES ?? 30) * 60_000;
const TECH_CONCURRENCY = 4;
// Free LLM tiers rate-limit hard; analyse fundamentals one pair at a time by default.
const LLM_CONCURRENCY = Math.max(1, Number(process.env.SCAN_LLM_CONCURRENCY ?? 1));

const g = globalThis as unknown as { __scanState?: ScanState; __scanRunning?: Promise<void> };
const state: ScanState = (g.__scanState ??= {
  phase: "idle",
  progress: { technical: 0, fundamental: 0, total: PAIRS.length },
  results: {},
  errors: {},
});

function summarize(a: PairAnalysis, fundamentalsDone: boolean): PairSummary {
  const predictions: Prediction[] = a.horizons.map((h) => {
    const direction = h.bullPct >= 50 ? "bull" : "bear";
    const confidence = Math.max(h.bullPct, h.bearPct);
    const agreeBonus = h.agreement === "confirmed" ? 1.15 : h.agreement === "conflicting" ? 0.8 : 1;
    // Unverified (technical-only) calls rank a bit lower than cross-checked ones.
    const verified = fundamentalsDone ? 1 : 0.9;
    return {
      symbol: a.pair.symbol,
      pair: a.pair,
      horizon: h.horizon,
      label: h.label,
      direction,
      confidence,
      bullPct: h.bullPct,
      trend: h.trend,
      agreement: h.agreement,
      techBull: h.technical?.bullPct ?? null,
      fundBull: fundamentalsDone ? h.fundamental.bullPct : null,
      fundConfidence: fundamentalsDone ? h.fundamental.confidence : 0,
      fundamentalsDone,
      verdict: h.calibration?.verdict,
      score: (confidence - 50) * 2 * agreeBonus * verified,
      reasons: h.reasons.filter((r) => !r.startsWith("Technical poll") && !r.startsWith("Fundamental read")).slice(0, 4),
      patterns: (h.technical?.patterns ?? []).filter((p) => p.direction !== "neutral").map((p) => `${p.name} (${p.direction})`),
    };
  });
  // Shorter horizons are noisier, so weight longer ones a little more in the consensus.
  const w = { hour: 0.7, day: 1, week: 1.2, year: 1.2 } as Record<Horizon, number>;
  const tw = HORIZONS.reduce((s, h) => s + w[h], 0);
  const consensus = predictions.reduce((s, p) => s + (p.bullPct - 50) * 2 * w[p.horizon], 0) / tw;
  return {
    symbol: a.pair.symbol,
    pair: a.pair,
    price: a.price,
    fundamentalsDone,
    engine: a.fundamental.engine,
    predictions,
    consensus,
    updatedAt: Date.now(),
  };
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(n, queue.length) }, async () => {
      while (queue.length) await fn(queue.shift()!);
    }),
  );
}

async function run() {
  state.phase = "technical";
  state.startedAt = Date.now();
  const stamp = modelStamp();
  // A new backtest changes every technical probability, so don't reuse older full analyses.
  if (stamp !== state.modelStamp) state.results = {};
  state.modelStamp = stamp;
  state.finishedAt = undefined;
  state.progress = { technical: 0, fundamental: 0, total: PAIRS.length };
  state.errors = {};

  // Phase 1: fast technical-only pass so the page can rank immediately.
  await pool(PAIRS, TECH_CONCURRENCY, async (p) => {
    try {
      const prev = state.results[p.symbol];
      // Keep a still-fresh full analysis rather than downgrading it to technical-only.
      if (!(prev?.fundamentalsDone && Date.now() - prev.updatedAt < RESCAN_MS)) {
        state.results[p.symbol] = summarize(await analyzePair(p.symbol, { fundamentals: false }), false);
      }
    } catch (e) {
      state.errors[p.symbol] = (e as Error).message;
    }
    state.progress.technical++;
  });

  // Phase 2: AI fundamentals, most promising pairs first so the top of the list is verified soonest.
  state.phase = "fundamental";
  const order = Object.values(state.results)
    .sort((a, b) => Math.max(...b.predictions.map((x) => x.score)) - Math.max(...a.predictions.map((x) => x.score)))
    .map((s) => s.symbol);
  await pool(order, LLM_CONCURRENCY, async (symbol) => {
    state.current = symbol;
    try {
      state.results[symbol] = summarize(await analyzePair(symbol), true);
    } catch (e) {
      state.errors[symbol] = (e as Error).message;
    }
    state.progress.fundamental++;
  });
  state.current = undefined;
  state.phase = "done";
  state.finishedAt = Date.now();
}

/** Start a scan if none is running and the last one is stale (or `force`). */
export function ensureScan(force = false) {
  if (g.__scanRunning) return;
  const stale = !state.finishedAt || Date.now() - state.finishedAt > RESCAN_MS || state.modelStamp !== modelStamp();
  if (!force && !stale && state.phase !== "idle") return;
  g.__scanRunning = run()
    .catch((e) => console.error("[scan] failed", e))
    .finally(() => (g.__scanRunning = undefined));
}

export const getScanState = () => state;
