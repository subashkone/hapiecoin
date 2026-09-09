# Market Analytics · design notes (Phase 5 item 5)

Research and decision: `docs/research/market-analytics-data-sources.md`, ADR-038.

## 5.1 · Ingestion foundation (this PR)
Not a screen: the data path every analytics page will draw from. Traceability: it underpins HC-MA-012..087 and HC-MT-040..151; the page rows get their evidence in PRs 5.2–5.5.

### Job
Give every analytics chart a number it can name: which venues, how old, and whether it is stale. Within two seconds of opening any page the trader must see live figures with a source line, never a spinner that depends on a third party answering in the browser.

### Shape
```
providers ──► apps/ingest ──► Redis (hapiecoin:an:{dataset}:{key}) ──► API /v1/analytics/{dataset} ──► web
  Binance · Bybit · OKX        one snapshot per key,               public, Cache-Control,            source · as of ·
  CoinGecko · alternative.me   TTL 20 × interval, stale flag       X-As-Of, 503 until written        stale badge
```
- **Adapters** (`apps/ingest/src/adapters/*`): one class per provider, Zod-validated raw shapes, numbers coerced from the venues' strings. No key except CoinGecko's optional Demo key; nothing is logged but names and counts.
- **Jobs** (`jobs.ts`): funding (three venues + OI-weighted series), open interest (three venues + aggregated series + 1 h / 24 h change), long/short (Binance: global, top accounts, top positions), taker volume (Binance), liquidations (Binance stream + OKX polls into one deduplicated buffer), markets (CoinGecko), fear-greed (alternative.me). A venue failing is dropped from that refresh and from `source`.
- **Scheduler**: staggered first runs, one in-flight run per job, failure → previous snapshot re-written with `stale: true`. `/healthz` reports every job's runs, failures, last success and last error.
- **Store**: Redis with a 20 × interval TTL so a short outage serves stale data (flagged) instead of nothing; memory store in tests and in a dev shell without Redis.
- **API**: `GET /v1/analytics/{dataset}?symbol=` re-validates the JSON, sets `Cache-Control: public, max-age=ttl/4 (5–60 s)` and `X-As-Of`, answers 400 for a missing symbol on per-symbol datasets and 503 `UNAVAILABLE` until the ingest has written the key.

### Numbers
Funding rates are decimal fractions per 8 h (0.0001 = 0.01 %); `apr = rate × 3 × 365`. Open interest in USD (venue value fields, or base × mark). Long/short ratios as the venues publish them (ratio = long ÷ short). Liquidation USD = price × quantity. Every series point is `{ t: ms, v }`.

### Cadence and budget
| Dataset | Interval | Calls per refresh | Budget note |
|---|---|---|---|
| funding, open-interest, long-short, taker-volume × 10 symbols | 60 s | ~14 Binance + 3 Bybit + 4 OKX per symbol | Binance weight 2400/min: ~0.1 % used |
| liquidations | 15 s flush, stream live | 1 OKX poll per symbol | |
| markets | 10 min | 2 CoinGecko | 8.6k calls/month of the 10k Demo cap |
| fear-greed | 1 h | 1 | |

### States the pages must render (for PRs 5.2+)
fresh · stale (badge "stale since …") · unavailable (503: "Ingest has not written this dataset yet", never a blank chart) · partial (`source` lists fewer venues than expected: show the list, no warning icon).

### Tests
`apps/ingest` runs at the gateway's strictness (100 % lines/functions/statements, ≥ 95 % branches) against recorded provider shapes in `test-support/fixtures.ts`; no live endpoint is ever called (fake fetch, fake socket). API: `routes/analytics.test.ts` seeds the memory reader.

### Open
GAPS #55 (paid sources → coming-soon panels), #56 (history table for 90D/1Y chips).

## 5.2 · Shell, Markets Hub, Futures overview (PR #22)
Traceability: HC-MA-001, 003..037, 088..109; coin page tiles HC-MA-082, 083, 120. ADR-039.

