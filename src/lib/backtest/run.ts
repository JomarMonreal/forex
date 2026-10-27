import "server-only";
import { PAIRS, type PairCategory } from "../pairs";
import { getHistory, HORIZONS, type Candle, type Horizon } from "../prices";
import { computeSeries, featuresFromVotes, FEATURE_KEYS, pollVotes, votesAt, type FeatureKey } from "../technical/analyze";
import { fitLogistic, dot, sigmoid } from "./logistic";
import { getBacktest, MODEL_VERSION, saveBacktest, verdictFor, type BacktestFile, type Bin, type EvalStats, type HorizonModel } from "./model";

/** History and look-ahead per horizon. The forecast is scored `barsAhead` candles later. */
export const BT_CONFIG: Record<Horizon, { interval: string; range: string; barsAhead: number; stride: number; evidence: "verified" | "weak" }> = {
  hour: { interval: "5m", range: "60d", barsAhead: 12, stride: 3, evidence: "verified" },
  day: { interval: "1h", range: "730d", barsAhead: 24, stride: 6, evidence: "verified" },
  week: { interval: "1d", range: "20y", barsAhead: 5, stride: 1, evidence: "verified" },
  // ~20 years of weekly data gives only ~20 independent yearly outcomes per pair.
  year: { interval: "1wk", range: "20y", barsAhead: 52, stride: 1, evidence: "weak" },
};

/** Rough round-trip spread as % of price — a move smaller than this can't be traded profitably. */
export const SPREAD_PCT: Record<PairCategory, number> = { major: 0.012, minor: 0.025, exotic: 0.06 };
/** A move only counts as up/down if it beats this fraction of a typical move over the horizon. */
export const NOISE_FRACTION = 0.15;

export const noiseBand = (category: PairCategory, atrPct: number, barsAhead: number) =>
  Math.max(SPREAD_PCT[category], NOISE_FRACTION * atrPct * Math.sqrt(barsAhead));

const WARMUP = 210; // bars needed before the slowest indicator (SMA 200) is valid
const TRAIN_SHARE = 0.7;
const STALE_DAYS = Number(process.env.BACKTEST_REFRESH_DAYS ?? 7);

interface Sample {
  symbol: string;
  t: number;
  x: number[];
  raw: number; // raw poll P(up), 0..1
  y: 0 | 1;
  yLate: 0 | 1 | null; // outcome when entering one bar later (null = flat)
}

export interface BacktestStatus {
  running: boolean;
  phase: string;
  done: number;
  total: number;
  error?: string;
  startedAt?: number;
}

const g = globalThis as unknown as { __btStatus?: BacktestStatus; __btRun?: Promise<void> };
const status: BacktestStatus = (g.__btStatus ??= { running: false, phase: "idle", done: 0, total: 0 });

export const getBacktestStatus = () => status;

const yieldToServer = () => new Promise((r) => setImmediate(r));

function buildSamples(symbol: string, category: PairCategory, candles: Candle[], h: Horizon) {
  const { barsAhead: H, stride } = BT_CONFIG[h];
  const S = computeSeries(candles);
  const out: Sample[] = [];
  let flats = 0;
  for (let i = WARMUP; i + H + 1 < candles.length; i += stride) {
    const { votes, atrPct } = votesAt(S, candles, i);
    if (!isFinite(atrPct) || atrPct <= 0) continue;
    const ret = ((candles[i + H].close - candles[i].close) / candles[i].close) * 100;
    if (!isFinite(ret) || Math.abs(ret) > 25) continue; // bad tick
    const tau = noiseBand(category, atrPct, H);
    if (Math.abs(ret) < tau) {
      flats++;
      continue;
    }
    const late = ((candles[i + 1 + H].close - candles[i + 1].close) / candles[i + 1].close) * 100;
    const yLate = Math.abs(late) < tau ? null : late > 0 ? 1 : 0;
    out.push({ symbol, t: candles[i].time, x: featuresFromVotes(votes), raw: pollVotes(votes).bullPct / 100, y: ret > 0 ? 1 : 0, yLate });
  }
  return { samples: out, flats };
}

function evaluate(preds: { p: number; y: number }[]): EvalStats {
  const n = preds.length || 1;
  let hit = 0, brier = 0;
  const bins: Bin[] = Array.from({ length: 10 }, (_, b) => ({ lo: b / 10, hi: (b + 1) / 10, n: 0, meanPred: 0, actual: 0 }));
  let hcN = 0, hcHit = 0;
  for (const { p, y } of preds) {
    const called = p >= 0.5 ? 1 : 0;
    if (called === y) hit++;
    brier += (p - y) ** 2;
    const b = bins[Math.min(9, Math.floor(p * 10))];
    b.n++;
    b.meanPred += p;
    b.actual += y;
    if (p >= 0.6 || p <= 0.4) {
      hcN++;
      if (called === y) hcHit++;
    }
  }
  for (const b of bins) {
    if (!b.n) continue;
    b.meanPred /= b.n;
    b.actual /= b.n;
  }
  return {
    n: preds.length,
    accuracy: hit / n,
    brier: brier / n,
    bins: bins.filter((b) => b.n > 0),
    highConf: { threshold: 0.6, accuracy: hcN ? hcHit / hcN : 0, coverage: hcN / n, n: hcN },
  };
}

