# Market Analytics · data-source research (Phase 5 item 5)

Date: 09 Sep 2026 · Author: Claude with Subash · Status: research for ADR-038 (not yet decided in code)
Decision taken in chat: hybrid — free public feeds first, paid providers only when users ask, "coming soon" for on-chain and ETF-flow screens.

## 1. What the block is, and where it lives

### In HapieCoin (spec)
294 Phase 5 rows across 29 screens under two route families. Sources: `spec/traceability.json`, `mockup-v2/features/50-analytics.json`, `60-terminal.json`.

| Route family | Screens | Rows | Notes |
|---|---|---|---|
| `/analytics` → `/analytics/coinglass` | Markets Hub (stat tiles, derivatives/spot/categories tables, gainers, heatmap, ETF inflow table) | 21 | The hub the reference copied from Coinglass; the spec names it |
| `/analytics/*` shell | header, section switcher, chart helper, DataTable, timeframe chips, CSV, watchlist | 26 | Shared UI, no data of its own |
| `/analytics/overview` | Futures overview (OI, volume, liquidations, F&G, BTC/ETH price, dominance, L/S) | 10 | Footer literally says "Data via Coinglass · auto-refreshing every 60s" |
| `/analytics/markets` | Futures screener (coin, price, cap, volume, OI, L/S, funding) | 6 | |
| `/analytics/derivatives` | per-coin OI by exchange, OI-weighted funding, L/S, basis, funding arbitrage | 9 | |
| `/analytics/options` | options OI per expiry with max pain, OI by exchange (Deribit/OKX/Binance/Bybit/Delta) | 6 | Our own domain; Delta is one of the exchanges |
| `/analytics/etf` | BTC/ETH spot ETF flows, AUM, per-fund holdings, Grayscale premium | 7 | |
| `/analytics/liquidations` | long/short liquidations over time, by exchange, top coins, live feed | 8 | |
| `/analytics/whales` | Hyperliquid whale positions, large limit orders, exchange BTC reserves | 7 | |
| `/analytics/sentiment` | Fear & Greed, cycle-top checklist, Pi Cycle, Rainbow, AHR999, Puell, 2Y MA, Coinbase premium, RSI screener | 11 | |
| `/analytics/coin/:symbol` | per-coin OI, L/S, liquidations, funding, taker volume, heatmap, markets by exchange | 8 | |
| `/terminal` shell + Dashboard | sidebar terminal, dashboard tiles/charts/tables | 58 | Second app in the reference (its analytics subdomain mounted at /terminal) |
| `/terminal/spot`, `/sectors/:slug`, `/exchanges/:exchange`, `/coin/:symbol` | screeners and detail pages | 51 | |
| `/terminal/derivatives/{open-interest,funding,long-short,liquidations}` | derivatives pages | 25 | |
| `/terminal/etf`, `/onchain/exchange-balance`, `/onchain/unlocks` | ETF, on-chain | 23 | Unlocks already specced as "data unavailable" |
| `/terminal/indicators/{fear-greed,cycle}` | indexes | 11 | |

Entry points already built: landing "Explore Analytics →" (`/analytics`), the settings menu "Market Analytics" item, palette `nav:analytics`, and the `/analytics` placeholder route (HC-SH-016 keeps the default header).

### In the reference
The reference runs a second app (a separate analytics subdomain) for liquidations, funding, OI, whales, ETF and on-chain, mounted under `/terminal/*` in the main app, plus a `/analytics/coinglass` hub. Its pages mirror Coinglass's layout and vocabulary (OI-weighted funding, global account ratio, liquidation heatmap, ETF net inflow table). Source: the reference-site facts memory note (bundle reverse-engineered 04 Sep 2026).

## 2. Data categories and candidate sources

Verified = checked on 09 Sep 2026 against the linked page; prices and limits change, re-check before signing anything.

