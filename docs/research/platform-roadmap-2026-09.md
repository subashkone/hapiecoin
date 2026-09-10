# Platform assessment and roadmap (10 Sep 2026)

Status: written for the user's review after seven questions on strategies, markets, currency, language, features,
scale and security, and mobile. Every claim below was checked in the repo in this session; file:line references
are to `main` at the merge of PR #47. Anything not verified says so.

## 1. Are the strategies well tested and cross-checked with the industry?

**What exists.** Exactly 28 option-only templates in one file, `apps/web/src/lib/strategy/templates.ts:33-62`,
in four groups (Bullish 5, Bearish 5, Neutral 16, Others 2). Each leg is `{kind, side, k, lots?, expiryOffset?}`
where `k` is a number of listed strike rows from ATM, never a price step (ADR-006). The set was taken from the
original site being matched (CoinGreeks) and is the same standard catalogue Sensibull (25+) and Opstra ship
(`docs/research/competitors-sensibull-opstra.md:14,32`). Every structure is the textbook one; no template has a
wrong side or a missing leg.

**How it is tested.**
- Catalogue: count, unique names, categories, ladder placement, lot multipliers, calendar expiry selection and the
  three refusals (`no-chain`, `out-of-range`, `no-quote`) in `apps/web/src/lib/strategy/templates.test.ts`.
- Maths: textbook values on hand-built legs in `packages/pricing/src/strategy.test.ts` (bull call spread max profit
  = K2 − K1 − debit, max loss = debit, R:R 1.5; breakevens for spreads, straddles, puts and futures; POP against the
  closed-form lognormal tail; greeks against Black-76; futures contribute delta only) and against Delta's published
  greeks in `packages/pricing/src/validation.test.ts`. `packages/pricing` is gated at 100 % line coverage.
- UI and e2e: 28 cards, category and outlook filters, POP and R:R on every card, a template loads legs and the
  payoff tiles fill (`apps/web/src/components/builder/builder.test.tsx:206-232`, `apps/web/e2e/analyse.spec.ts:305-355`).