function fitHorizon(h: Horizon, perPair: Map<string, Sample[]>, flats: number): HorizonModel {
  const { barsAhead, stride, interval, evidence } = BT_CONFIG[h];
  // Walk-forward split per pair: first 70% (by time) trains, last 30% tests. Drop the train samples
  // whose outcome window overlaps the test period so nothing leaks across the split.
  const train: Sample[] = [], test: Sample[] = [];
  const purge = Math.ceil(barsAhead / stride);
  let testFrom = Infinity;
  for (const s of perPair.values()) {
    const cut = Math.floor(s.length * TRAIN_SHARE);
    train.push(...s.slice(0, Math.max(0, cut - purge)));
    test.push(...s.slice(cut));
    if (s[cut]) testFrom = Math.min(testFrom, s[cut].t);
  }
  const all = [...perPair.values()].flat();
  const lambda = 5 + 0.0005 * train.length;

  const wTrain = fitLogistic(train.map((s) => s.x), train.map((s) => s.y), lambda);
  const pTest = test.map((s) => ({ p: sigmoid(dot(wTrain, s.x)), y: s.y }));
  const model = evaluate(pTest);
  const raw = evaluate(test.map((s) => ({ p: s.raw, y: s.y })));
  const late = test.filter((s) => s.yLate != null);
  const delayedAccuracy = late.filter((s) => (sigmoid(dot(wTrain, s.x)) >= 0.5 ? 1 : 0) === s.yLate).length / (late.length || 1);
  const upRate = train.reduce((a, s) => a + s.y, 0) / (train.length || 1);
  const baseline = test.reduce((a, s) => a + (s.y === (upRate >= 0.5 ? 1 : 0) ? 1 : 0), 0) / (test.length || 1);

  const techniques = {} as HorizonModel["techniques"];
  FEATURE_KEYS.forEach((k, j) => {
    let n = 0, hit = 0;
    for (const s of test) {
      if (s.x[j] === 0) continue;
      n++;
      if ((s.x[j] > 0 ? 1 : 0) === s.y) hit++;
    }
    techniques[k] = { n, accuracy: n ? hit / n : 0, coverage: n / (test.length || 1) };
  });

  const perPairStats: HorizonModel["perPair"] = {};
  for (const [symbol, s] of perPair) {
    const t = s.slice(Math.floor(s.length * TRAIN_SHARE));
    if (!t.length) continue;
    const m = t.filter((x) => (sigmoid(dot(wTrain, x.x)) >= 0.5 ? 1 : 0) === x.y).length / t.length;
    const r = t.filter((x) => (x.raw >= 0.5 ? 1 : 0) === x.y).length / t.length;
    perPairStats[symbol] = { n: t.length, model: m, raw: r };
  }

  // The live model is refitted on everything; its expected quality is the out-of-sample result above.
  const wAll = fitLogistic(all.map((s) => s.x), all.map((s) => s.y), 5 + 0.0005 * all.length);
  const weights = Object.fromEntries(FEATURE_KEYS.map((k, j) => [k, wAll[j]])) as Record<FeatureKey, number>;

  return {
    horizon: h,
    interval,
    barsAhead,
    evidence,
    verdict: evidence === "weak" ? "none" : verdictFor(model.accuracy, baseline, delayedAccuracy),
    pairs: perPair.size,
    samples: all.length,
    independentOutcomes: Math.round((all.length * stride) / barsAhead),
    flatRate: flats / (flats + all.length || 1),
    testFrom: isFinite(testFrom) ? new Date(testFrom * 1000).toISOString().slice(0, 10) : "",
    oos: { model, raw, baseline, delayedAccuracy },
    weights,
    techniques,
    perPair: perPairStats,
  };
}

async function run() {
  const t0 = Date.now();
  Object.assign(status, { running: true, phase: "Downloading history", done: 0, total: PAIRS.length * HORIZONS.length, error: undefined, startedAt: t0 });
  const result: BacktestFile = {
    version: MODEL_VERSION,
    ranAt: 0,
    durationSec: 0,
    noiseBand: `max(spread, ${NOISE_FRACTION} × ATR% × √bars ahead)`,
    horizons: {},
  };
  for (const h of HORIZONS) {
    const cfg = BT_CONFIG[h];
    const perPair = new Map<string, Sample[]>();
    let flats = 0;
    status.phase = `${h}: replaying ${cfg.interval} candles`;
    const queue = [...PAIRS];
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (queue.length) {
          const p = queue.shift()!;
          try {
            const candles = await getHistory(p.symbol, cfg.interval, cfg.range);
            await yieldToServer();
            const r = buildSamples(p.symbol, p.category, candles, h);
            if (r.samples.length > 50) perPair.set(p.symbol, r.samples);
            flats += r.flats;
          } catch (e) {
            console.warn(`[backtest] ${p.symbol} ${h}: ${(e as Error).message}`);
          }
          status.done++;
          await yieldToServer();
        }
      }),
    );
    status.phase = `${h}: fitting weights`;
    await yieldToServer();
    if (perPair.size) result.horizons[h] = fitHorizon(h, perPair, flats);
  }
  result.ranAt = Date.now();
  result.durationSec = Math.round((Date.now() - t0) / 1000);
  await saveBacktest(result);
  console.log(`[backtest] finished in ${result.durationSec}s`);
}

/** Run the backtest if none exists, it's stale, or `force`. Returns immediately. */
export function ensureBacktest(force = false) {
  if (g.__btRun) return;
  const bt = getBacktest();
  const stale = !bt || Date.now() - bt.ranAt > STALE_DAYS * 86400_000;
  if (!force && !stale) return;
  g.__btRun = run()
    .catch((e) => {
      status.error = (e as Error).message;
      console.error("[backtest] failed", e);
    })
    .finally(() => {
      status.running = false;
      status.phase = status.error ? "failed" : "done";
      g.__btRun = undefined;
    });
}