### A. Venue derivatives (funding, OI, long/short, liquidations, taker volume) — FREE, public
| Source | Endpoints (public, no key) | Limits | Notes |
|---|---|---|---|
| Binance USDⓈ-M | `GET /fapi/v1/fundingRate`, `GET /fapi/v1/openInterest`, `GET /futures/data/openInterestHist`, `/futures/data/globalLongShortAccountRatio`, `/futures/data/topLongShortAccountRatio`, `/futures/data/topLongShortPositionRatio`, `/futures/data/takerlongshortRatio`; WS liquidation stream `!forceOrder@arr` | REQUEST_WEIGHT 2400/min (verified); the `/futures/data/*` statistics keep only the last 30 days, `limit` default 30 max 500 (verified) | Exactly the series the spec's L/S chart needs (Global / Top-trader accounts / Top-trader positions). Liquidation stream pushes at most one order per symbol per second (from docs, verify the exact wording) |
| Bybit v5 | `GET /v5/market/funding/history`, `GET /v5/market/open-interest`, `GET /v5/market/account-ratio`; WS `allLiquidation.{symbol}` | WebSocket not counted against REST limits (verified) | |
| OKX v5 | `/api/v5/public/funding-rate-history`, `/api/v5/public/open-interest`, `/api/v5/public/liquidation-orders`; `/api/v5/rubik/stat/contracts/long-short-account-ratio` | Funding settles 00/08/16 UTC (verified); liquidation channel ≤1 update/s per contract | |
| Delta Exchange India | `GET /v2/tickers` (OI, funding, mark, IV for options), history candles incl. funding and OI series | Already integrated in `packages/venues` | Feeds the Options page's Delta column and our own funding/OI |
| Deribit | `public/get_book_summary_by_currency?currency=BTC&kind=option` → OI, volume per instrument; WS `ticker.{instrument}` | Public, no auth; rate limit not stated on the page (verify) | Options OI per expiry and max pain — the spec's `/analytics/options` header says "Deribit · Options" |
| Hyperliquid | `POST /info` `{type:"clearinghouseState", user}` — any address, public, no key | Not documented on the pages found (verify) | Basis of every Hyperliquid leaderboard/whale tool; whale positions need a wallet list (leaderboard endpoint or curated addresses) |

### B. Spot market data (prices, caps, volumes, categories, coin metadata) — FREE tier, key required
| Source | Plan | Limits | Notes |
|---|---|---|---|
| CoinGecko Demo | free, key required | 10,000 calls/month; 100 calls/min per the current pricing page (older sources say 30/min) — verified; Basic $35/mo = 300/min, 100k/month; Analyst $129, Lite $499 | 10k/month is ~13 calls/hour: enough for markets-hub and coin pages refreshed every 5–10 min, not for per-second tiles. Attribution required |

### C. Indexes and schedules
| Source | Cost | Notes |
|---|---|---|
| alternative.me Fear & Greed `https://api.alternative.me/fng/?limit=0` | free, no key, no documented cap (verified) | Whole history in one call: gauge, 90-day chart, yesterday/7d/30d tiles |
| Cycle indicators (Pi Cycle, Rainbow, 2Y MA, AHR999, Puell) | computed by us from daily BTC close (CoinGecko or exchange candles) + miner revenue for Puell (needs an on-chain source) | Pi Cycle/Rainbow/2Y MA/AHR999 are pure price maths; Puell needs miner revenue → defer or use a free blockchain API |
| Token unlocks | DefiLlama Pro API $300/mo (unlocks are Pro-only — verified); free alternatives are scraped | Spec already ships this panel as "Token unlock data unavailable" → keep |
| Gold futures / DXY tiles | Yahoo-style quote feeds have no official free API | Drop or "coming soon" |

### D. On-chain and flows — PAID (defer)
| Source | Cost | Covers |
|---|---|---|
| Farside Investors | free website tables (farside.co.uk/btc/); no official API — third-party wrappers exist | Daily US spot BTC/ETH ETF flows per ticker. Scraping their page for a product is a ToS question; ask Farside or use Coinglass ETF endpoints |
| Coinglass API | $29 Hobbyist → $699 Professional/mo; commercial use needs Standard $299+; rpm caps 30/80/300/1200 (verified) | Everything on the hub in one contract incl. ETF flows, liquidation heatmap (a derived model), exchange balances |
| CryptoQuant | API from Professional $99/mo (verified) | Exchange reserves, whale ratio, Coinbase premium, miner data |
| Glassnode | full API on Professional ~ $999/mo; Advanced $49 has a 50-calls/day "Light API" (verified) | On-chain reserves, Puell, etc. |
| Whale Alert | Alerts $29.95/mo personal-only; Quantitative/Enterprise on request (verified) | Large on-chain transfers (not in our spec directly; whales page is Hyperliquid + limit orders + reserves) |