**What is missing.** No test asserts, per template, the textbook shape: defined or unbounded max profit and max
loss, breakeven count and the outlook it expresses. That is roadmap item D19 (GAPS #75).

**Honesty note for product copy.** No template is a "proven profitable" system. A template is a structure; whether
it pays depends on implied volatility at entry, the strikes chosen and how it is managed. The only defensible
"proven with data" claim for Delta India options is a backtest on HapieCoin's own IV and mark snapshots, stored every
five minutes since ADR-056. That is roadmap item 9. Until then the product should say "ready-made structures", not
"proven strategies".

## 2. More strategies, futures, futures + options, trending?

**Futures today.** A perpetual future is first-class in the schema (`packages/schema/src/strategies.ts:19,27`:
`StrategyLegKind = call | put | future`, expiry `PERP`), in the pricing engine (`packages/pricing/src/strategy.ts:146-173`,
delta only, value = price) and in the Builder (`apps/web/src/components/builder/FutureDialog.tsx:20` adds the perp at
the live spot). But **no template can contain a future**, because `TemplateLeg.k` is strike-row based
(`templates.ts:10-18`). Futures-only and futures + options templates are therefore missing, not unsupported.

**Additions (roadmap item D18, 20 templates, gallery capped at 48).** `F` = perpetual future, `k` as rows from ATM,
`×2` = two lots, `e0/e1` = this and the next listed expiry.

| Group | Template | Legs |
|---|---|---|
| Bullish | Long Perp | F buy |
| Bullish | Covered Call | F buy, C sell +2 |
| Bullish | Protective Put | F buy, P buy −2 |
| Bullish | Collar | F buy, P buy −2, C sell +2 |
| Bullish | Call Back Spread 1x2 | C sell 0, C buy +2 ×2 |
| Bullish | Diagonal Call | C sell +2 e0, C buy 0 e1 |
| Bullish | Risk Reversal | P sell −2, C buy +2 |
| Bearish | Short Perp | F sell |
| Bearish | Covered Put | F sell, P sell −2 |
| Bearish | Put Back Spread 1x2 | P sell 0, P buy −2 ×2 |
| Bearish | Diagonal Put | P sell −2 e0, P buy 0 e1 |
| Neutral | Synthetic Straddle | F buy, P buy 0 ×2 |
| Neutral | Broken-Wing Put Butterfly | P buy 0, P sell −2 ×2, P buy −5 |
| Neutral | Broken-Wing Call Butterfly | C buy 0, C sell +2 ×2, C buy +5 |
| Neutral | Double Diagonal | P sell −2 e0, P buy −4 e1, C sell +2 e0, C buy +4 e1 |
| Neutral | Calendar Strangle | P sell −2 e0, P buy −2 e1, C sell +2 e0, C buy +2 e1 |
| Others | Call Ratio Spread 1x2 | C buy 0, C sell +2 ×2 |
| Others | Put Ratio Spread 1x2 | P buy 0, P sell −2 ×2 |
| Others | Short Call Ladder | C sell 0, C buy +2, C buy +4 |
| Others | Short Put Ladder | P sell 0, P buy −2, P buy −4 |

Not added: Cash-Secured Put (it is Sell Put at −2), Wheel (a journal workflow, not a template), Box Spread (dropped to
hold the cap). No "Futures" tab: the tabs are an outlook axis and the "Recommended for outlook" filter classifies by
payoff (`useTemplateStats.ts:18-29`), so a `tags` badge marks futures, calendar and ratio templates instead.

**"Trending" strategies** that are workflows rather than templates and belong to the Strategy Wizard and backtest work
(roadmap items 8 and 9): daily-expiry short premium with a strategy stop (Delta lists daily expiries), delta-hedged
short straddle (needs a hedge-with-perp action in the workbench), funding-rate carry (long spot / short perp; needs a
spot leg the model does not have). Each should be offered with its historical outcome on our snapshots, not as a label.

## 3. Will the app support other markets (NSE India, USA, forex)?

**Not today.** There is no venue abstraction:
- `Venue = "delta"` (`packages/venues/src/types.ts:12`); `VENUES = ["delta_india"]`, `UNDERLYINGS = ["BTC","ETH","XAUT"]`,
  `Currency = USD | INR` (`packages/schema/src/primitives.ts:29,34,39`); the instrument-id regex is built from `VENUES`
  (`packages/schema/src/market.ts:23`); `SCHEMA_VENUE` is a constant and other quote assets throw
  (`packages/venues/src/schema-adapter.ts:30,68-70`).
- Delta's symbol codec (`packages/venues/src/delta/normalize.ts:41-114`), settlement hours (`packages/pricing/src/time.ts:11`,
  `apps/web/src/lib/pricing/legs.ts:9-11`, `apps/web/src/lib/chain/expiries.ts:19-22`), fee model
  (`apps/web/src/lib/strategy/paper.ts:23-40`, `Broker` schema `packages/schema/src/accounts.ts:66-74`), lot sizes in
  five client files, single-venue gateway URLs (`apps/gateway/src/config.ts:17-20`), and no `venue` column in the
  database except `venueOrderId` (`apps/api/src/db/schema.ts:371`).
- Pricing is Black-76 on a forward with `r` but no dividend or foreign rate, a 365-day calendar count, European exercise
  only, and no timezone or holiday calendar (`packages/pricing/src/black76.ts`, `time.ts:8-39`). Margin is the worst
  defined loss (`apps/web/src/lib/strategy/analysis.ts:91-94`).

**What is reusable.** The Black-76 core, the worker, the chain, Builder, workbench, alerts, journal, plans, billing and
admin are venue-neutral in design. The only real seams are the `DeltaTradingClient` interface
(`packages/venues/src/delta/trading.ts:154-164`) and the gateway's feed slice (`apps/gateway/src/feed/market-data.ts:2-50`).