### Job
The hub answers "what is the market doing right now" in one screen: open interest, liquidations, Fear & Greed, long/short and the derivatives table. The overview answers "which way is BTC leaning" with the OI and long/short charts. Within two seconds the tiles must show numbers with a source line under them.

### Layout
```
[app header · default]
[Δ Market Analytics  ← Analyse                       Search coin…  Ctrl K]
[Hub · Futures · Markets · Derivatives · Options · ETF · Liquidations · Whales · Sentiment · Terminal ▾]
hub:  tiles ×10 (5 per row) · source line · watchlist strip
      ┌ main table (tabs · search · columns · CSV) ────────────┐ ┌ gainers/losers ┐
      │                                                        │ │ heatmap        │
      └────────────────────────────────────────────────────────┘ │ ETF (soon)     │
overview: tiles ×8 · [BTC price & OI][BTC long/short] · [F&G gauge][gainers][losers] · [heatmap][ETF soon] · footer
```
At 390 px tiles go 2-up, the table scrolls inside its own container, side panels stack under the table.

### Hierarchy
Tiles carry the figures; the only amber is the gauge needle and the accent links. Green/red only in P&L-like cells (changes, long/short split, funding sign). Coming-soon blocks are dashed and muted.

### States
loading (skeleton charts, "—" tiles) · ready · unavailable (503 before the first ingest write: one dashed notice, tiles show "—") · stale (badge on the source line) · no CoinGecko (main table and gainers/losers explain the missing key) · deferred (coming soon with the gap number).

### Numbers
Compact USD (`$8.40B`), prices by magnitude, percents to two decimals with sign, funding to four decimals, long/short split as a two-colour bar. Every tile names its basis ("Tracked symbols · aggregated", "BTC global accounts").

### Interaction
Tabs, timeframe chips and legend items are buttons with `aria-selected`/`data-on`; table headers sort (▲▼), search filters, Columns ▾ toggles, CSV copies visible columns; row click opens the coin page; star toggles the watchlist. Coin search: arrow keys, Enter, Escape, outside click. Palette: `nav:analytics-hub`, `nav:analytics-overview`.

### Tests
Unit: `lib/analytics/analytics-lib.test.ts`, `components/analytics/analytics.test.tsx`. E2E: `analytics.spec.ts`. Visual: `analytics-hub-*`, `analytics-overview-*`. Mock data: `test/mock-analytics.ts`.

## 5.3 · Markets screener, Derivatives, Liquidations, coin-page charts (this PR)
Traceability: HC-MA-038..048, 060..066, 084..087, 110..113, 116, 121. ADR-040; gaps #57, #58.

### Job
The screener answers "which coin is moving, and where is the leverage" in one sortable table with compare. Derivatives answers "how crowded is this coin" (OI, funding, long/short, cross-venue funding spread). Liquidations answers "who just got flushed, on which side, where". The coin page puts all of it under one symbol. Within two seconds each page shows tiles with real numbers and a source line, or says which venue it is waiting for.

