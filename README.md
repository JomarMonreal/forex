# FX Compass

A forex dashboard built with Next.js. It lists popular pairs and gives each one a bull/bear probability for the **next hour, day, week and year**. The probability comes from two sources that are checked against each other: polled technical-indicator votes and AI analysis of live news.

> Educational tool, not financial advice.

## Run it

```bash
npm install
cp .env.example .env.local   # optional: add free API keys
npm run dev                  # http://localhost:3000
```

It works without any keys. Prices come from Yahoo Finance, news comes from central-bank RSS feeds and FXStreet, and the AI analysis uses Pollinations' free keyless GPT-OSS 20B.

### Start automatically with Windows
`start-server.cmd` runs `npm run dev` from the project folder and appends all output to `dev.log`, with a timestamped line at each start. A launcher in the Windows Startup folder (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\FX Compass.vbs`) runs it in a hidden window every time you log in:

```vbs
CreateObject("WScript.Shell").Run """C:\Users\Jom\Documents\forex\start-server.cmd""", 0, False
```

- The server starts when you **log in**, not at boot, and is up at http://localhost:3000 a few seconds later.
- **Start it now:** double-click `FX Compass.vbs`. No window appears; check `dev.log` to confirm it started.
- **Stop it:** end the `node.exe` process in Task Manager.
- **Turn off auto-start:** press Win+R, enter `shell:startup` and delete `FX Compass.vbs`.
- If port 3000 is already in use, Next.js picks the next free port. `dev.log` shows which one.

## Pages

| Page | What it shows |
|---|---|
| **Markets** (`/`) | 44 pairs (majors, minors, exotics): live price, 24h change, sparkline, which trading sessions are open, search and sort |
| **Top Picks** (`/top`) | Scans every pair and ranks all pair × horizon predictions by confidence. The single strongest call is shown at the top, and there's a "strongest consensus" section for pairs where all four horizons agree. You can filter by horizon, direction, "✔ Confirmed only" and "AI-checked only". Scans run in two phases: phase 1 is technical-only for all pairs and takes about 1 minute; phase 2 runs AI fundamentals one pair at a time, most promising first. Results refresh every `SCAN_REFRESH_MINUTES` (default 30). Set `SCAN_LLM_CONCURRENCY` to a value above 1 to speed up phase 2 if you use a faster provider such as Groq. |
| **Analyzer** (`/analyzer?pair=EURUSD`) | Four horizon cards with bull/bear %, the technical and fundamental scores, an agreement badge, a candlestick chart, the full vote table, detected candlestick patterns, the AI's reasons and the headlines it read |
| **News** (`/news`) | Live feed with currency and source filters, plus a health check for each source |
| **Performance** (`/performance`) | Backtest results per horizon (hit rate on unseen data vs the raw poll and simple baselines), a calibration chart, what each technique is worth, results by pair, and the live track record of every call the app has made |

## How the percentage is computed

### Technical: a weighted poll of about 18 techniques
Each horizon uses its own candle size: hour → 5-min, day → 1-h, week → daily, year → weekly.

- **Trend:** EMA 20/50 crossover, price vs SMA 200, ADX/DMI, Ichimoku cloud, Parabolic SAR, 30-bar linear-regression slope
- **Momentum:** RSI, MACD signal line and histogram slope, Stochastic, CCI, Williams %R, rate of change
- **Volatility:** Bollinger %B
- **Price action:** swing structure (higher highs/lows), support/resistance breaks
- **Candlesticks:** hammer, shooting star, engulfing, morning/evening star, three soldiers/crows, harami, piercing/dark cloud, tweezers, doji variants, marubozu, three inside up/down

Each technique votes bull, bear or neutral with a conviction from 0 to 1. The **raw poll** (`bull% = (bull points + ½·undecided) / total`, with hand-picked weights) is still shown, but it isn't what the app uses: the backtest showed its percentages are badly overconfident.

### Backtest and calibration (`src/lib/backtest/`)
- **Replay:** the exact vote code the live app uses (`votesAt`) is run on every past bar of all 44 pairs: 60 days of 5-min candles (hour), 2 years of hourly (day), 20 years of daily (week) and 20 years of weekly (year).
- **Scoring:** each call is graded 12 / 24 / 5 / 52 candles later. A move only counts as up or down if it beats a noise band, `max(spread, 0.15 × ATR% × √bars)`; smaller moves are excluded as flat.
- **Learned weights:** an L2-regularised logistic regression learns one weight per technique. It has no intercept, so all-neutral votes give exactly 50%, and EUR/USD-up always equals USD/EUR-down. Its output replaces the raw poll as the technical %.
- **Honest testing:** trained on the first 70% of each pair's history and scored on the last 30%, with a gap so outcomes can't leak across the split. Reported against the raw poll, against always betting the most common direction, and when entering one bar late (a real edge should survive that). Each horizon gets a verdict: proven / small / fragile / no proven edge.
- **Refresh:** runs automatically in the background (about 2–3 minutes) when missing or older than `BACKTEST_REFRESH_DAYS` (default 7). Results are saved to `data/backtest.json`.
- **Data fix:** Yahoo's FX opening prices are unreliable (daily opens sit about 0.2% from the prior close, which made half of all daily bars look like dojis). Candles are rebuilt so each one opens at the previous close, since FX trades continuously.

### Live track record (`src/lib/tracker.ts`)
Every full analysis logs its call: once per pair per 15 min (hour), 3 h (day), 1 day (week) or 1 week (year), and only while the market is open. Each call is graded after the same number of candles the backtest uses, using the same noise band. The Performance page shows hit rates for combined, technical-only and fundamental-only calls, and for confirmed vs conflicting calls. This is the only check of the AI fundamentals, since historical news can't be backtested. Calls are saved to `data/predictions.json`.

### Fundamental: news + a free AI model
- **Poller** (`src/lib/news/poller.ts`): runs every `NEWS_POLL_SECONDS` (default 180). It fetches the Finnhub forex news endpoint (needs a free key) and RSS feeds from the Fed, ECB, BoE, BoJ, BoC, SNB, RBNZ, RBA and FXStreet. It remembers every article ID it has already seen and saves them to `data/news.json`, so you are only alerted about articles you haven't seen yet. New articles go to the browser over Server-Sent Events, which show a toast and a desktop notification. Click **Enable alerts** to allow the notifications.
- **Currency tagging:** each article is tagged with the currencies it mentions, using keyword matching (for example, "BoJ" or "yen" tags JPY).
- **AI analysis** (`src/lib/fundamental/`): the model receives up to 40 recent headlines for the base and quote currency. It returns, for each horizon, the probability that the pair will be higher, a confidence level, and reasons that cite the headlines.

  Supported providers, in priority order: `LLM_BASE_URL` (any OpenAI-compatible endpoint), Groq, Gemini, OpenRouter, Ollama, then the keyless Pollinations default. If every model fails, the app falls back to keyword sentiment scoring (a hawkish/dovish and strong/weak-data word list).

### Combining and cross-checking
- **Fundamental weight by horizon:** hour 20%, day 35%, week 50%, year 65%. This weight is scaled down when the AI reports low confidence.
- **Agree** (both sides clearly bullish or both clearly bearish): marked **✔ Confirmed**, and the combined edge is boosted by 10%.
- **Disagree:** marked **⚠ Conflicting**, and the combined result is pulled 30% closer to 50%.

## Free keys (optional, each improves the results)
- `FINNHUB_API_KEY` from https://finnhub.io/register adds Finnhub's forex news.
- `GROQ_API_KEY` from https://console.groq.com/keys uses Llama 3.3 70B, which is faster and stronger than the keyless default.
- You can use `GEMINI_API_KEY`, `OPENROUTER_API_KEY` or `OLLAMA_MODEL` instead. See `.env.example`.

## Code map
```
src/lib/pairs.ts                 pair list
src/lib/prices.ts                Yahoo candles and quotes (cached)
src/lib/technical/indicators.ts  indicator math
src/lib/technical/patterns.ts    candlestick pattern detection
src/lib/technical/analyze.ts     vote poll
src/lib/news/                    sources, poller, dedupe, SSE events
src/lib/fundamental/             LLM client, AI and keyword analysis
src/lib/analysis.ts              combines both and cross-checks
src/lib/scanner.ts               market-wide scan and ranking for Top Picks
src/lib/backtest/                replay, learned weights, calibration, verdicts
src/lib/tracker.ts               live prediction log and grading
src/app/api/*                    analyze, quotes, news, news/stream
src/instrumentation.ts           starts the poller when the server boots
```
