"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { PairSummary, Prediction, ScanState } from "@/lib/scanner";
import { formatPair } from "@/lib/pairs";
import { fmtPrice, timeAgo } from "@/lib/format";
import { VERDICT_LABEL } from "@/lib/backtest/verdict";

type HorizonFilter = "all" | Prediction["horizon"];
type DirFilter = "all" | "bull" | "bear";

const HORIZON_LABEL = { hour: "Next Hour", day: "Next Day", week: "Next Week", year: "Next Year" } as const;

export default function TopPicksPage() {
  const [scan, setScan] = useState<ScanState | null>(null);
  const [horizon, setHorizon] = useState<HorizonFilter>("all");
  const [dir, setDir] = useState<DirFilter>("all");
  const [confirmedOnly, setConfirmedOnly] = useState(false);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [limit, setLimit] = useState(20);

  const load = (force = false) =>
    fetch(`/api/scan${force ? "?force=1" : ""}`)
      .then((r) => r.json())
      .then(setScan)
      .catch(() => {});

  const running = scan?.phase === "technical" || scan?.phase === "fundamental";
  useEffect(() => {
    load();
  }, []);
  // Poll quickly while a scan is running, slowly otherwise.
  useEffect(() => {
    const t = setInterval(load, running || !scan ? 4000 : 60000);
    return () => clearInterval(t);
  }, [running, scan]);

  const summaries = useMemo(() => Object.values(scan?.results ?? {}), [scan]);

  const ranked = useMemo(() => {
    return summaries
      .flatMap((s) => s.predictions)
      .filter((p) => p.trend !== "Neutral")
      .filter((p) => horizon === "all" || p.horizon === horizon)
      .filter((p) => dir === "all" || p.direction === dir)
      .filter((p) => !confirmedOnly || p.agreement === "confirmed")
      .filter((p) => !verifiedOnly || p.fundamentalsDone)
      .sort((a, b) => b.score - a.score);
  }, [summaries, horizon, dir, confirmedOnly, verifiedOnly]);

  const consensus = useMemo(
    () =>
      summaries
        .filter((s) => {
          const dirs = new Set(s.predictions.map((p) => (p.trend === "Neutral" ? "n" : p.direction)));
          return dirs.size === 1 && !dirs.has("n");
        })
        .sort((a, b) => Math.abs(b.consensus) - Math.abs(a.consensus))
        .slice(0, 8),
    [summaries],
  );

  const best = ranked[0];
  const p = scan?.progress;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Top Picks</h1>
          <p className="text-sm text-ink-2">
            Every pair and every horizon, ranked by how confident the combined technical + fundamental call is.
          </p>
        </div>
        <button onClick={() => load(true)} disabled={running} className="rounded-md border border-line px-3 py-2 text-sm hover:bg-surface-2 disabled:opacity-50">
          {running ? "Scanning…" : "↻ Rescan all pairs"}
        </button>
      </div>

      {scan && p && (
        <ScanProgress scan={scan} />
      )}

      {!summaries.length && (
        <div className="rounded-xl border border-line bg-surface p-6 text-sm text-muted animate-pulse">
          Scanning {p?.total ?? 44} pairs — technical rankings appear in about a minute, then AI fundamentals verify them one by one…
        </div>
      )}

      {best && <Hero p={best} summary={scan!.results[best.symbol]} />}

      {summaries.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {(["all", "hour", "day", "week", "year"] as HorizonFilter[]).map((h) => (
            <Chip key={h} on={horizon === h} onClick={() => setHorizon(h)}>
              {h === "all" ? "All horizons" : HORIZON_LABEL[h]}
            </Chip>
          ))}
          <span className="w-px self-stretch bg-line mx-1" />
          <Chip on={dir === "all"} onClick={() => setDir("all")}>Both</Chip>
          <Chip on={dir === "bull"} onClick={() => setDir("bull")}><span className="text-bull">▲</span> Bull</Chip>
          <Chip on={dir === "bear"} onClick={() => setDir("bear")}><span className="text-bear">▼</span> Bear</Chip>
          <span className="w-px self-stretch bg-line mx-1" />
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={confirmedOnly} onChange={(e) => setConfirmedOnly(e.target.checked)} />
            ✔ Confirmed only
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer ml-2">
            <input type="checkbox" checked={verifiedOnly} onChange={(e) => setVerifiedOnly(e.target.checked)} />
            AI-checked only
          </label>
        </div>
      )}

      {summaries.length > 0 && (
        <section className="rounded-xl border border-line bg-surface">
          <div className="px-4 pt-4">
            <h2 className="font-medium">Most confident predictions</h2>
            <p className="text-xs text-muted">
              Ranked by edge over 50%, boosted when technicals and fundamentals agree and reduced when they conflict. Technical % comes from the
              backtested model, so expect most calls between 45% and 60%. Neutral calls are hidden.
            </p>
          </div>
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="py-2 pl-4 pr-2 font-medium w-10">#</th>
                  <th className="py-2 pr-3 font-medium">Pair</th>
                  <th className="py-2 pr-3 font-medium">Horizon</th>
                  <th className="py-2 pr-3 font-medium">Call</th>
                  <th className="py-2 pr-3 font-medium min-w-32">Confidence</th>
                  <th className="py-2 pr-3 font-medium text-right">Tech</th>
                  <th className="py-2 pr-3 font-medium text-right">Fund.</th>
                  <th className="py-2 pr-3 font-medium">Cross-check</th>
                  <th className="py-2 pr-4 font-medium" title="Did the technical model beat simple baselines at this horizon in the backtest?">Backtest</th>
                </tr>
              </thead>
              <tbody>
                {ranked.slice(0, limit).map((x, i) => (
                  <tr key={x.symbol + x.horizon} className="border-b border-line/60 hover:bg-surface-2">
                    <td className="py-2 pl-4 pr-2 tabular text-muted">{i + 1}</td>
                    <td className="py-2 pr-3 font-medium whitespace-nowrap">
                      <Link href={`/analyzer?pair=${x.symbol}`} className="hover:text-accent">{formatPair(x.pair)}</Link>
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-ink-2">{x.label}</td>
                    <td className="py-2 pr-3 whitespace-nowrap"><Call p={x} /></td>
                    <td className="py-2 pr-3"><ConfidenceBar p={x} /></td>
                    <td className="py-2 pr-3 text-right tabular text-ink-2">{x.techBull != null ? `${x.techBull.toFixed(0)}%` : "—"}</td>
                    <td className="py-2 pr-3 text-right tabular text-ink-2">
                      {x.fundBull != null ? `${x.fundBull.toFixed(0)}%` : <span className="text-muted" title="AI fundamentals still pending">…</span>}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap"><Agreement p={x} /></td>
                    <td className="py-2 pr-4 whitespace-nowrap text-[11px] text-ink-2">
                      {x.verdict ? <Link href="/performance" className="hover:text-accent">{VERDICT_LABEL[x.verdict]}</Link> : <span className="text-muted">—</span>}
                    </td>
                  </tr>
                ))}
                {!ranked.length && (
                  <tr><td colSpan={9} className="p-6 text-center text-muted">No predictions match these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 text-[11px] text-muted flex flex-wrap justify-between gap-2">
            <span>Bull % columns show the probability the pair rises. A “Bear 70%” call means a 30% bull reading.</span>
            {ranked.length > limit && (
              <button onClick={() => setLimit((l) => l + 20)} className="text-accent hover:underline">Show more ({ranked.length - limit})</button>
            )}
          </div>
        </section>
      )}

      {consensus.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="font-medium">Strongest consensus</h2>
            <p className="text-xs text-muted">Pairs where all four horizons point the same way — the most consistent suggestions.</p>
          </div>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {consensus.map((s) => <ConsensusCard key={s.symbol} s={s} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function ScanProgress({ scan }: { scan: ScanState }) {
  const p = scan.progress;
  const running = scan.phase === "technical" || scan.phase === "fundamental";
  const pct = ((p.technical + p.fundamental) / (p.total * 2)) * 100;
  return (
    <div className="rounded-lg border border-line bg-surface p-3 text-xs space-y-2">
      <div className="flex flex-wrap justify-between gap-2">
        <span>
          {scan.phase === "technical" && <>Phase 1/2 · technical scan {p.technical}/{p.total}</>}
          {scan.phase === "fundamental" && <>Phase 2/2 · AI fundamentals {p.fundamental}/{p.total}{scan.current ? ` · analysing ${scan.current.slice(0, 3)}/${scan.current.slice(3)}` : ""}</>}
          {scan.phase === "done" && <>✔ All {p.total} pairs analysed{scan.finishedAt ? ` · ${timeAgo(scan.finishedAt)}` : ""}</>}
          {scan.phase === "idle" && <>Starting scan…</>}
        </span>
        {running && <span className="text-muted">Rankings update live. You can keep browsing other pages.</span>}
      </div>
      {running && (
        <div className="h-1.5 w-full rounded bg-surface-2 overflow-hidden">
          <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
      {Object.keys(scan.errors).length > 0 && (
        <div className="text-warn">Skipped: {Object.keys(scan.errors).join(", ")}</div>
      )}
    </div>
  );
}

function Hero({ p, summary }: { p: Prediction; summary?: PairSummary }) {
  const bull = p.direction === "bull";
  return (
    <section className={`rounded-xl border-2 ${bull ? "border-bull" : "border-bear"} bg-surface p-5`}>
      <div className="text-xs uppercase tracking-wide text-muted">Most confident prediction right now</div>
      <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <div className="text-3xl font-semibold tracking-tight">{formatPair(p.pair)}</div>
          <div className="text-sm text-muted tabular">{fmtPrice(summary?.price)} · {p.label}</div>
        </div>
        <div className={`text-4xl font-semibold ${bull ? "text-bull" : "text-bear"}`}>
          {bull ? "▲ Bullish" : "▼ Bearish"} <span className="text-ink tabular">{p.confidence.toFixed(0)}%</span>
        </div>
        <div className="flex flex-col items-start gap-1 text-xs">
          <Agreement p={p} />
          <span className="text-muted">
            Tech {p.techBull?.toFixed(0) ?? "—"}% bull · Fund. {p.fundBull != null ? `${p.fundBull.toFixed(0)}% bull` : "pending"}
          </span>
        </div>
        <Link href={`/analyzer?pair=${p.symbol}`} className="ml-auto rounded-md bg-ink text-bg px-4 py-2 text-sm hover:opacity-90">
          Open in Analyzer →
        </Link>
      </div>
      <ul className="mt-4 grid gap-1.5 text-sm md:grid-cols-2">
        {p.reasons.map((r, i) => (
          <li key={i} className="flex gap-2"><span className="text-muted">•</span><span>{r}</span></li>
        ))}
        {p.patterns.length > 0 && (
          <li className="flex gap-2"><span className="text-muted">•</span><span>Candlesticks: {p.patterns.join(", ")}</span></li>
        )}
      </ul>
    </section>
  );
}

function ConsensusCard({ s }: { s: PairSummary }) {
  const bull = s.consensus > 0;
  return (
    <Link href={`/analyzer?pair=${s.symbol}`} className="rounded-xl border border-line bg-surface p-4 hover:border-accent transition-colors">
      <div className="flex justify-between items-baseline">
        <span className="font-semibold">{formatPair(s.pair)}</span>
        <span className={`text-sm font-medium ${bull ? "text-bull" : "text-bear"}`}>{bull ? "▲ Bull" : "▼ Bear"}</span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1 text-center text-[11px]">
        {s.predictions.map((p) => (
          <div key={p.horizon} className="rounded bg-surface-2 py-1.5">
            <div className="text-muted">{p.horizon[0].toUpperCase() + p.horizon.slice(1)}</div>
            <div className="tabular">
              <span className={p.direction === "bull" ? "text-bull" : "text-bear"}>{p.direction === "bull" ? "▲" : "▼"}</span> {p.confidence.toFixed(0)}%
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 text-[11px] text-muted">
        Consensus strength {Math.abs(s.consensus).toFixed(0)}/100{s.fundamentalsDone ? "" : " · fundamentals pending"}
      </div>
    </Link>
  );
}

function Call({ p }: { p: Prediction }) {
  return p.direction === "bull" ? (
    <span><span className="text-bull">▲</span> Bull</span>
  ) : (
    <span><span className="text-bear">▼</span> Bear</span>
  );
}

function ConfidenceBar({ p }: { p: Prediction }) {
  // Bar spans 50%..100%: how far the call is from a coin flip.
  const w = ((p.confidence - 50) / 50) * 100;
  return (
    <div className="flex items-center gap-2" title={`${p.confidence.toFixed(1)}% ${p.direction === "bull" ? "bullish" : "bearish"}`}>
      <span className="tabular w-9 text-right">{p.confidence.toFixed(0)}%</span>
      <div className="h-2 flex-1 rounded bg-surface-2 overflow-hidden">
        <div className={`h-full rounded ${p.direction === "bull" ? "bg-bull" : "bg-bear"}`} style={{ width: `${Math.max(3, w)}%` }} />
      </div>
    </div>
  );
}

function Agreement({ p }: { p: Prediction }) {
  if (!p.fundamentalsDone) return <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-muted">… AI pending</span>;
  const map = {
    confirmed: ["✔ Confirmed", "border-bull text-bull"],
    conflicting: ["⚠ Conflicting", "border-warn text-warn"],
    neutral: ["◌ Unclear", "border-line text-muted"],
  } as const;
  const [t, cls] = map[p.agreement];
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] ${cls}`}>{t}</span>;
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-md px-3 py-1.5 border ${on ? "bg-ink text-bg border-ink" : "border-line hover:bg-surface-2"}`}>
      {children}
    </button>
  );
}