### Layout
```
markets:      [Compare · up to 3 coins (only when ?compare= or a Cmp box is ticked)]
              ┌ Futures Markets Screener · chips All/L1/L2/DeFi/Memes · ★ Watchlist ───┐
              │ search · rows · Columns ▾ · CSV | ★ Cmp Coin Price 24h% Cap Vol OI OI24h L/S │
              └ foot: N markets · hidden columns: 7d %, Funding, Liq 24h ────────────────┘
derivatives:  [Derivatives · sub · coin ▾ · Full coin analytics →]  tiles ×4
              [Close price (1D/7D)] [Open Interest (tf)]  ·  [Funding ± bars (7D..1Y)] [Global account ratio + 1.00]
              [Basis · coming soon #57]  ·  [Funding Rate Arbitrage table]
liquidations: tiles ×3 (Long / Short / Ratio with split bars) · source line
              [Nh Liquidations Over Time · chips 1h 4h 12h 24h] · [by Exchange hbars][Top Coins table + View all →]
              [Live Liquidation Feed · live dot · Min USD ▾]
coin:         [← Back to markets · BTC Bitcoin · $price · 24h · BTCUSDT perp · ☆ Watch · ⇄ Compare]  tiles ×6
              [Price & OI dual axis][Long/Short] · [Liquidations from events][OI-weighted funding]
              [Taker buy/sell 48h][Liquidation heatmap ±5% × 12h] · [Markets by Exchange][Funding by Exchange]
```
At 390 px tiles go 2-up (3-up for the liquidation trio collapse to 1-up), chart pairs stack, tables scroll inside their own container, the feed keeps its six columns and scrolls horizontally.

### Hierarchy
Numbers in tiles; green/red only for side, funding sign, long/short shares and 24 h changes. The only amber is the accent link ("Full coin analytics →", "View all markets →"). Compare and window chips are neutral segmented controls. Coming-soon and unavailable notices are dashed and muted.

### States
loading (skeleton charts, "—" tiles) · ready · unavailable (503: one dashed notice naming the dataset, tiles "—") · stale (badge on the source line) · venue-missing (chart empty state names the venue: "Long/short needs a venue that serves account ratios (Binance)") · buffer-capped ("The event buffer keeps the newest N liquidations, which do not reach back the full 4h") · no CoinGecko (screener shows the key notice; close-price chart says it needs the markets dataset) · unknown coin (notice with the tracked-symbol count).

### Numbers
Compact USD, prices by magnitude, funding to four decimals per 8 h with APR = rate × 3 × 365, spreads per 8 h and per day (× 3), long/short as ratio plus L/S shares, liquidation bias as a two-colour bar with the long share, heatmap bands as price levels (±1..±5 %), next funding as "1h 05m". Every panel names its basis ("OI-weighted · 8h", "spot · CoinGecko 7-day sparkline", "from the captured events").

### Interaction
Category chips push `?category=`; compare boxes (max 3, the rest disabled with a tooltip) and `?compare=`; coin selector replaces `?symbol=`; window chips and timeframe chips are `role=tab`; Min USD is a native select; row click opens the coin page; ★ toggles the persisted watchlist. Palette: `nav:analytics-markets`, `nav:analytics-derivatives`, `nav:analytics-liquidations`.

### Tests
Unit: `lib/analytics/derive.test.ts`, `components/analytics/analytics-pages.test.tsx`, colorNeg in `analytics-lib.test.ts`. E2E: three cases in `analytics.spec.ts`. Visual: `analytics-markets-*`, `analytics-derivatives-*`, `analytics-liquidations-*`, `analytics-coin-*`. Mock data: per-symbol and liquidation snapshots in `test/mock-analytics.ts` (snapshot time = current minute so 1 h and 12 h windows hold events).

### Real-data check
On the user's machine only Bybit is reachable (GAPS #57): open interest and funding show one venue, the arbitrage table is empty ("No coin has funding from two or more venues yet"), long/short and taker charts show the venue they wait for, the feed says "No liquidations captured yet". With Binance and OKX reachable all panels fill; with 500 tracked symbols the arbitrage fan-out becomes 500 requests per minute — cap ANALYTICS_SYMBOLS or add a server-side `funding-all` dataset before that.

## 5.3b · Ingest venue fallbacks (this PR)
Traceability: HC-MA-046, 060..066, 084 (data side). ADR-041; GAPS #57.

Long/short: Binance first (global, top accounts, top positions); Bybit global ratio when Binance fails, with empty top-trader series and `source: "Bybit"`. Liquidations: Binance `!forceOrder@arr` and Bybit `allLiquidation.{SYMBOL}USDT` streams share one buffer; `/healthz` shows `stream: { binance, bybit }`; the snapshot's `source` lists every connected venue. Web copy: the long/short empty state now names "Binance or Bybit". Unverified today and therefore not built: OKX taker-volume units, Bybit mark/index tickers for basis.