**Path (roadmap item E20, four medium PRs, after go-live).** A `VenueAdapter` port in `packages/venues/src/port/adapter.ts`
(`id, label, underlyings, symbolCodec, markets, trading?, fees, margin?, calendar, capabilities`; `MarketSpec` carries
multiplier, lotSize, tickSize, quoteCcy, settleCcy, exerciseStyle, settlement time and timezone, isInverse). PR1: port
+ `VENUE_REGISTRY` + `DeltaIndiaAdapter` wrapping today's code, zero behaviour change. PR2: `venue` column on
strategies, brokers, alerts, iv_snapshots, instrument_marks (default `delta_india`) and regex widening. PR3: pricing
gains Black-Scholes-Merton with `q`, an injected `TradingCalendar` (act/365 default bit-identical), American exercise
flagged display-only. PR4: **Deribit, data-only** (public API without keys, same underlyings, inverse BTC-settled
contracts exercise the abstraction properly). Decided by the user on 10 Sep 2026.

**Regulatory reality.** NSE: live orders only through a SEBI-registered broker API (Zerodha Kite Connect, Angel SmartAPI,
Dhan); each user pays the broker's API subscription and passes its KYC; there is no terms-compliant free chain feed, so
NSE arrives paper-only through a licensed feed or a broker market-data API. USA: options need a US broker (Tradier,
Alpaca, IBKR); Indian residents face LRS limits and most US brokers do not open derivative accounts for them. Forex:
retail options access is thin (Saxo, IBKR) and Indian residents are limited to NSE-listed INR pairs.

## 4. Multi-currency and multi-lingual?

**Currency today.** Display-only: venue quotes are USD, INR is a conversion by a rate the user types
(`UserSettings.conversionRate`; `apps/web/src/components/dialogs/CurrencyDialog.tsx:69-73` fixes From = USD, To = INR).
`fmtMoney` (`apps/web/src/lib/money.ts:29-52`) is a two-way ternary. Billing is INR-only through Razorpay
(`apps/api/src/checkout.ts:105-107`). There is no FX feed and no separation of quote, settlement and display currency.

**Path (roadmap item E21).** `Money { amount, ccy }`; ISO-4217 `Currency` with a supported display list (USD, INR, EUR,
GBP, AED); an ECB reference-rate job in `apps/ingest` (Frankfurter, free, no key, INR supported) into `fx_rates`,
`GET /fx`; the manual rate stays as an override with a "manual" or "ECB dd-mm" basis badge (frontend rule: every number
has a basis). Billing stays INR / Razorpay; Stripe for USD is deferred.

**Language today.** None: no i18n library, `<html lang="en">` (`apps/web/src/app/layout.tsx:18`), copy inline in 234
component files; only `apps/web/src/content/landing.ts` and `legal.ts` are centralised. The assistant matches English
keywords by regex (`apps/web/src/lib/assistant.ts:25-34`).

**Path (roadmap item E22, large, split by area).** next-intl (server-component `getTranslations` keeps the
no-`"use client"` convention in `app/**`; cookie locale, no URL prefix so e2e URLs stay); extraction order
chrome/nav/palette → dialogs, errors, empty states → settings/billing → landing and legal; trading vocabulary (Call, Put,
IV, POP, Strike) stays English in every locale; numbers only through `Intl.NumberFormat(locale)`; the assistant gets
per-locale match tables with the English table untouched. **Hindi, Tamil and Telugu together**, decided by the user on
10 Sep 2026; Gujarati and Marathi can follow.

## 5. Mobile, Android, iOS?

