import "server-only";
import type { ForexPair } from "../pairs";
import type { Horizon } from "../prices";
import { getNews, tagCurrencies, type NewsItem } from "../news/poller";
import { chatJson, getLlmConfig } from "./llm";

export interface FundamentalHorizon {
  bullPct: number; // probability-style score that BASE strengthens vs QUOTE
  confidence: number; // 0..1, how much evidence there is
  reasons: string[];
}

export interface FundamentalResult {
  engine: string; // e.g. "Groq · llama-3.3-70b-versatile" or "Keyword sentiment (fallback)"
  horizons: Record<Horizon, FundamentalHorizon>;
  summary: string;
  headlines: Pick<NewsItem, "id" | "title" | "url" | "source" | "publishedAt" | "currencies">[];
  error?: string;
  generatedAt: number;
}

const HOUR = 3600_000;
const cache = new Map<string, { key: string; at: number; data: FundamentalResult }>();
const CACHE_MS = 15 * 60_000;

export async function analyzeFundamental(pair: ForexPair): Promise<FundamentalResult> {
  const news = await getNews({ currencies: [pair.base, pair.quote], sinceMs: Date.now() - 30 * 24 * HOUR, limit: 60 });
  // Re-run only when there's new relevant news or the cache is stale.
  const key = news.slice(0, 5).map((n) => n.id).join("|");
  const hit = cache.get(pair.symbol);
  // Failed LLM runs are retried sooner than successful ones.
  const ttl = hit?.data.error ? 2 * 60_000 : CACHE_MS;
  if (hit && hit.key === key && Date.now() - hit.at < ttl) return hit.data;

  const headlines = news.slice(0, 40).map(({ id, title, url, source, publishedAt, currencies }) => ({ id, title, url, source, publishedAt, currencies }));
  const cfg = getLlmConfig();
  let data: FundamentalResult;
  if (cfg && news.length) {
    try {
      data = { ...(await llmAnalysis(pair, news, cfg)), headlines, generatedAt: Date.now() };
    } catch (e) {
      data = { ...keywordAnalysis(pair, news), headlines, error: `LLM failed, used keyword fallback: ${(e as Error).message}`, generatedAt: Date.now() };
    }
  } else {
    data = {
      ...keywordAnalysis(pair, news),
      headlines,
      error: cfg ? undefined : "No LLM configured — using keyword sentiment. Add GROQ_API_KEY (or GEMINI/OPENROUTER/OLLAMA) in .env.local, or unset DISABLE_KEYLESS_LLM, for AI analysis.",
      generatedAt: Date.now(),
    };
  }
  cache.set(pair.symbol, { key, at: Date.now(), data });
  return data;
}

// ---------------------------------------------------------------- LLM path

interface LlmOut {
  summary: string;
  horizons: Record<Horizon, { bull_probability: number; confidence: number; reasons: string[] }>;
}

async function llmAnalysis(pair: ForexPair, news: NewsItem[], cfg: NonNullable<ReturnType<typeof getLlmConfig>>) {
  const now = Date.now();
  const lines = news.slice(0, 40).map((n, i) => {
    const age = (now - n.publishedAt) / HOUR;
    const ageStr = age < 24 ? `${age.toFixed(1)}h ago` : `${(age / 24).toFixed(1)}d ago`;
    return `[${i + 1}] (${ageStr}; ${n.source}; tags ${n.currencies.join(",")}) ${n.title}${n.summary ? ` — ${n.summary.slice(0, 220)}` : ""}`;
  });

  const system = `You are a professional forex fundamental analyst. You assess how news flow (central bank policy, interest-rate expectations, inflation, growth, employment, trade, risk sentiment, geopolitics, commodity prices) affects currency pairs. You are calibrated and honest: when news is thin, mixed or irrelevant, stay near 50 and lower your confidence. Respond with JSON only.`;

  const user = `Pair: ${pair.base}/${pair.quote}. "Bullish" means ${pair.base} strengthens against ${pair.quote} (price goes up).
Current time: ${new Date(now).toISOString()}.

Recent news (newest first):
${lines.join("\n")}

For each horizon estimate the probability (0-100) that ${pair.base}/${pair.quote} will be HIGHER at the end of the horizon, based ONLY on fundamentals in these articles plus well-known macro context:
- hour: only very fresh, market-moving news matters (last few hours, scheduled releases).
- day: news from the last ~1-2 days and imminent events.
- week: central bank tone, data surprises and events of the coming week.
- year: monetary policy divergence, rate differentials, growth/inflation trends, structural factors.

Return exactly this JSON shape:
{"summary": "2-3 sentence overview of the fundamental picture",
 "horizons": {
   "hour": {"bull_probability": 0-100, "confidence": 0-1, "reasons": ["short reason citing [n] article numbers", "..."]},
   "day":  {...}, "week": {...}, "year": {...}
 }}
Give 2-4 reasons per horizon.`;

  const out = await chatJson<LlmOut>(cfg, system, user);
  const horizons = {} as Record<Horizon, FundamentalHorizon>;
  for (const h of ["hour", "day", "week", "year"] as Horizon[]) {
    const v = out.horizons?.[h];
    horizons[h] = {
      bullPct: clamp(Number(v?.bull_probability ?? 50), 1, 99),
      confidence: clamp(Number(v?.confidence ?? 0.3), 0, 1),
      reasons: (v?.reasons ?? []).slice(0, 5).map((r) => linkRefs(String(r), news)),
    };
  }
  return { engine: `${cfg.provider} · ${cfg.model}`, horizons, summary: linkRefs(out.summary ?? "", news) };
}

