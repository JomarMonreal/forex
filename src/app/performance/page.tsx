"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { BacktestFile, HorizonModel } from "@/lib/backtest/model";
import type { BacktestStatus } from "@/lib/backtest/run";
import type { TrackSummary, RecordStats } from "@/lib/tracker";
import type { FeatureKey } from "@/lib/technical/analyze";
import { VERDICT_LABEL, type Verdict } from "@/lib/backtest/verdict";
import { getPair, formatPair } from "@/lib/pairs";
import { fmtPrice, timeAgo } from "@/lib/format";
import ReliabilityChart from "@/components/ReliabilityChart";

type H = "hour" | "day" | "week" | "year";
const HORIZONS: H[] = ["hour", "day", "week", "year"];
const H_LABEL: Record<H, string> = { hour: "Next Hour", day: "Next Day", week: "Next Week", year: "Next Year" };
const CANDLE: Record<string, string> = { "5m": "5-minute", "1h": "hourly", "1d": "daily", "1wk": "weekly" };

const TECH_LABEL: Record<FeatureKey, string> = {
  ema: "EMA 20/50 crossover",
  sma: "Price vs SMA 200",
  macdSignal: "MACD signal line",
  macdHist: "MACD histogram slope",
  adx: "ADX / DMI",
  ichimoku: "Ichimoku cloud",
  sar: "Parabolic SAR",
  regression: "Linear regression",
  rsi: "RSI (14)",
  stoch: "Stochastic",
  cci: "CCI (20)",
  willr: "Williams %R",
  roc: "Rate of change",
  bollinger: "Bollinger Bands",
  structure: "Market structure",
  sr: "Support / resistance",
  candles: "Candlestick patterns",
};

const pct = (v: number | undefined, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);