**Today.** Desktop-first. Narrow handling exists in `Workspace.tsx:51-62` (stacked columns), `ChainTable.tsx:206-210`
(calls or puts one at a time, driven by panel width) and `AdjustWorkbench.tsx:27`. About 178 responsive utilities across
234 components, `md:` almost unused. No `viewport` export, no `public/` directory, so no manifest, icons or service
worker; no touch handlers; Playwright runs Desktop Chrome at 1440×900 only (`apps/web/playwright.config.ts`), with three
ad-hoc checks at 640–1100 px and none at a phone width. Mobile was not in GAPS.md (now #68).

**Path (roadmap item E23, decided by the user on 10 Sep 2026: PWA first, then Capacitor).** Phase 1: `export const viewport`,
`app/manifest.ts` and icons, a `@serwist/next` service worker that precaches the shell and never caches API or
WebSocket responses, Playwright projects Pixel 7 and iPhone 14 under `e2e/mobile/` with phone specs for landing, sign-in,
chain scroll with explicit tap targets for Buy / Sell (hover and the B / S keys do not exist on touch), the Builder
drawer and the paper-trade dialog. Web push already reaches Android PWAs and iOS 16.4+ home-screen PWAs, and the passkey
table gives biometric unlock through WebAuthn, so alerts and biometric lock ship without a store. Phase 2: a Capacitor
shell for the Play Store and App Store with native push (FCM / APNs) and a biometric plugin; Apple guideline 4.2 (thin
wrappers) is mitigated with native push, deep links, the offline shell and a native splash. React Native / Expo was
rejected: it would rewrite all 234 components for a team of one; `packages/schema` and `packages/pricing` stay DOM-free
so that route remains open.

## 6. Scalable, performant, best UX, secure?

**Strong today (verified).**
- Vault: AES-256-GCM keyring with key ids, lazy re-seal and `pnpm db:reseal` (ADR-054, `apps/api/src/vault.ts:70-107`).
- Rate limits: better-auth limiter on a shared store plus Hono middleware per email and per IP; Redis sliding window
  with undo (`apps/api/src/security/rate-limit.ts`, `rate-store.ts:114-139`); client IP from the socket unless the peer
  is in `TRUSTED_PROXY_IPS` (ADR-019).
- Headers, CORS, origin check, Zod on every route, audit log with scrubbed before/after (`apps/api/src/security/headers.ts`,
  `audit.ts:21-42`), secrets scrubbed in pino and the audit table, none committed.
- Trading safety: single order path, operator and per-user kill switches, notional / leg / mark-band caps, idempotency
  at the API and the venue with the same client order id on retry, `NODE_ENV=test` refuses live keys
  (`apps/api/src/routes/live-exec.ts`, `packages/venues/src/delta/trading.ts`).
- Quality: strict TypeScript with `noUncheckedIndexedAccess`, coverage gates 100 % on pricing / schema / venues, 95 % on
  the API, 90 % on web libraries; 193 unit files, 10 e2e specs, a real-API smoke run (ADR-055); a 350 KB first-load
  budget script for `/analyse`.
- Performance: Next 16 App Router with the React Compiler, no client components in `app/**`, pricing in a Web Worker,
  virtualised chain, hand-written canvas charts, TanStack Query with a 30 s stale time.

**Gaps to close before scale (ranked; GAPS #69–#73, #16, #19).**
1. No `.github/` at all: no CI workflow, dependency automation, secret scanning, SBOM or LICENSE. The gates only run
   when someone types `pnpm ci`.
2. The gateway cannot run more than one replica (GAPS #16); the reconciler and Telegram poller run inside the API
   process with no replica guard (`apps/api/src/main.ts:76-97`; only the IV snapshotter has one).
3. No global request body limit (only the 5 MB banner upload) and no per-route limit on order placement.
4. No error tracking, APM or API metrics (pino to stdout and three `/healthz` endpoints only; the gateway has Prometheus).
5. No TOTP second factor for an account that places real orders; the live confirm is a plain button.
6. Bundle at 93 % of budget (GAPS #19), and the budget check is outside `pnpm ci`.

**UX.** The bar remains "no confusion" (`.claude/rules/product-identity.md`). The competitor research already ranks the
UX work that matters most: strategy stop and target run by HapieCoin, verified P&L, the Strategy Wizard, the positions
lifecycle, backtest and replay, the Mindful Trading pause, a screener, and the phone pass. Those stay in roadmap
sections A and B ahead of the platform tracks.

## 7. Order of work

1. Strategy catalogue now, beside the trade-lifecycle PRs (roadmap section D: D17 future legs, D18 catalogue of 48,
   D19 per-template invariants).
2. Trade lifecycle A2–A6, competitor takeaways B, deployment C13 as agreed.
3. Hardening F24–F29 with deployment.
4. Platform E20 venue port → E21 currency → E23 PWA and phone pass → E22 languages → E23 Capacitor; each item with the
   user's go-ahead.

Decisions recorded as ADR-060. Sources: the audits in this session (strategy catalogue, portability, security and
scale), `docs/research/competitors-sensibull-opstra.md`, `docs/deploy.md`.
