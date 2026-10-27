import "server-only";
import { promises as fs } from "fs";
import path from "path";
import type { PairAnalysis } from "./analysis";
import { getPair } from "./pairs";
import { getCandles, HORIZONS, type Horizon } from "./prices";
import { BT_CONFIG, noiseBand } from "./backtest/run";

/** One logged forecast, graded once its horizon has passed. */
export interface PredictionRecord {
  id: string;
  symbol: string;
  horizon: Horizon;
  madeAt: number; // ms
  candleTime: number; // unix s of the bar the call was made on
  price: number;
  bullPct: number; // combined (what the user saw)
  techPct: number; // technical (calibrated when available)
  rawPct: number; // raw vote share
  fundPct: number | null; // null when fundamentals weren't analysed
  agreement: "confirmed" | "conflicting" | "neutral";
  noisePct: number; // move needed to count as up/down
  status: "pending" | "resolved" | "expired";
  resolvedAt?: number;
  exitPrice?: number;
  movePct?: number;
  outcome?: "up" | "down" | "flat";
}

const FILE = path.join(process.cwd(), "data", "predictions.json");
const MAX = 40000;
/** Don't log the same pair/horizon more often than this — near-duplicate calls would skew the stats. */
const MIN_GAP_MS: Record<Horizon, number> = { hour: 15 * 60e3, day: 3 * 3600e3, week: 24 * 3600e3, year: 7 * 86400e3 };
/** Skip logging when the latest candle is this old (market closed / stale feed). */
const MAX_STALE_S: Record<Horizon, number> = { hour: 30 * 60, day: 3 * 3600, week: 4 * 86400, year: 10 * 86400 };

interface State {
  loaded: boolean;
  items: PredictionRecord[];
  timer?: NodeJS.Timeout;
  /** Serialises log/resolve so concurrent analyses can't both pass the duplicate check. */
  queue: Promise<unknown>;
  dirty: boolean;
}
const g = globalThis as unknown as { __tracker?: State };
const state: State = (g.__tracker ??= { loaded: false, items: [], dirty: false, queue: Promise.resolve() });
state.queue ??= Promise.resolve(); // state may predate this field after a hot reload

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = state.queue.then(fn, fn);
  state.queue = next.catch(() => {});
  return next;
}

async function load() {
  if (state.loaded) return;
  state.loaded = true;
  try {
    state.items = JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    state.items = [];
  }
}

async function save() {
  if (!state.dirty) return;
  state.dirty = false;
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(state.items));
}

export function logPredictions(a: PairAnalysis) {
  return serial(() => logNow(a));
}

async function logNow(a: PairAnalysis) {
  await load();
  start();
  const now = Date.now();
  for (const h of a.horizons) {
    if (!h.technical || !h.candles.length) continue;
    const lastC = h.candles[h.candles.length - 1];
    if (now / 1000 - lastC.time > MAX_STALE_S[h.horizon]) continue;
    const prev = state.items.findLast((p) => p.symbol === a.pair.symbol && p.horizon === h.horizon);
    if (prev && now - prev.madeAt < MIN_GAP_MS[h.horizon]) continue;
    state.items.push({
      id: `${a.pair.symbol}:${h.horizon}:${now}`,
      symbol: a.pair.symbol,
      horizon: h.horizon,
      madeAt: now,
      candleTime: lastC.time,
      price: lastC.close,
      bullPct: h.bullPct,
      techPct: h.technical.bullPct,
      rawPct: h.technical.rawBullPct,
      fundPct: a.fundamental.engine === "pending" ? null : h.fundamental.bullPct,
      agreement: h.agreement,
      noisePct: noiseBand(a.pair.category, h.technical.atrPct, BT_CONFIG[h.horizon].barsAhead),
      status: "pending",
    });
    state.dirty = true;
  }
  if (state.items.length > MAX) state.items = state.items.slice(-MAX);
  await save();
}

/** Grade pending calls whose horizon (the same number of bars the backtest uses) has elapsed. */
export function resolveDue() {
  return serial(resolveNow);
}

