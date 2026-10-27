import { promises as fs, readFileSync, statSync } from "fs";
import path from "path";
import type { Horizon } from "../prices";
import { FEATURE_KEYS, featuresFromVotes, type FeatureKey, type Vote } from "../technical/analyze";
import { dot, sigmoid } from "./logistic";
import type { Verdict } from "./verdict";

export { verdictFor, VERDICT_LABEL, type Verdict } from "./verdict";

/** Bump when vote logic or labelling changes so old results are discarded. */
export const MODEL_VERSION = 3;

export interface Bin {
  lo: number;
  hi: number;
  n: number;
  meanPred: number; // average predicted P(up)
  actual: number; // observed share of up moves
}

export interface EvalStats {
  n: number;
  accuracy: number; // hit rate of the called direction
  brier: number; // mean squared error of P(up); 0.25 = coin flip
  bins: Bin[];
  /** Accuracy when the call is at least 60% one way, and how often that happens. */
  highConf: { threshold: number; accuracy: number; coverage: number; n: number };
}

export interface HorizonModel {
  horizon: Horizon;
  interval: string;
  barsAhead: number;
  /** "verified": enough independent outcomes to trust; "weak": too few (year horizon). */
  evidence: "verified" | "weak";
  verdict: Verdict;
  pairs: number;
  samples: number;
  independentOutcomes: number; // ≈ samples·stride / barsAhead
  flatRate: number; // share of bars whose move was within the noise band
  testFrom: string; // ISO date where the out-of-sample period starts (earliest across pairs)
  oos: {
    model: EvalStats;
    raw: EvalStats;
    /** Hit rate of always betting the direction that was more common in training. */
    baseline: number;
    /** Robustness check: model hit rate if you only enter one bar after the signal. */
    delayedAccuracy: number;
  };
  /** Learned weight per technique (log-odds per unit of signed conviction). */
  weights: Record<FeatureKey, number>;
  /** Stand-alone out-of-sample hit rate when the technique is not neutral. */
  techniques: Record<FeatureKey, { accuracy: number; coverage: number; n: number }>;
  perPair: Record<string, { n: number; model: number; raw: number }>;
}

export interface BacktestFile {
  version: number;
  ranAt: number;
  durationSec: number;
  noiseBand: string;
  horizons: Partial<Record<Horizon, HorizonModel>>;
}

const FILE = path.join(process.cwd(), "data", "backtest.json");
const g = globalThis as unknown as { __btModel?: { mtime: number; version: number; data: BacktestFile | null } };

/** Load the saved backtest (re-read when the file changes). */
export function getBacktest(): BacktestFile | null {
  let mtime = 0;
  try {
    mtime = statSync(FILE).mtimeMs;
  } catch {
    return null;
  }
  if (g.__btModel?.mtime === mtime && g.__btModel.version === MODEL_VERSION) return g.__btModel.data;
  // Synchronous read is fine: it only happens once per new backtest file.
  let data: BacktestFile | null = null;
  try {
    data = JSON.parse(readFileSync(FILE, "utf8")) as BacktestFile;
    if (data.version !== MODEL_VERSION) data = null;
  } catch {
    data = null;
  }
  g.__btModel = { mtime, version: MODEL_VERSION, data };
  return data;
}

export async function saveBacktest(data: BacktestFile) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(data));
}

export interface Calibration {
  status: "calibrated" | "weak" | "none";
  verdict?: Verdict;
  rawBullPct: number;
  bullPct: number; // model probability, or raw when no model
  oosAccuracy?: number;
  rawAccuracy?: number;
  baseline?: number;
  delayedAccuracy?: number;
  highConf?: EvalStats["highConf"];
  independentOutcomes?: number;
  samples?: number;
  ranAt?: number;
  weights?: Record<FeatureKey, number>;
  techniques?: HorizonModel["techniques"];
  pairAccuracy?: { n: number; model: number; raw: number };
}

/** Turn live votes into a backtested probability for this horizon. */
export function calibrate(horizon: Horizon, votes: Vote[], rawBullPct: number, symbol?: string): Calibration {
  const bt = getBacktest();
  const m = bt?.horizons[horizon];
  if (!bt || !m) return { status: "none", rawBullPct, bullPct: rawBullPct };
  const x = featuresFromVotes(votes);
  const w = FEATURE_KEYS.map((k) => m.weights[k] ?? 0);
  const p = sigmoid(dot(w, x)) * 100;
  return {
    status: m.evidence === "verified" ? "calibrated" : "weak",
    rawBullPct,
    bullPct: Math.min(99, Math.max(1, p)),
    verdict: m.verdict,
    oosAccuracy: m.oos.model.accuracy,
    baseline: m.oos.baseline,
    delayedAccuracy: m.oos.delayedAccuracy,
    rawAccuracy: m.oos.raw.accuracy,
    highConf: m.oos.model.highConf,
    independentOutcomes: m.independentOutcomes,
    samples: m.samples,
    ranAt: bt.ranAt,
    weights: m.weights,
    techniques: m.techniques,
    pairAccuracy: symbol ? m.perPair[symbol] : undefined,
  };
}

export const modelStamp = () => getBacktest()?.ranAt ?? 0;
