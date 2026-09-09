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