/** Replace "[3]" references with the article's title snippet so reasons stand on their own. */
function linkRefs(s: string, news: NewsItem[]) {
  return s.replace(/\[(\d+)\]/g, (m, n) => {
    const item = news[Number(n) - 1];
    return item ? `[“${item.title.slice(0, 70)}${item.title.length > 70 ? "…" : ""}”]` : m;
  });
}

// ---------------------------------------------------------- keyword fallback

// Words that point to a currency strengthening (+) or weakening (−) when it's the article's subject.
const LEXICON: [RegExp, number, string][] = [
  [/\b(hawkish|rate hike|hikes? rates|raise[sd]? rates|tighten(ing)?|higher for longer)\b/i, 2, "hawkish policy"],
  [/\b(dovish|rate cut|cuts? rates|lower(s|ed)? rates|eas(e|ing)|stimulus|quantitative easing)\b/i, -2, "dovish policy"],
  [/\b(beat|beats|stronger[- ]than[- ]expected|surge[sd]?|jump(s|ed)?|soar(s|ed)?|robust|upbeat|accelerat\w+)\b/i, 1, "strong data"],
  [/\b(miss(es|ed)?|weaker[- ]than[- ]expected|slump(s|ed)?|plunge[sd]?|contract(s|ion)|recession|slowdown|decline[sd]?)\b/i, -1, "weak data"],
  [/\b(inflation (rises|rose|accelerates|hotter)|sticky inflation|price pressures)\b/i, 1, "inflation pressure (rate support)"],
  [/\b(rall(y|ies|ied)|gain(s|ed)?|climb(s|ed)?|strengthen(s|ed)?|firm(s|er)?|advance[sd]?)\b/i, 1, "price strength"],
  [/\b(fall(s|en)?|fell|drop(s|ped)?|slide[sd]?|weaken(s|ed)?|tumble[sd]?|sell-?off|retreat(s|ed)?)\b/i, -1, "price weakness"],
  [/\b(intervention|intervene)\b/i, 1, "intervention risk"],
];

function keywordAnalysis(pair: ForexPair, news: NewsItem[]): Omit<FundamentalResult, "headlines" | "generatedAt"> {
  const now = Date.now();
  const windows: Record<Horizon, number> = { hour: 6 * HOUR, day: 48 * HOUR, week: 10 * 24 * HOUR, year: 30 * 24 * HOUR };
  const horizons = {} as Record<Horizon, FundamentalHorizon>;
  for (const h of Object.keys(windows) as Horizon[]) {
    let score = 0, evidence = 0;
    const reasons: { w: number; text: string }[] = [];
    for (const n of news) {
      const age = now - n.publishedAt;
      if (age > windows[h]) continue;
      const recency = 1 - age / windows[h] / 2; // newer = heavier
      const body = `${n.title}. ${n.summary}`;
      // The headline names the article's subject; summaries mention many currencies in passing.
      const titleTags = tagCurrencies(n.title, n.kind === "central-bank" ? n.currencies : []);
      const subject = titleTags.length ? titleTags : n.currencies;
      const aboutBase = subject.includes(pair.base), aboutQuote = subject.includes(pair.quote);
      if (aboutBase === aboutQuote) continue; // ambiguous for this pair
      // Headlines led by a third currency ("Indian Rupee … against US Dollar") aren't about this pair.
      if (titleTags.some((c) => c !== pair.base && c !== pair.quote)) continue;
      let s = 0;
      const hitsTxt: string[] = [];
      for (const [re, w, label] of LEXICON) {
        if (re.test(body)) {
          s += w;
          hitsTxt.push(label);
        }
      }
      if (!s) continue;
      // Central bank statements are more market-moving, especially for long horizons.
      const kindW = n.kind === "central-bank" ? (h === "year" || h === "week" ? 2 : 1.5) : 1;
      const signed = (aboutBase ? s : -s) * recency * kindW;
      score += signed;
      evidence += Math.abs(signed);
      reasons.push({
        w: Math.abs(signed),
        text: `${signed > 0 ? "Supports" : "Weighs on"} ${pair.base}/${pair.quote}: ${hitsTxt.join(", ")} for ${aboutBase ? pair.base : pair.quote} — “${n.title.slice(0, 90)}”`,
      });
    }
    // A keyword lexicon is a blunt tool, so keep its calls modest and its confidence low.
    const bull = 50 + 25 * Math.tanh(score / 8);
    horizons[h] = {
      bullPct: clamp(bull, 25, 75),
      confidence: clamp(evidence / 30, 0.05, 0.35),
      reasons: reasons.length
        ? reasons.sort((a, b) => b.w - a.w).slice(0, 4).map((r) => r.text)
        : ["No clearly directional news for this pair in this window — fundamentals neutral."],
    };
  }
  return {
    engine: "Keyword sentiment (fallback)",
    horizons,
    summary: `Scored ${news.length} recent articles tagged ${pair.base} or ${pair.quote} using a hawkish/dovish & strong/weak data lexicon.`,
  };
}

const clamp = (v: number, lo: number, hi: number) => (isFinite(v) ? Math.min(hi, Math.max(lo, v)) : (lo + hi) / 2);