export default function PerformancePage() {
  const [bt, setBt] = useState<{ status: BacktestStatus; result: BacktestFile | null } | null>(null);
  const [track, setTrack] = useState<TrackSummary | null>(null);
  const [sel, setSel] = useState<H>("week");

  const loadBt = (run = false) =>
    fetch(`/api/backtest${run ? "?run=1" : ""}`)
      .then((r) => r.json())
      .then(setBt)
      .catch(() => {});
  const loadTrack = () =>
    fetch("/api/track")
      .then((r) => r.json())
      .then(setTrack)
      .catch(() => {});

  useEffect(() => {
    loadBt();
    loadTrack();
    const t = setInterval(loadTrack, 60_000);
    return () => clearInterval(t);
  }, []);
  // Poll quickly while a backtest is running.
  useEffect(() => {
    if (!bt?.status.running) return;
    const t = setInterval(() => loadBt(), 3000);
    return () => clearInterval(t);
  }, [bt?.status.running]);

  const res = bt?.result;
  const m = res?.horizons[sel];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Performance</h1>
          <p className="text-sm text-ink-2 max-w-3xl">
            How often the predictions are right. The <b>backtest</b> replays the technical votes over years of history and learns
            how much each technique deserves; the <b>live record</b> grades every call this app makes once its horizon has passed.
          </p>
        </div>
        <button
          onClick={() => loadBt(true)}
          disabled={bt?.status.running}
          className="rounded-md border border-line px-3 py-2 text-sm hover:bg-surface-2 disabled:opacity-50"
        >
          {bt?.status.running ? "Backtest running…" : "↻ Re-run backtest"}
        </button>
      </div>

      {bt?.status.running && (
        <div className="rounded-lg border border-line bg-surface p-3 text-xs space-y-2">
          <div>
            {bt.status.phase} · {bt.status.done}/{bt.status.total} pair-horizons
          </div>
          <div className="h-1.5 rounded bg-surface-2 overflow-hidden">
            <div className="h-full bg-accent transition-all" style={{ width: `${(bt.status.done / (bt.status.total || 1)) * 100}%` }} />
          </div>
        </div>
      )}
      {bt?.status.error && <div className="rounded-lg border border-bear bg-bear-soft p-3 text-sm">Backtest failed: {bt.status.error}</div>}

      {/* ---------------------------------------------------------------- backtest */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-medium">Backtest · technical model</h2>
          {res ? (
            <p className="text-xs text-muted">
              Ran {timeAgo(res.ranAt)} in {res.durationSec}s · trained on the first 70% of each pair&apos;s history, scored on the last 30% ·
              a move only counts if it beats the noise band ({res.noiseBand}); smaller moves are excluded as flat.
            </p>
          ) : (
            <p className="text-xs text-muted">{bt ? "No backtest yet — it starts automatically and takes 2–3 minutes." : "Loading…"}</p>
          )}
        </div>

        {res && (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {HORIZONS.map((h) => {
              const x = res.horizons[h];
              if (!x) return null;
              return (
                <button
                  key={h}
                  onClick={() => setSel(h)}
                  className={`text-left rounded-xl border bg-surface p-4 ${sel === h ? "border-accent ring-1 ring-accent" : "border-line hover:border-ink-2"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{H_LABEL[h]}</span>
                    <Verdict v={x.verdict} />
                  </div>
                  <div className="mt-2 text-2xl font-semibold tabular">{pct(x.oos.model.accuracy)}</div>
                  <div className="text-[11px] text-muted">hit rate on unseen data</div>
                  <div className="mt-3 space-y-1 text-[11px] tabular">
                    <Row k="Raw vote poll" v={pct(x.oos.raw.accuracy)} />
                    <Row k="Always bet usual direction" v={pct(x.oos.baseline)} />
                    <Row k="Model, entering 1 bar late" v={pct(x.oos.delayedAccuracy)} />
                    <Row
                      k="Model calls ≥ 60%"
                      v={x.oos.model.highConf.n ? `${pct(x.oos.model.highConf.accuracy)} · ${pct(x.oos.model.highConf.coverage)} of bars` : "never"}
                    />
                  </div>
                  <div className="mt-3 text-[11px] text-muted">
                    {x.samples.toLocaleString()} tests on {CANDLE[x.interval]} candles · ≈{x.independentOutcomes.toLocaleString()} independent
                    {x.evidence === "weak" && <span className="text-warn"> · weak evidence</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {m && (
          <div className="grid gap-4 lg:grid-cols-5">
            <div className="lg:col-span-2 rounded-xl border border-line bg-surface p-4 min-w-0">
              <h3 className="font-medium">Are the percentages honest? · {H_LABEL[sel]}</h3>
              <p className="text-xs text-muted mb-3">
                Each dot groups tests by predicted chance of an up move. On the dashed line, &quot;60%&quot; really means 60%. The raw poll&apos;s
                curve is flat: its confident-looking numbers came true about half the time.
              </p>
              <ReliabilityChart
                series={[
                  { name: "Raw vote poll", color: "var(--s1)", bins: m.oos.raw.bins },
                  { name: "Backtested model", color: "var(--s3)", bins: m.oos.model.bins },
                ]}
              />
              <p className="mt-2 text-[11px] text-muted">
                Brier score (lower is better, 0.25 = coin flip): model {m.oos.model.brier.toFixed(4)}, raw poll {m.oos.raw.brier.toFixed(4)}.
              </p>
            </div>

            <div className="lg:col-span-3 rounded-xl border border-line bg-surface p-4 min-w-0">
              <h3 className="font-medium">What each technique is worth · {H_LABEL[sel]}</h3>
              <p className="text-xs text-muted mb-3">
                Learned weight: how strongly the model follows the vote (⇄ negative = historically the opposite happened more often).
                Hit rate: how often the vote alone was right on unseen data when it wasn&apos;t neutral.
              </p>
              <TechniqueTable m={m} />
            </div>
          </div>
        )}

        {m && <PairTable m={m} />}
      </section>

      {/* ---------------------------------------------------------------- live record */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-medium">Live track record</h2>
          <p className="text-xs text-muted">
            Every full analysis (Analyzer, Top Picks) logs its call at most once per pair per 15 min (hour) / 3 h (day) / 1 day (week) /
            1 week (year), then grades it after the same number of candles the backtest uses. This is the only check of the news-based
            fundamentals.
          </p>
        </div>
        {track && (
          <>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              {HORIZONS.map((h) => {
                const s = track.byHorizon[h];
                return (
                  <div key={h} className="rounded-xl border border-line bg-surface p-4">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">{H_LABEL[h]}</span>
                      <span className="text-[11px] text-muted">{s.pending} pending</span>
                    </div>
                    {s.combined.calls ? (
                      <>
                        <div className="mt-2 text-2xl font-semibold tabular">{pct(s.combined.hitRate)}</div>
                        <div className="text-[11px] text-muted">
                          right on {s.combined.calls} graded calls{s.combined.flats ? ` (+${s.combined.flats} flat)` : ""}
                        </div>
                        <div className="mt-3 space-y-1 text-[11px] tabular">
                          <StatRow k="Technical only" s={s.technical} />
                          <StatRow k="Fundamental only" s={s.fundamental} />
                          <StatRow k="✔ Confirmed calls" s={s.confirmed} />
                          <StatRow k="⚠ Conflicting calls" s={s.conflicting} />
                          <StatRow k="Calls ≥ 60%" s={s.confident} />
                        </div>
                      </>
                    ) : (
                      <p className="mt-2 text-xs text-muted">
                        No graded calls yet.{" "}
                        {s.pending ? `First results in about ${h === "hour" ? "an hour" : h === "day" ? "a day" : h === "week" ? "a week" : "a year"}.` : "Open the Analyzer or Top Picks to start logging."}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <RecentTable track={track} />
          </>
        )}
      </section>
    </div>
  );
}

function TechniqueTable({ m }: { m: HorizonModel }) {
  const rows = (Object.keys(m.weights) as FeatureKey[])
    .map((k) => ({ k, w: m.weights[k], t: m.techniques[k] }))
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
  const maxW = Math.max(...rows.map((r) => Math.abs(r.w)), 0.01);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted border-b border-line">
            <th className="py-2 pr-3 font-medium">Technique</th>
            <th className="py-2 pr-3 font-medium min-w-40">Learned weight</th>
            <th className="py-2 pr-3 font-medium text-right">Hit rate</th>
            <th className="py-2 font-medium text-right">Votes non-neutral</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ k, w, t }) => (
            <tr key={k} className="border-b border-line/60">
              <td className="py-1.5 pr-3 whitespace-nowrap">{TECH_LABEL[k]}</td>
              <td className="py-1.5 pr-3">
                <div className="flex items-center gap-2">
                  <span className="tabular text-xs w-14 text-right">
                    {w < 0 && <span className="text-warn">⇄ </span>}
                    {w >= 0 ? "+" : "−"}
                    {Math.abs(w).toFixed(2)}
                  </span>
                  {/* Diverging bar around a centre line: right = follows the vote, left = fades it. */}
                  <div className="relative h-2 flex-1 rounded bg-surface-2">
                    <div className="absolute left-1/2 top-[-2px] bottom-[-2px] w-px bg-ink/40" />
                    <div
                      className={`absolute top-0 bottom-0 rounded ${w >= 0 ? "bg-s3" : "bg-s1"}`}
                      style={w >= 0 ? { left: "50%", width: `${(w / maxW) * 50}%` } : { right: "50%", width: `${(-w / maxW) * 50}%` }}
                    />
                  </div>
                </div>
              </td>
              <td className="py-1.5 pr-3 text-right tabular">{t.n ? pct(t.accuracy) : "—"}</td>
              <td className="py-1.5 text-right tabular text-ink-2">{pct(t.coverage, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex gap-4 text-[11px] text-muted">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-3 rounded bg-s3" /> follows the vote</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-3 rounded bg-s1" /> fades the vote (⇄)</span>
      </div>
    </div>
  );
}

function PairTable({ m }: { m: HorizonModel }) {
  const [all, setAll] = useState(false);
  const rows = Object.entries(m.perPair).sort((a, b) => b[1].model - a[1].model);
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <h3 className="font-medium">By pair · {H_LABEL[m.horizon as H]}</h3>
      <p className="text-xs text-muted mb-3">Out-of-sample hit rate of the shared model on each pair. Small differences between pairs are mostly noise.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-line">
              <th className="py-2 pr-3 font-medium">Pair</th>
              <th className="py-2 pr-3 font-medium text-right">Model</th>
              <th className="py-2 pr-3 font-medium text-right">Raw poll</th>
              <th className="py-2 font-medium text-right">Tests</th>
            </tr>
          </thead>
          <tbody>
            {(all ? rows : rows.slice(0, 12)).map(([sym, r]) => {
              const p = getPair(sym);
              return (
                <tr key={sym} className="border-b border-line/60">
                  <td className="py-1.5 pr-3">
                    <Link href={`/analyzer?pair=${sym}`} className="hover:text-accent">{p ? formatPair(p) : sym}</Link>
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular">{pct(r.model)}</td>
                  <td className="py-1.5 pr-3 text-right tabular text-ink-2">{pct(r.raw)}</td>
                  <td className="py-1.5 text-right tabular text-muted">{r.n.toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > 12 && (
        <button onClick={() => setAll((v) => !v)} className="mt-2 text-xs text-accent hover:underline">
          {all ? "Show top 12" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

function RecentTable({ track }: { track: TrackSummary }) {
  if (!track.recent.length) return null;
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <h3 className="font-medium">Recent calls</h3>
      <p className="text-xs text-muted mb-3">{track.total.toLocaleString()} logged · {track.pending.toLocaleString()} waiting for their horizon to pass.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-line">
              <th className="py-2 pr-3 font-medium">When</th>
              <th className="py-2 pr-3 font-medium">Pair</th>
              <th className="py-2 pr-3 font-medium">Horizon</th>
              <th className="py-2 pr-3 font-medium">Call</th>
              <th className="py-2 pr-3 font-medium text-right">Entry</th>
              <th className="py-2 pr-3 font-medium text-right">Move</th>
              <th className="py-2 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {track.recent.map((p) => (
              <tr key={p.id} className="border-b border-line/60">
                <td className="py-1.5 pr-3 whitespace-nowrap text-ink-2">{timeAgo(p.madeAt)}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">{p.pair}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap text-ink-2">{H_LABEL[p.horizon as H]}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap tabular">
                  {p.called === "bull" ? <span className="text-bull">▲</span> : <span className="text-bear">▼</span>}{" "}
                  {Math.max(p.bullPct, 100 - p.bullPct).toFixed(0)}%
                </td>
                <td className="py-1.5 pr-3 text-right tabular text-ink-2">{fmtPrice(p.price)}</td>
                <td className="py-1.5 pr-3 text-right tabular text-ink-2">{p.movePct == null ? "—" : `${p.movePct > 0 ? "+" : ""}${p.movePct.toFixed(3)}%`}</td>
                <td className="py-1.5 whitespace-nowrap text-xs">
                  {p.status === "pending" && <span className="text-muted">◌ pending</span>}
                  {p.status === "expired" && <span className="text-muted">expired</span>}
                  {p.status === "resolved" && p.correct === true && <span className="text-bull">✔ <span className="text-ink">right</span></span>}
                  {p.status === "resolved" && p.correct === false && <span className="text-bear">✖ <span className="text-ink">wrong</span></span>}
                  {p.status === "resolved" && p.correct === null && <span className="text-muted">— flat</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Verdict({ v }: { v: Verdict }) {
  const cls = v === "edge" ? "border-bull text-bull" : v === "none" ? "border-line text-muted" : "border-warn text-warn";
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap ${cls}`}>{VERDICT_LABEL[v]}</span>;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted">{k}</span>
      <span className="text-ink-2">{v}</span>
    </div>
  );
}

function StatRow({ k, s }: { k: string; s: RecordStats }) {
  return <Row k={k} v={s.calls ? `${pct(s.hitRate)} of ${s.calls}` : "—"} />;
}