## 3. Coverage board (what v1 ships with the hybrid)

| Screen | v1 source | Cost | v1 status |
|---|---|---|---|
| Markets Hub tiles: OI, liquidations, L/S, dominance, F&G | Binance/Bybit/OKX + CoinGecko global + alternative.me | 0 | build |
| Markets Hub tiles: exchange balance, gold/DXY, altcoin season, avg RSI | needs on-chain / equities feeds; RSI computable from candles | 0 | RSI build; balance/gold/DXY "coming soon" |
| Hub tables: derivatives, spot, categories, gainers/losers, heatmap | CoinGecko (spot) + exchange OI/funding/liq per coin | 0 | build (top 50–100 coins) |
| Hub/overview ETF inflow table, `/analytics/etf`, `/terminal/etf` | Farside/Coinglass | paid or ToS | "coming soon" |
| Futures overview, screener, derivatives, coin pages, terminal derivatives pages | exchange public APIs (three venues aggregated) | 0 | build |
| Options page | Deribit public + Delta + OKX/Bybit/Binance options tickers | 0 | build (Deribit + Delta first) |
| Liquidations page + live feed | Binance/Bybit/OKX liquidation streams | 0 | build; heatmap = our own estimate from OI and leverage bands, labelled as such |
| Whales: Hyperliquid positions | Hyperliquid info API | 0 | build (top wallets from a leaderboard fetch) |
| Whales: large limit orders | Binance depth snapshots (`/fapi/v1/depth`) | 0 | build, threshold configurable |
| Whales: exchange BTC reserves, `/onchain/exchange-balance` | CryptoQuant/Glassnode | paid | "coming soon" |
| Sentiment: F&G, Pi Cycle, Rainbow, 2Y MA, AHR999, RSI screener | alternative.me + our maths on candles | 0 | build |
| Sentiment: Puell, Coinbase premium, cycle-top checklist | miner revenue (on-chain) / Coinbase vs Binance spot | Coinbase premium is free (Coinbase public ticker); Puell paid | premium build; Puell + checklist partial |
| Token unlocks | DefiLlama Pro | $300/mo | keep the specced "unavailable" panel |

Rough count: about 230 of 294 rows are buildable at zero data cost; about 60 depend on paid or ToS-sensitive sources and ship as "coming soon" panels in the same style as the exchanges section.

## 4. Who implements these screens (reference implementers)
- Coinglass — the template for the hub, overview, liquidations and ETF pages; broad exchange coverage, derived liquidation heatmap. https://www.coinglass.com/
- Hyblock Capital — trader-facing liquidation heatmaps and derivatives indicators; free tier limited to majors. https://hyblockcapital.com/
- Velo Data — free liquidation/OI dashboards aimed at institutions. https://velo.xyz/
- Laevitas — options-first analytics (term structure, skew, max pain), API-first enterprise pricing. https://laevitas.ch/
- CryptoQuant — exchange flows, whale ratio, Coinbase premium. https://cryptoquant.com/
- Glassnode — on-chain metrics, Puell, reserves. https://glassnode.com/
- Farside Investors — the canonical ETF flow table. https://farside.co.uk/btc/
- alternative.me — Fear & Greed index and API. https://alternative.me/crypto/fear-and-greed-index/
- Deribit Insights — max-pain method with code. https://insights.deribit.com/dev-hub/deribit-max-pain-python-code/
- Hyperliquid leaderboard/copy-trading tools — built on the public info API.

