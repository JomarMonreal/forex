"use client";

import { useEffect, useState } from "react";
import { timeAgo } from "@/lib/format";

interface Item {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  kind: string;
  publishedAt: number;
  currencies: string[];
}
interface Status {
  sources: { id: string; name: string; ok: boolean; items?: number; error?: string }[];
  lastPoll?: number;
  intervalSec: number;
  total: number;
}

const MAJORS = ["USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "NZD"];

export default function NewsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [ccy, setCcy] = useState<string[]>([]);
  const [kind, setKind] = useState<"all" | "central-bank" | "market-news">("all");
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(60);

  const load = (refresh = false) => {
    setBusy(true);
    return fetch(`/api/news?limit=300${refresh ? "&refresh=1" : ""}`)
      .then((r) => r.json())
      .then((d) => {
        setItems(d.items);
        setStatus(d.status);
      })
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    load();
    const es = new EventSource("/api/news/stream");
    es.addEventListener("news", (e) => {
      const n = JSON.parse((e as MessageEvent).data) as Item[];
      setFresh((s) => new Set([...s, ...n.map((x) => x.id)]));
      setItems((cur) => [...n, ...cur.filter((c) => !n.some((x) => x.id === c.id))].sort((a, b) => b.publishedAt - a.publishedAt));
    });
    return () => es.close();
  }, []);

  const shown = items.filter((i) => (kind === "all" || i.kind === kind) && (!ccy.length || i.currencies.some((c) => ccy.includes(c))));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">News feed</h1>
          <p className="text-sm text-ink-2">
            Polled every {status?.intervalSec ?? 180}s from Finnhub and central-bank RSS. Only unseen articles trigger alerts.
          </p>
        </div>
        <button onClick={() => load(true)} disabled={busy} className="rounded-md border border-line px-3 py-2 text-sm hover:bg-surface-2 disabled:opacity-50">
          {busy ? "Polling…" : "↻ Poll now"}
        </button>
      </div>

      {status && (
        <div className="flex flex-wrap gap-2 text-xs">
          {status.sources.map((s) => (
            <span key={s.id} title={s.error ?? `${s.items} items`} className={`rounded-full border px-2.5 py-1 ${s.ok ? "border-line" : "border-warn text-warn"}`}>
              {s.ok ? "✔" : "✖"} {s.name}
            </span>
          ))}
          {status.lastPoll && <span className="px-2 py-1 text-muted">Last poll {timeAgo(status.lastPoll)} · {status.total} stored</span>}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(["all", "central-bank", "market-news"] as const).map((k) => (
          <button key={k} onClick={() => setKind(k)} className={`rounded-md px-3 py-1.5 text-sm border ${kind === k ? "bg-ink text-bg border-ink" : "border-line hover:bg-surface-2"}`}>
            {k === "all" ? "All sources" : k === "central-bank" ? "Central banks" : "Market news"}
          </button>
        ))}
        <span className="w-px bg-line mx-1" />
        {MAJORS.map((c) => (
          <button
            key={c}
            onClick={() => setCcy((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))}
            className={`rounded-md px-2.5 py-1.5 text-sm border tabular ${ccy.includes(c) ? "bg-accent text-white border-accent" : "border-line hover:bg-surface-2"}`}
          >
            {c}
          </button>
        ))}
      </div>

      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {shown.slice(0, limit).map((i) => (
          <li key={i.id} className={`p-4 ${fresh.has(i.id) ? "bg-bull-soft/40" : ""}`}>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
              {fresh.has(i.id) && <span className="rounded bg-bull px-1.5 text-white">NEW</span>}
              <span className={i.kind === "central-bank" ? "font-medium text-ink-2" : ""}>{i.source}</span>
              <span>· {timeAgo(i.publishedAt)}</span>
              {i.currencies.map((c) => (
                <span key={c} className="rounded border border-line px-1">{c}</span>
              ))}
            </div>
            <a href={i.url} target="_blank" rel="noreferrer" className="mt-1 block font-medium hover:text-accent">{i.title}</a>
            {i.summary && <p className="mt-1 text-sm text-ink-2 line-clamp-2">{i.summary}</p>}
          </li>
        ))}
        {!shown.length && <li className="p-6 text-center text-muted text-sm">{busy ? "Loading…" : "No articles match."}</li>}
      </ul>
      {shown.length > limit && (
        <button onClick={() => setLimit((l) => l + 60)} className="w-full rounded-md border border-line py-2 text-sm hover:bg-surface-2">
          Show more ({shown.length - limit} remaining)
        </button>
      )}
    </div>
  );
}
