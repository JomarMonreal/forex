import { promises as fs } from "fs";
import path from "path";
import { EventEmitter } from "events";
import { XMLParser } from "fast-xml-parser";
import { fetchRetry } from "../http";
import { CURRENCY_KEYWORDS, RSS_SOURCES, type FeedSource } from "./sources";

export interface NewsItem {
  id: string; // stable dedupe key (guid / finnhub id / link)
  title: string;
  summary: string;
  url: string;
  source: string;
  kind: "central-bank" | "market-news";
  publishedAt: number; // ms
  fetchedAt: number; // ms
  currencies: string[];
}

export interface SourceStatus {
  id: string;
  name: string;
  ok: boolean;
  lastRun?: number;
  items?: number;
  error?: string;
}

const DATA_DIR = path.join(process.cwd(), "data");
const STORE = path.join(DATA_DIR, "news.json");
const MAX_ITEMS = 1500;
const POLL_MS = Math.max(60, Number(process.env.NEWS_POLL_SECONDS ?? 180)) * 1000;

interface State {
  items: NewsItem[];
  seen: Set<string>;
  status: Map<string, SourceStatus>;
  emitter: EventEmitter;
  loaded: boolean;
  timer?: NodeJS.Timeout;
  polling?: Promise<NewsItem[]>;
  lastPoll?: number;
}

// Keep the poller as a process-wide singleton (survives Next.js hot reloads).
const g = globalThis as unknown as { __newsState?: State };
const state: State = (g.__newsState ??= {
  items: [],
  seen: new Set(),
  status: new Map(),
  emitter: new EventEmitter().setMaxListeners(100),
  loaded: false,
});

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#text" });

const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return text(o["#text"] ?? o["@href"] ?? "");
  }
  return "";
};

const stripHtml = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

// Whole-word matching so "rand" doesn't hit "brand" and "fed" doesn't hit "fedex".
const KEYWORD_RES: [string, RegExp][] = Object.entries(CURRENCY_KEYWORDS).map(([ccy, words]) => [
  ccy,
  new RegExp(
    `(?<![a-z])(${words.map((w) => w.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![a-z])`,
  ),
]);

export function tagCurrencies(textBody: string, defaults: string[] = []): string[] {
  const t = textBody.toLowerCase();
  const found = new Set(defaults);
  for (const [ccy, re] of KEYWORD_RES) if (re.test(t)) found.add(ccy);
  // Explicit pair mentions like "EUR/USD" or "USDJPY".
  for (const m of textBody.toUpperCase().matchAll(/\b([A-Z]{3})\/?([A-Z]{3})\b/g)) {
    if (CURRENCY_KEYWORDS[m[1]] && CURRENCY_KEYWORDS[m[2]]) {
      found.add(m[1]);
      found.add(m[2]);
    }
  }
  return [...found];
}

async function fetchRss(src: FeedSource): Promise<NewsItem[]> {
  const res = await fetchRetry(src.url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    },
    timeoutMs: 12000,
  }, 1);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const doc = parser.parse(xml);
  const raw: Record<string, unknown>[] = [
    doc?.rss?.channel?.item,
    doc?.["rdf:RDF"]?.item,
    doc?.feed?.entry,
  ]
    .filter(Boolean)
    .flatMap((x) => (Array.isArray(x) ? x : [x]));
  const now = Date.now();
  return raw.slice(0, 50).map((it) => {
    const link = text(it.link) || text(it.guid) || text(it.id);
    const title = stripHtml(text(it.title));
    const summary = stripHtml(text(it.description ?? it.summary ?? it.content)).slice(0, 600);
    const date = text(it.pubDate ?? it["dc:date"] ?? it.published ?? it.updated);
    const ts = Date.parse(date);
    return {
      id: `${src.id}:${text(it.guid) || link || title}`,
      title,
      summary,
      url: link,
      source: src.name,
      kind: src.kind,
      publishedAt: isNaN(ts) ? now : ts,
      fetchedAt: now,
      currencies: tagCurrencies(`${title} ${summary}`, src.currencies),
    };
  });
}

