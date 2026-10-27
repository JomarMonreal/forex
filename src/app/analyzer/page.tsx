"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { HorizonAnalysis, PairAnalysis } from "@/lib/analysis";
import type { Vote } from "@/lib/technical/analyze";
import type { Calibration } from "@/lib/backtest/model";
import { VERDICT_LABEL } from "@/lib/backtest/verdict";
import Link from "next/link";
import { CATEGORY_LABEL, CURRENCY_NAMES, PAIRS, formatPair } from "@/lib/pairs";
import { fmtPrice, priceDigits, timeAgo } from "@/lib/format";
import ProbabilityBar from "@/components/ProbabilityBar";
import CandleChart from "@/components/CandleChart";
import IndicatorChart, { chartKindFor, type IndicatorKind } from "@/components/IndicatorChart";

export default function AnalyzerPage() {
  return (
    <Suspense fallback={<div className="text-muted">Loading…</div>}>
      <Analyzer />
    </Suspense>
  );
}

function Analyzer() {
  const params = useSearchParams();
  const router = useRouter();
  const symbol = (params.get("pair") ?? "EURUSD").toUpperCase();
  const [data, setData] = useState<PairAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<HorizonAnalysis["horizon"]>("day");

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/analyze?pair=${symbol}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [symbol]);

  useEffect(() => {
    setData(null);
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => clearInterval(t);
  }, [load]);

  const h = data?.horizons.find((x) => x.horizon === selected);
  const digits = data?.price ? priceDigits(data.price) : 5;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4 justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analyzer</h1>
          <p className="text-sm text-ink-2">
            Bull/bear probability per horizon from polled technical votes, cross-checked against AI news analysis.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={symbol}
            onChange={(e) => router.push(`/analyzer?pair=${e.target.value}`)}
            className="rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium"
          >
            {(["major", "minor", "exotic"] as const).map((c) => (
              <optgroup key={c} label={CATEGORY_LABEL[c]}>
                {PAIRS.filter((p) => p.category === c).map((p) => (
                  <option key={p.symbol} value={p.symbol}>
                    {formatPair(p)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button onClick={load} disabled={loading} className="rounded-md border border-line px-3 py-2 text-sm hover:bg-surface-2 disabled:opacity-50">
            {loading ? "Analyzing…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {error && <div className="rounded-lg border border-bear bg-bear-soft p-3 text-sm">{error}</div>}
      {!data && loading && <Skeleton />}

      {data && (
        <>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <div className="text-3xl font-semibold tracking-tight">{formatPair(data.pair)}</div>
            <div className="text-2xl tabular">{fmtPrice(data.price)}</div>
            <div className="text-sm text-muted">
              {CURRENCY_NAMES[data.pair.base]} vs {CURRENCY_NAMES[data.pair.quote]} · analysed {timeAgo(data.generatedAt)}
            </div>
          </div>

          {/* Horizon overview */}
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {data.horizons.map((x) => (
              <button
                key={x.horizon}
                onClick={() => setSelected(x.horizon)}
                className={`text-left rounded-xl border bg-surface p-4 transition-colors ${selected === x.horizon ? "border-accent ring-1 ring-accent" : "border-line hover:border-ink-2"}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{x.label}</span>
                  <AgreementBadge a={x.agreement} />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <TrendLabel trend={x.trend} />
                  <span className="text-2xl font-semibold tabular">{Math.max(x.bullPct, x.bearPct).toFixed(0)}%</span>
                  <span className="text-xs text-muted">{x.bullPct >= 50 ? "bull" : "bear"}</span>
                </div>
                <div className="mt-3">
                  <ProbabilityBar bull={x.bullPct} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 text-[11px] text-muted">
                  <MiniScore label="Technical" bull={x.technical?.bullPct} weight={x.weights.technical} />
                  <MiniScore label="Fundamental" bull={x.fundamental.bullPct} weight={x.weights.fundamental} />
                </div>
                {x.calibration && (
                  <div className="mt-2 text-[11px] text-muted">
                    Backtest: <VerdictBadge c={x.calibration} />
                  </div>
                )}
              </button>
            ))}
          </div>

          {h && <HorizonDetail h={h} digits={digits} data={data} />}
        </>
      )}
    </div>
  );
}

function HorizonDetail({ h, digits, data }: { h: HorizonAnalysis; digits: number; data: PairAnalysis }) {
  const groups = ["Trend", "Momentum", "Volatility", "Price Action", "Candlestick"] as const;
  return (
    <>
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="lg:col-span-3 space-y-4 min-w-0">
        <Card title={`${formatPair(data.pair)} · ${h.candleLabel}`} subtitle="Source of the technical votes for this horizon">
          {h.candles.length ? <CandleChart candles={h.candles} digits={digits} /> : <div className="text-sm text-muted">No price data.</div>}
          {h.error && <div className="mt-2 text-xs text-warn">{h.error}</div>}
        </Card>

        <Card
          title="Technical vote poll"
          subtitle="Each technique votes. The raw poll weighs votes by hand; the backtested model re-weighs them using what actually worked historically."
        >
          {h.technical ? (
            <>
              <div className="mb-3 flex flex-wrap gap-4 text-sm tabular">
                <span><span className="text-bull">▲</span> {h.technical.tally.bull} bull</span>
                <span><span className="text-bear">▼</span> {h.technical.tally.bear} bear</span>
                <span className="text-muted">● {h.technical.tally.neutral} neutral</span>
                <span className="ml-auto text-muted">ATR {h.technical.atrPct.toFixed(3)}% per bar</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-[11px] text-muted mb-0.5">Raw vote share (uncalibrated)</div>
                  <ProbabilityBar bull={h.technical.rawBullPct} size="sm" />
                </div>
                <div>
                  <div className="text-[11px] text-muted mb-0.5">
                    {h.calibration?.status !== "none" ? "Backtested probability (used)" : "Backtested probability — not available yet"}
                  </div>
                  <ProbabilityBar bull={h.technical.bullPct} size="sm" />
                </div>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted border-b border-line">
                      <th className="py-2 pr-3 font-medium">Technique</th>
                      <th className="py-2 pr-3 font-medium">Vote</th>
                      <th className="py-2 pr-3 font-medium text-right" title="Hand-picked weight × conviction used by the raw poll">Poll wt.</th>
                      <th className="py-2 pr-3 font-medium text-right" title="Weight learned from the backtest. Negative = historically the opposite of this vote happened more often.">Learned wt.</th>
                      <th className="py-2 pr-3 font-medium text-right" title="How often this technique's vote alone was right, out of sample">Hit rate</th>
                      <th className="py-2 font-medium">Reading</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => {
                      const vs = h.technical!.votes.filter((v) => v.group === g);
                      if (!vs.length) return null;
                      return [
                        <tr key={g}>
                          <td colSpan={6} className="pt-3 pb-1 text-[11px] uppercase tracking-wide text-muted">{g}</td>
                        </tr>,
                        ...vs.map((v, i) => <VoteRow key={g + i} v={v} cal={h.calibration} />),
                      ];
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="text-sm text-muted">Not enough candles to run the technical poll.</div>
          )}
        </Card>
      </div>

      <div className="lg:col-span-2 space-y-4 min-w-0">
        <Card title={`${h.label}: ${h.trend}`} subtitle="Why — combined reasoning">
          <ProbabilityBar bull={h.bullPct} size="lg" />
          <div className="mt-4 rounded-lg bg-surface-2 p-3 text-xs space-y-1.5 tabular">
            <div className="flex justify-between"><span>Technical (backtested)</span><span>{h.technical ? `${h.technical.bullPct.toFixed(1)}% bull × ${(h.weights.technical * 100).toFixed(0)}% weight` : "n/a"}</span></div>
            <div className="flex justify-between"><span>Fundamental</span><span>{h.fundamental.bullPct.toFixed(1)}% bull × {(h.weights.fundamental * 100).toFixed(0)}% weight</span></div>
            <div className="flex justify-between"><span>Cross-check</span><span><AgreementBadge a={h.agreement} /></span></div>
            <div className="flex justify-between border-t border-line pt-1.5 font-medium"><span>Combined</span><span>{h.bullPct.toFixed(1)}% bull / {h.bearPct.toFixed(1)}% bear</span></div>
          </div>
          <ul className="mt-4 space-y-2 text-sm">
            {h.reasons.map((r, i) => (
              <li key={i} className="flex gap-2"><span className="text-muted">•</span><span>{r}</span></li>
            ))}
          </ul>
        </Card>

        {h.calibration && <BacktestCard c={h.calibration} pair={formatPair(data.pair)} label={h.label} />}

        {h.technical && h.technical.patterns.length > 0 && (
          <Card title="Candlestick patterns" subtitle="Detected on the latest bars">
            <ul className="space-y-2 text-sm">
              {h.technical.patterns.map((p, i) => (
                <li key={i}>
                  <div className="font-medium"><Dir d={p.direction} /> {p.name} <span className="text-xs text-muted">({p.candles}-candle, reliability {(p.strength * 100).toFixed(0)}%)</span></div>
                  <div className="text-ink-2 text-xs">{p.description}</div>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card title="Fundamental analysis" subtitle={`Engine: ${data.fundamental.engine}`}>
          {data.fundamental.error && <div className="mb-3 rounded-md border border-warn/50 p-2 text-xs text-warn">{data.fundamental.error}</div>}
          <p className="text-sm text-ink-2">{data.fundamental.summary}</p>
          <div className="mt-3 text-xs text-muted">This horizon ({(h.fundamental.confidence * 100).toFixed(0)}% confidence):</div>
          <ul className="mt-1 space-y-1.5 text-sm">
            {h.fundamental.reasons.map((r, i) => (
              <li key={i} className="flex gap-2"><span className="text-muted">•</span><span>{r}</span></li>
            ))}
          </ul>
          <div className="mt-4 text-xs font-medium text-muted uppercase tracking-wide">News analysed ({data.fundamental.headlines.length})</div>
          <ul className="mt-2 max-h-72 overflow-y-auto divide-y divide-line text-sm">
            {data.fundamental.headlines.map((n) => (
              <li key={n.id} className="py-2">
                <a href={n.url} target="_blank" rel="noreferrer" className="hover:text-accent">{n.title}</a>
                <div className="text-[11px] text-muted">{n.source} · {timeAgo(n.publishedAt)} · {n.currencies.join(", ")}</div>
              </li>
            ))}
            {!data.fundamental.headlines.length && <li className="py-2 text-muted">No recent news for these currencies yet.</li>}
          </ul>
        </Card>
      </div>
    </div>
    {h.technical && h.indicators && (
      <IndicatorCharts h={h} digits={digits} />
    )}
    </>
  );
}

const KIND_TITLE: Record<IndicatorKind, string> = {
  ema: "EMA 20/50 crossover",
  sma: "Long-term moving average",
  bollinger: "Bollinger Bands (20, 2)",
  ichimoku: "Ichimoku cloud",
  sar: "Parabolic SAR",
  regression: "Linear regression (30 bars)",
  structure: "Market structure (swings)",
  sr: "Support / resistance",
  macd: "MACD (12, 26, 9)",
  rsi: "RSI (14)",
  stoch: "Stochastic (14, 3)",
  adx: "ADX / DMI (14)",
  cci: "CCI (20)",
  willr: "Williams %R (14)",
  roc: "Rate of change (12)",
  candles: "Candlestick patterns (last 40 bars)",
};

const KIND_HELP: Partial<Record<IndicatorKind, string>> = {
  ema: "Bullish when the fast EMA is above the slow EMA.",
  sma: "Price above the long average = long-term uptrend.",
  bollinger: "Closes outside the bands are stretched and tend to revert.",
  ichimoku: "Above both cloud spans = bullish, below = bearish, between = no trend.",
  sar: "Dots below price = uptrend; a flip to above price signals a reversal.",
  regression: "Slope of the best-fit line through the last 30 closes.",
  structure: "Higher highs + higher lows = uptrend; lower highs + lower lows = downtrend.",
  sr: "Latest swing high (resistance) and swing low (support).",
  macd: "MACD above its signal line = bullish momentum; histogram shows the gap.",
  rsi: "Above 70 overbought, below 30 oversold; 50 splits bull/bear momentum.",
  stoch: "%K crossing %D; crosses above 80 / below 20 are strongest.",
  adx: "ADX above 20 means a trend exists; +DI vs −DI gives its direction.",
  cci: "Beyond ±100 shows momentum; beyond ±200 is extreme.",
  willr: "Above −20 overbought, below −80 oversold.",
  roc: "Percent change over 12 bars; above 0 = rising.",
  candles: "Arrows mark detected patterns on the latest bars.",
};

function IndicatorCharts({ h, digits }: { h: HorizonAnalysis; digits: number }) {
  // One chart per technique, in vote-table order; MACD's two votes share one chart.
  const byKind = new Map<IndicatorKind, Vote[]>();
  for (const v of h.technical!.votes) {
    const k = chartKindFor(v.technique, v.group);
    if (!k) continue;
    byKind.set(k, [...(byKind.get(k) ?? []), v]);
  }
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-medium">Indicator charts · {h.label}</h2>
        <p className="text-xs text-muted">
          Each technique&apos;s chart on {h.candleLabel}, with the vote it cast. Hover a chart to read values at any bar.
        </p>
      </div>
      <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {[...byKind.entries()].map(([kind, votes]) => (
          <section key={kind} id={`chart-${kind}`} className="rounded-xl border border-line bg-surface p-3 scroll-mt-20 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-medium">{KIND_TITLE[kind]}</h3>
              <div className="flex flex-wrap justify-end gap-1">
                {votes.map((v, i) => (
                  <span key={i} className="rounded-full border border-line px-2 py-0.5 text-[10px] whitespace-nowrap" title={v.technique}>
                    <Dir d={v.direction} label />
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-1 text-xs text-ink-2 space-y-0.5">
              {votes.map((v, i) => (
                <p key={i}>{votes.length > 1 || kind === "candles" ? <span className="text-muted">{v.technique}: </span> : null}{v.detail}</p>
              ))}
            </div>
            {KIND_HELP[kind] && <p className="mt-1 text-[11px] text-muted">{KIND_HELP[kind]}</p>}
            <div className="mt-2">
              <IndicatorChart kind={kind} candles={h.candles} ind={h.indicators!} digits={digits} />
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function VoteRow({ v, cal }: { v: Vote; cal: Calibration | null }) {
  const w = cal?.weights?.[v.key];
  const hit = cal?.techniques?.[v.key];
  return (
    <tr className="border-b border-line/60 align-top">
      <td className="py-1.5 pr-3 sm:whitespace-nowrap">
        {(() => {
          const k = chartKindFor(v.technique, v.group);
          return k ? <a href={`#chart-${k}`} className="hover:text-accent underline decoration-dotted decoration-muted underline-offset-2" title="Jump to chart">{v.technique}</a> : v.technique;
        })()}
      </td>
      <td className="py-1.5 pr-3 whitespace-nowrap"><Dir d={v.direction} label /></td>
      <td className="py-1.5 pr-3 text-right tabular text-ink-2">{(v.weight * v.strength).toFixed(2)}</td>
      <td className="py-1.5 pr-3 text-right tabular text-ink-2 whitespace-nowrap">
        {w == null ? "—" : <>{w < 0 && <span className="text-warn" title="Historically worked in reverse">⇄ </span>}{w >= 0 ? "+" : "−"}{Math.abs(w).toFixed(2)}</>}
      </td>
      <td className="py-1.5 pr-3 text-right tabular text-ink-2">{hit && hit.n ? `${(hit.accuracy * 100).toFixed(0)}%` : "—"}</td>
      <td className="py-1.5 text-ink-2 text-xs">{v.detail}</td>
    </tr>
  );
}

function VerdictBadge({ c }: { c: Calibration }) {
  if (c.status === "none" || !c.verdict) return <span className="rounded-full border border-line px-2 py-0.5 text-[10px]">not run yet</span>;
  const cls = c.verdict === "edge" ? "border-bull text-bull" : c.verdict === "none" ? "border-line text-muted" : "border-warn text-warn";
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap ${cls}`}>{VERDICT_LABEL[c.verdict]}</span>;
}

const pct = (v?: number) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

function BacktestCard({ c, pair, label }: { c: Calibration; pair: string; label: string }) {
  if (c.status === "none") {
    return (
      <Card title="Backtest check" subtitle="Has this kind of signal worked before?">
        <p className="text-sm text-ink-2">
          The backtest hasn&apos;t finished yet (it runs automatically in the background, about 2–3 minutes). Until then the
          technical % is the raw, uncalibrated vote share. <Link href="/performance" className="text-accent hover:underline">See progress →</Link>
        </p>
      </Card>
    );
  }
  return (
    <Card title="Backtest check" subtitle={`Has this kind of ${label.toLowerCase()} signal worked before? Tested on data the model never saw.`}>
      <div className="flex items-center gap-2 text-sm">
        <VerdictBadge c={c} />
        {c.status === "weak" && <span className="text-xs text-warn">Only ≈{c.independentOutcomes} independent outcomes — weak evidence.</span>}
      </div>
      <div className="mt-3 rounded-lg bg-surface-2 p-3 text-xs space-y-1.5 tabular">
        <div className="flex justify-between"><span>Raw vote share → backtested</span><span>{c.rawBullPct.toFixed(0)}% → {c.bullPct.toFixed(0)}% bull</span></div>
        <div className="flex justify-between"><span>Model hit rate (all pairs)</span><span>{pct(c.oosAccuracy)}</span></div>
        <div className="flex justify-between text-muted"><span>vs. raw poll</span><span>{pct(c.rawAccuracy)}</span></div>
        <div className="flex justify-between text-muted"><span>vs. always betting the usual direction</span><span>{pct(c.baseline)}</span></div>
        <div className="flex justify-between text-muted"><span>if you enter one bar late</span><span>{pct(c.delayedAccuracy)}</span></div>
        {c.highConf && c.highConf.n > 0 && (
          <div className="flex justify-between border-t border-line pt-1.5"><span>When the model says ≥60%</span><span>{pct(c.highConf.accuracy)} right · {(c.highConf.coverage * 100).toFixed(1)}% of bars</span></div>
        )}
        {c.pairAccuracy && (
          <div className="flex justify-between"><span>{pair} only</span><span>{pct(c.pairAccuracy.model)} on {c.pairAccuracy.n.toLocaleString()} tests</span></div>
        )}
      </div>
      <p className="mt-2 text-[11px] text-muted">
        News-based fundamentals can&apos;t be backtested (no historical news archive); their record builds up in the live log.{" "}
        <Link href="/performance" className="text-accent hover:underline">Full results →</Link>
      </p>
    </Card>
  );
}

function Dir({ d, label }: { d: "bull" | "bear" | "neutral"; label?: boolean }) {
  if (d === "bull") return <span className="text-bull">▲{label && <span className="text-ink"> Bull</span>}</span>;
  if (d === "bear") return <span className="text-bear">▼{label && <span className="text-ink"> Bear</span>}</span>;
  return <span className="text-muted">●{label && " Neutral"}</span>;
}

function TrendLabel({ trend }: { trend: HorizonAnalysis["trend"] }) {
  const cls = trend === "Bullish" ? "text-bull" : trend === "Bearish" ? "text-bear" : "text-muted";
  const icon = trend === "Bullish" ? "▲" : trend === "Bearish" ? "▼" : "◆";
  return <span className={`text-lg font-semibold ${cls}`}>{icon} {trend}</span>;
}

function AgreementBadge({ a }: { a: HorizonAnalysis["agreement"] }) {
  const map = {
    confirmed: ["✔ Confirmed", "border-bull text-bull"],
    conflicting: ["⚠ Conflicting", "border-warn text-warn"],
    neutral: ["◌ Unclear", "border-line text-muted"],
  } as const;
  const [text, cls] = map[a];
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] whitespace-nowrap ${cls}`} title="Do technical and fundamental analysis point the same way?">{text}</span>;
}

function MiniScore({ label, bull, weight }: { label: string; bull?: number; weight: number }) {
  return (
    <div>
      <div className="flex justify-between"><span>{label}</span><span className="tabular text-ink-2">{bull != null ? `${bull.toFixed(0)}%` : "—"}</span></div>
      <div className="mt-1">{bull != null && <ProbabilityBar bull={bull} size="sm" showLabels={false} />}</div>
      <div className="mt-0.5 tabular">weight {(weight * 100).toFixed(0)}%</div>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h3 className="font-medium">{title}</h3>
      {subtitle && <p className="text-xs text-muted mb-3">{subtitle}</p>}
      {children}
    </section>
  );
}

function Skeleton() {
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-44 rounded-xl border border-line bg-surface animate-pulse" />
      ))}
      <div className="col-span-full text-sm text-muted">Fetching candles, polling indicators and analysing news… (first run can take ~20s)</div>
    </div>
  );
}
