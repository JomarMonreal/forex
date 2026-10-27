"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CATEGORY_LABEL, CURRENCY_NAMES, PAIRS, formatPair, type PairCategory } from "@/lib/pairs";
import { fmtPct, fmtPrice, priceDigits } from "@/lib/format";
import Sparkline from "@/components/Sparkline";
import Sessions from "@/components/Sessions";

interface Quote {
  price: number;
  changePct: number;
  dayHigh: number;
  dayLow: number;
  spark: number[];
}

type Filter = "all" | PairCategory;

export default function MarketsPage() {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"popularity" | "change" | "abs">("popularity");
  const [updated, setUpdated] = useState<number | null>(null);

  useEffect(() => {
    const load = () =>
      fetch("/api/quotes")
        .then((r) => r.json())
        .then((d) => {
          setQuotes(d.quotes);
          setUpdated(d.at);
        })
        .finally(() => setLoading(false));
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  const pairs = useMemo(() => {
    const term = q.trim().toUpperCase().replace("/", "");
    let list = PAIRS.filter((p) => (filter === "all" || p.category === filter) && (!term || p.symbol.includes(term) || p.nickname?.toUpperCase().includes(term)));
    if (sort === "change") list = [...list].sort((a, b) => (quotes[b.symbol]?.changePct ?? -99) - (quotes[a.symbol]?.changePct ?? -99));
    if (sort === "abs") list = [...list].sort((a, b) => Math.abs(quotes[b.symbol]?.changePct ?? 0) - Math.abs(quotes[a.symbol]?.changePct ?? 0));
    return list;
  }, [filter, q, sort, quotes]);

  const groups = (["major", "minor", "exotic"] as PairCategory[]).filter((c) => filter === "all" || c === filter);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Forex Markets</h1>
            <p className="text-sm text-ink-2">
              {PAIRS.length} popular pairs to trade. Pick one to see its bull/bear outlook on the Analyzer.
            </p>
          </div>
          <div className="text-xs text-muted">{updated ? `Updated ${new Date(updated).toLocaleTimeString()} · refreshes every minute` : "Loading prices…"}</div>
        </div>
        <Sessions />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {(["all", "major", "minor", "exotic"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-md px-3 py-1.5 text-sm border ${filter === f ? "bg-ink text-bg border-ink" : "border-line hover:bg-surface-2"}`}
          >
            {f === "all" ? "All" : CATEGORY_LABEL[f]}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search pair… (e.g. EUR/USD, Cable)"
          className="ml-auto w-full sm:w-64 rounded-md border border-line bg-surface px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
        >
          <option value="popularity">Sort: most traded</option>
          <option value="change">Sort: 24h change</option>
          <option value="abs">Sort: biggest movers</option>
        </select>
      </div>

      {groups.map((cat) => {
        const list = pairs.filter((p) => p.category === cat);
        if (!list.length) return null;
        return (
          <section key={cat} className="space-y-3">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted">{CATEGORY_LABEL[cat]}</h2>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {list.map((p) => {
                const quote = quotes[p.symbol];
                const up = (quote?.changePct ?? 0) >= 0;
                return (
                  <Link
                    key={p.symbol}
                    href={`/analyzer?pair=${p.symbol}`}
                    className="group rounded-xl border border-line bg-surface p-4 hover:border-accent transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold tracking-tight">{formatPair(p)}</div>
                        <div className="text-xs text-muted truncate max-w-[11rem]">
                          {p.nickname ? `“${p.nickname}” · ` : ""}
                          {CURRENCY_NAMES[p.base]} / {CURRENCY_NAMES[p.quote]}
                        </div>
                      </div>
                      <span className="text-[10px] rounded border border-line px-1.5 py-0.5 text-muted">#{p.popularity}</span>
                    </div>
                    <div className="mt-3 flex items-end justify-between gap-2">
                      <div>
                        <div className="text-xl font-semibold tabular">{loading && !quote ? "…" : fmtPrice(quote?.price)}</div>
                        {quote && (
                          <div className={`text-sm tabular ${up ? "text-bull" : "text-bear"}`}>
                            {up ? "▲" : "▼"} {fmtPct(quote.changePct)} <span className="text-muted text-xs">24h</span>
                          </div>
                        )}
                      </div>
                      {quote && <Sparkline data={quote.spark} up={up} digits={priceDigits(quote.price)} />}
                    </div>
                    {quote && (
                      <div className="mt-2 flex justify-between text-[11px] text-muted tabular">
                        <span>L {fmtPrice(quote.dayLow)}</span>
                        <span className="opacity-0 group-hover:opacity-100 text-accent">Analyze →</span>
                        <span>H {fmtPrice(quote.dayHigh)}</span>
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