async function fetchFinnhub(): Promise<NewsItem[]> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new Error("FINNHUB_API_KEY not set (optional)");
  const res = await fetchRetry(`https://finnhub.io/api/v1/news?category=forex&token=${key}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const arr = (await res.json()) as {
    id: number;
    headline: string;
    summary: string;
    url: string;
    datetime: number;
    source: string;
  }[];
  const now = Date.now();
  return arr.map((a) => ({
    id: `finnhub:${a.id}`,
    title: a.headline,
    summary: (a.summary ?? "").slice(0, 600),
    url: a.url,
    source: `Finnhub · ${a.source}`,
    kind: "market-news" as const,
    publishedAt: a.datetime * 1000,
    fetchedAt: now,
    currencies: tagCurrencies(`${a.headline} ${a.summary}`),
  }));
}

async function load() {
  if (state.loaded) return;
  state.loaded = true;
  try {
    const items = JSON.parse(await fs.readFile(STORE, "utf8")) as NewsItem[];
    state.items = items;
    items.forEach((i) => state.seen.add(i.id));
  } catch {
    /* first run */
  }
}

async function save() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STORE, JSON.stringify(state.items));
}

/** Poll every source once; returns only items never seen before. */
export function pollOnce(): Promise<NewsItem[]> {
  if (state.polling) return state.polling;
  state.polling = (async () => {
    await load();
    const firstRun = state.items.length === 0;
    const jobs: [string, string, () => Promise<NewsItem[]>][] = [
      ["finnhub", "Finnhub (forex)", fetchFinnhub],
      ...RSS_SOURCES.map((s) => [s.id, s.name, () => fetchRss(s)] as [string, string, () => Promise<NewsItem[]>]),
    ];
    const results = await Promise.allSettled(jobs.map(([, , fn]) => fn()));
    const fresh: NewsItem[] = [];
    results.forEach((r, idx) => {
      const [id, name] = jobs[idx];
      if (r.status === "fulfilled") {
        state.status.set(id, { id, name, ok: true, lastRun: Date.now(), items: r.value.length });
        for (const item of r.value) {
          if (!item.title || state.seen.has(item.id)) continue;
          state.seen.add(item.id);
          fresh.push(item);
        }
      } else {
        state.status.set(id, { id, name, ok: false, lastRun: Date.now(), error: String(r.reason?.message ?? r.reason) });
      }
    });
    if (fresh.length) {
      state.items = [...fresh, ...state.items].sort((a, b) => b.publishedAt - a.publishedAt).slice(0, MAX_ITEMS);
      await save();
      // Don't flood the user with alerts for the initial backfill.
      if (!firstRun) state.emitter.emit("news", fresh);
    }
    state.lastPoll = Date.now();
    return fresh;
  })().finally(() => (state.polling = undefined));
  return state.polling;
}

export function startPoller() {
  if (state.timer) return;
  pollOnce().catch((e) => console.error("[news] poll failed", e));
  state.timer = setInterval(() => pollOnce().catch((e) => console.error("[news] poll failed", e)), POLL_MS);
  console.log(`[news] poller started, every ${POLL_MS / 1000}s`);
}

export async function getNews(opts: { currencies?: string[]; sinceMs?: number; limit?: number } = {}) {
  startPoller();
  await load();
  if (!state.items.length) await pollOnce();
  let items = state.items;
  if (opts.sinceMs) items = items.filter((i) => i.publishedAt >= opts.sinceMs!);
  if (opts.currencies?.length) items = items.filter((i) => i.currencies.some((c) => opts.currencies!.includes(c)));
  return items.slice(0, opts.limit ?? 200);
}

export function getStatus() {
  return { sources: [...state.status.values()], lastPoll: state.lastPoll, intervalSec: POLL_MS / 1000, total: state.items.length };
}

export function onNews(fn: (items: NewsItem[]) => void) {
  state.emitter.on("news", fn);
  return () => state.emitter.off("news", fn);
}