Tests: `liquidations.test.ts` (Bybit frame parsing, subscribe, ping loop bound to the current socket, reconnect), `jobs.test.ts` (fallback and both-fail paths), `app.test.ts` (two sockets, per-venue health), `config.test.ts` (BYBIT_WS_URL default).

## 5.4a · Options, Sentiment, ETF placeholder (this PR)
Traceability: HC-MA-049..059, 073..081, 114, 115, 118, 119. ADR-042; gaps #55, #59.

### Job
Options answers "where is the option book heavy and where does it hurt most at expiry" (OI per expiry, max pain, put/call, venue share). Sentiment answers "how stretched is the market" (Fear & Greed, cycle averages, rainbow band, Coinbase premium, RSI by timeframe). ETF keeps its slot honest until a flows provider exists.

### Layout
```
options:   [Deribit · Options · sub · coin ▾ · Deribit | Delta India]  tiles ×4 (OI USD · OI units + put/call · 24h vol · nearest max pain)
           [Open Interest by Expiry: call/put bars + amber max-pain line + $ labels]
           [OI by exchange donut][Options markets by exchange table]
sentiment: [F&G gauge + banded 90D chart][Bull-market peak checklist 8 rows, n/n triggered]
           [Pi Cycle (log)][Rainbow (log, 9 regions)]  ·  [AHR999 soon][Puell soon][2Y MA multiplier (log)]
           [Coinbase premium ± bars 1D/7D/30D · now / Coinbase / Binance]  ·  [RSI screener: star · search · Columns ▾ · CSV]
etf:       [Bitcoin | Ethereum]  tiles ×3 "—"  ·  net flows soon · cumulative soon · Grayscale soon · funds table soon
```
At 390 px the gauge stacks above its chart, chart pairs stack, tables scroll in their own container.

### Hierarchy
Amber only for the max-pain line and labels (HC-MA-114) and the gauge needle. Green/red for call/put bars, RSI zones, premium sign, hit rows. Coming-soon panels dashed and muted.

### States
loading · ready · unavailable (503 per dataset: each panel names the dataset or env it waits for) · stale badge · n/a rows in the checklist (never a fabricated verdict) · empty premium history ("fills hourly from now on") · 2-year MA note when the window is shorter than 730 days.

### Numbers
OI in underlying units with the symbol ("1.2K BTC") and in USD at the venue's underlying price; max pain as a price; put/call to two decimals; RSI to whole numbers with oversold < 30 / overbought > 70; premium in USD with sign; cycle prices compact on a log axis with 1-2-5 ticks.

### Interaction
Exchange chips and coin select rewrite `?symbol=&exchange=`; timeframe chips on F&G (7D..1Y), cycle (30D/90D/180D/ALL), premium (1D/7D/30D); RSI headers sort; star / search / Columns ▾ / CSV as on the other tables. Palette: `nav:analytics-options`, `nav:analytics-sentiment`.

### Tests
Unit: `analytics-lib.test.ts` (log axis, bands, regions, labels), `derive.test.ts` (rainbow regions, checklist), `analytics-pages2.test.tsx`. E2E: two cases in `analytics.spec.ts`. Visual: `analytics-options-*`, `analytics-sentiment-*`, `analytics-etf-*`. Ingest: `jobs.test.ts` (options fold, cycle, rsi, premium), adapters, store series.

### Real-data check (user's machine, 09 Sep)
Deribit BTC: $34.8B OI across 11 expiries, nearest max pain 79,000; Delta BTC: $672M across 7 expiries. Cycle: 1000 closes, 2-year averages present. RSI: 10 rows. Premium: −$51.88 on the first hour.