## 5. Proposed architecture (for ADR-038)
- New service `apps/ingest` (Node, same stack as the gateway): one adapter per source, each with a schedule, a rate budget and a normaliser to our schema (`packages/schema/src/analytics.ts`). Adapters never run in the browser; provider keys only via env.
- Storage: Redis for the latest snapshot per dataset (TTL = refresh interval) and Postgres tables for history we must keep beyond the provider's window (Binance stats are 30 days only; we want 1Y chips).
- Serving: `GET /v1/analytics/{dataset}` on the API with `Cache-Control` and an `asOf` timestamp on every payload; the web app shows "as of" and the source name under each chart (the spec's "intervals vary per dataset" footer becomes real).
- Refresh cadence: liquidation feed live (WS), OI/funding/L/S every 60 s, spot markets every 5 min (CoinGecko budget), F&G hourly, cycle indicators daily.
- Fallbacks: a stale snapshot is served with a "stale since" badge rather than an empty chart; a source outage never blanks a page.
- Aggregation rules stated in the UI: "Aggregated across Binance · OKX · Bybit" (as the spec says) and never "all exchanges".

## 6. Terms-of-use notes
- Exchange public market data is free to consume; check each ToS for redistribution/attribution wording before launch.
- CoinGecko Demo requires attribution and is for non-commercial or low-volume use; a paid Basic plan is the safe commercial floor.
- Coinglass: commercial use requires the Standard tier or above.
- Farside: no official API; do not scrape for a paid product without permission.

## 7. Open questions for the ADR
1. Confirm Deribit and Hyperliquid unauthenticated rate limits from their docs before sizing refresh intervals.
2. Whether to buy CoinGecko Basic ($35/mo) at launch to lift the 10k/month cap, or start on Demo with 10-minute refreshes.
3. Whether "coming soon" panels for ETF flows, exchange balances and unlocks are acceptable in v1 (agreed in chat: yes).
4. Budget ceiling: agreed "zero for now"; revisit when usage data exists.

Sources consulted (09 Sep 2026): Binance developer docs (funding rate history, open interest statistics, long/short ratio, top trader ratios), Bybit v5 docs (funding history, open interest), OKX v5 public data, CoinGecko pricing page and free-tier guides, Coinglass pricing reviews, alternative.me API docs, Farside Investors, DefiLlama pro-api docs, Glassnode/CryptoQuant comparisons and CryptoQuant docs, Whale Alert pricing, Delta Exchange docs, Deribit API reference, Hyperliquid info API references, liquidation-heatmap platform comparisons.

## 8. Source links (consulted 09 Sep 2026)
- Binance: [funding rate history](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Get-Funding-Rate-History), [open interest statistics](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Open-Interest-Statistics), [long/short ratio](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Long-Short-Ratio), [top trader ratio](https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Top-Long-Short-Account-Ratio)
- Bybit: [funding history](https://bybit-exchange.github.io/docs/v5/market/history-fund-rate), [open interest](https://bybit-exchange.github.io/docs/v5/market/open-interest)
- OKX: [funding rate guide](https://github.com/lxdys649/okx-funding-rate-api), [futures data details](https://docs.tardis.dev/historical-data-details/okex-futures)
- CoinGecko: [pricing](https://www.coingecko.com/en/api/pricing), [free API guide](https://www.coingecko.com/learn/best-free-crypto-api)
- Coinglass: [API review](https://dev.to/great-time-flies/coinglass-api-review-2026-is-it-worth-it-for-crypto-quant-traders-2bcf), [pricing](https://comparedge.com/tools/coinglass/pricing), [site](https://www.coinglass.com/)
- alternative.me: [API docs](https://alternative.me/crypto/api/)
- Farside Investors: [Bitcoin ETF flows](https://farside.co.uk/btc/)
- DefiLlama: [Pro API](https://docs.llama.fi/pro-api)
- Glassnode / CryptoQuant: [comparison](https://www.spark.money/tools/bitcoin-onchain-analytics-comparison), [CryptoQuant docs](https://cryptoquant.com/docs)
- Whale Alert: [pricing](https://developer.whale-alert.io/pricing.html)
- Delta Exchange: [API docs](https://docs.delta.exchange/)
- Deribit: [book summary endpoint](https://docs.deribit.com/api-reference/market-data/public-get_book_summary_by_currency), [max pain method](https://insights.deribit.com/dev-hub/deribit-max-pain-python-code/)
- Hyperliquid: [clearinghouseState](https://docs.chainstack.com/reference/hyperliquid-info-clearinghousestate)
- Liquidation heatmap platforms: [comparison](https://www.bitget.com/academy/crypto-liquidation-m), [Hyblock](https://hyblockcapital.com/)

A styled copy of this research is kept next to this file as `market-analytics-data-sources.html` (same content, opens in any browser).