async function resolveNow() {
  await load();
  const pending = state.items.filter((p) => p.status === "pending");
  const groups = new Map<string, PredictionRecord[]>();
  for (const p of pending) {
    const k = `${p.symbol}|${p.horizon}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  for (const [k, preds] of groups) {
    const [symbol, horizon] = k.split("|") as [string, Horizon];
    const H = BT_CONFIG[horizon].barsAhead;
    // Nothing can be due before ~H bars of wall-clock time have passed.
    const oldest = Math.min(...preds.map((p) => p.candleTime));
    if (Date.now() / 1000 - oldest < H * intervalSeconds(horizon) * 0.9) continue;
    let candles;
    try {
      candles = await getCandles(symbol, horizon);
    } catch {
      continue;
    }
    for (const p of preds) {
      const idx = candles.findIndex((c) => c.time >= p.candleTime);
      if (idx < 0 || (idx === 0 && candles[0].time > p.candleTime)) {
        // The prediction bar has scrolled out of the fetched window — can't grade it fairly.
        if (Date.now() - p.madeAt > 30 * 86400e3 && horizon !== "year") p.status = "expired";
        continue;
      }
      const exit = candles[idx + H];
      if (!exit) continue;
      const move = ((exit.close - p.price) / p.price) * 100;
      Object.assign(p, {
        status: "resolved",
        resolvedAt: Date.now(),
        exitPrice: exit.close,
        movePct: move,
        outcome: Math.abs(move) < p.noisePct ? "flat" : move > 0 ? "up" : "down",
      });
      state.dirty = true;
    }
  }
  await save();
}

const intervalSeconds = (h: Horizon) => ({ hour: 300, day: 3600, week: 86400, year: 7 * 86400 })[h];

function start() {
  if (state.timer) return;
  state.timer = setInterval(() => resolveDue().catch((e) => console.error("[tracker]", e)), 5 * 60e3);
}

// ------------------------------------------------------------------ summary

export interface RecordStats {
  calls: number; // resolved, non-flat
  hits: number;
  hitRate: number;
  flats: number;
}

export interface TrackSummary {
  total: number;
  pending: number;
  byHorizon: Record<
    Horizon,
    {
      pending: number;
      combined: RecordStats;
      technical: RecordStats;
      fundamental: RecordStats;
      confident: RecordStats; // combined calls ≥ 60% one way
      confirmed: RecordStats; // technical and fundamental agreed
      conflicting: RecordStats;
      bins: { lo: number; hi: number; n: number; meanConf: number; hitRate: number }[];
    }
  >;
  recent: (PredictionRecord & { pair: string; called: "bull" | "bear"; correct: boolean | null })[];
}

function stats(list: PredictionRecord[], pick: (p: PredictionRecord) => number | null): RecordStats {
  let calls = 0, hits = 0, flats = 0;
  for (const p of list) {
    const v = pick(p);
    if (v == null || v === 50) continue;
    if (p.outcome === "flat") {
      flats++;
      continue;
    }
    calls++;
    if ((v > 50) === (p.outcome === "up")) hits++;
  }
  return { calls, hits, hitRate: calls ? hits / calls : 0, flats };
}

export async function getTrackSummary(): Promise<TrackSummary> {
  await load();
  start();
  await resolveDue().catch(() => {});
  const resolved = state.items.filter((p) => p.status === "resolved");
  const byHorizon = {} as TrackSummary["byHorizon"];
  for (const h of HORIZONS) {
    const r = resolved.filter((p) => p.horizon === h);
    // Calibration of what the user saw: confidence of the called side vs how often it was right.
    const bins = [50, 55, 60, 65, 70].map((lo, i, arr) => {
      const hi = arr[i + 1] ?? 101;
      const inBin = r.filter((p) => {
        const conf = Math.max(p.bullPct, 100 - p.bullPct);
        return p.outcome !== "flat" && conf >= lo && conf < hi;
      });
      const hits = inBin.filter((p) => (p.bullPct > 50) === (p.outcome === "up")).length;
      return {
        lo,
        hi: Math.min(hi, 100),
        n: inBin.length,
        meanConf: inBin.reduce((s, p) => s + Math.max(p.bullPct, 100 - p.bullPct), 0) / (inBin.length || 1),
        hitRate: inBin.length ? hits / inBin.length : 0,
      };
    });
    byHorizon[h] = {
      pending: state.items.filter((p) => p.horizon === h && p.status === "pending").length,
      combined: stats(r, (p) => p.bullPct),
      technical: stats(r, (p) => p.techPct),
      fundamental: stats(r, (p) => p.fundPct),
      confident: stats(r.filter((p) => Math.abs(p.bullPct - 50) >= 10), (p) => p.bullPct),
      confirmed: stats(r.filter((p) => p.agreement === "confirmed"), (p) => p.bullPct),
      conflicting: stats(r.filter((p) => p.agreement === "conflicting"), (p) => p.bullPct),
      bins,
    };
  }
  const recent = [...state.items]
    .reverse()
    .slice(0, 60)
    .map((p) => {
      const pair = getPair(p.symbol);
      return {
        ...p,
        pair: pair ? `${pair.base}/${pair.quote}` : p.symbol,
        called: (p.bullPct >= 50 ? "bull" : "bear") as "bull" | "bear",
        correct: p.status !== "resolved" || p.outcome === "flat" ? null : (p.bullPct >= 50) === (p.outcome === "up"),
      };
    });
  return { total: state.items.length, pending: state.items.filter((p) => p.status === "pending").length, byHorizon, recent };
}
