# HapieCoin backlog (feature freeze, 13 September 2026)

The feature set is frozen at main `933dcdc` for the first launch (ADR-090). Everything below is known, recorded, and **not scheduled**: it is the only intake for work after launch. Nothing here is required to go live; the go-live blockers are in [GO-LIVE-READINESS.md](GO-LIVE-READINESS.md).

Three sources, kept in sync with their originals: the roadmap items still open ([ROADMAP.md](ROADMAP.md)), every open review gap in full ([../GAPS.md](../GAPS.md)), and the build-spec rows whose screens exist but whose data feed is not connected ([../spec/traceability.json](../spec/traceability.json)). Regenerate with `node spec/gen-backlog.js`.

## 1. Roadmap items not started

| # | Item | What it involves | Why it waits |
|---|---|---|---|
| 13 | Deployment | Provision the stack per docs/deploy.md: images for web and ingest, secrets, managed Postgres with TimescaleDB, proxy with TLS and WebSocket upgrade, fixed egress IP, uptime checks, backups. | The user's provider and domain decisions (readiness report §6). This is the go-live item itself, not a feature. |
| 14 | Delta Exchange India partnership | Broker-pays or affiliate conversation; the referral and commission machinery already exists. | A business conversation, no code until terms exist. |
| 15 | Free vs Pro split and the education funnel | Tune the plan split to the competitor anchor (₹392–800 / month); an English + Hindi education funnel tied to paper trading. | Pricing decision by the user; content work. |
| 16 | Paid-data analytics rows | ETF flows, exchange reserves, token unlocks, per-coin liquidation history and the other mock-only rows in §3. | Only with the user's go-ahead on data spend. |
| 21 | E2 currency | `Money { amount, ccy }` type, ISO-4217 display list, ECB reference rates via an ingest job (`fx_rates`, `GET /fx`), manual override with a basis badge; billing stays INR. | Feature freeze. Today INR / USD display with a manual conversion rate already works. |
| 22 | E3 languages | next-intl, cookie locale, chrome → dialogs → settings → content; Hindi, Tamil and Telugu together; per-locale assistant match tables. | Feature freeze. |
| 23b | E4 mobile, Capacitor half | Native shell with push notifications and biometric unlock, Play Store and App Store listings. | Store accounts from the user; the PWA half (manifest, offline worker, install) shipped in PR #95. |
| 29 | zod/mini for the schema package + bundle check in CI | Smaller first-load bundle on /desk (GAPS #19); make the bundle budget a hard CI check. | Feature freeze; a warning today, not a failure. |
| 30 | AI: opportunity radar, language features, journal coach, advisor | Five phases in docs/research/ai-leverage.md: AI-1 radar with backtested setups and expected-value scores on template cards (no language model); AI-2 natural-language alerts and rules plus the assistant on the guide corpus; AI-3 weekly journal coach; AI-4 conversational advisor using the wizard, pricer, backtest and positions as tools; AI-5 volatility regime model and risk guardian. | Feature freeze; the radar needs 30+ recorded days of chains (accumulating), the language features need an API key in the secret store and a legal read of the copy. |
| 31 | Strategy playbooks | Eight rule-based playbooks on templates already in the catalogue (docs/research/strategy-playbooks.md): expiry-week credit spread, pin butterfly, front-week calendar, trend with defined risk, volatility squeeze breakout, trend financed by skew, premium harvest, covered call. Needs a playbook object, trend and volatility signals from recorded marks, entry conditions in the backtest, a track record per card. First three: premium harvest, expiry-week credit spread, trend with defined risk. | Feature freeze; each playbook ships only with its backtest on our own chains. |

## 2. Open review gaps (85 of 153)

Every row is copied in full from GAPS.md so this page stands alone. Priority is a recommendation for after launch: **High** touches money, safety or a promise the product makes; **Medium (data)** needs a data feed or a spend decision; **Low (tests)** is test hygiene.

### Web

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 18 | `@hapiecoin/ui` has no `"use client"` directives and creates contexts at import; server components cannot import it, so `apps/web/src/components/ui.ts` re-exports the parts it needs behind one boundary. Add the directive to the package entry points (or per component) and drop the boundary file. | web agent, 07 Sep | open | Medium |
| 19 | The largest first-load chunk on `/analyse` (~88 KB gzipped) is `zod` 4 classic pulled in by `@hapiecoin/schema` for WS-frame and settings validation; first-load is 326.7 KB gzipped against a 350 KB budget. Move the schema package to `zod/mini` (tree-shakeable) or ship a lighter validator for the hot WS path before Phase 2 adds the builder and charts. | web agent, 07 Sep | open · 11 Sep 2026: 385.5 KB gz after PRs #48-#52 and #66 (the venue port core added 2.7 KB) (check-budget reports 0 on-demand chunks, so the workspace split is no longer detected or no longer applies); ci.yml runs check:budget with continue-on-error so it shows as a warning, not a failure, until roadmap F29 (zod/mini, re-split) brings it under 350 KB | Medium |
| 21 | Wallet balance chip (HC-SH-008) and the "Wallet:" line in the API dialog are placeholders ("—", arrives with live trading); "Continue with Google" renders only when `NEXT_PUBLIC_GOOGLE_ENABLED=true` and is not covered end-to-end; `/auth/delta` explains rather than signs in (Phase 1). | web agent, 07 Sep | open | High |
| 33 | Parity details left out of Phase 2 item 4: payoff zoom is 1× / 2× / 4× steps instead of the mock's − 100 % + continuous zoom (HC-WS-036); the hover readout sits in the strip above the chart rather than a floating tooltip (HC-WS-045); the chain-picker expiry row scrolls natively without ‹ › buttons (HC-TR-028) and has no Live / Static toggle or column gear (HC-TR-029, 030); the live price cell does not flash on ticks (HC-TR-012); the spot-zone readout "Spot now ✓ profit zone" (HC-WS-046) is not shown. | Phase 2 item 4, 08 Sep 2026 | partly closed 08 Sep 2026 (Phase 2 close-out): ‹ › strip arrows on overflow (HC-WS-008, HC-TR-028), price flash (HC-TR-012) and the spot-zone readout (HC-WS-046) shipped with unit tests; still open: continuous zoom (HC-WS-036), floating hover tooltip (HC-WS-045), picker Live / Static toggle and column gear (HC-TR-029, 030) | High |
| 34 | Margin is estimated as the worst defined loss at expiry (ADR-023); the mock's exchange margin, ROI on margin and risk-as-%-of-capital rows (HC-WS-050, 051, 052, 058) need the broker margin call that arrives with Phase 3 trading. | Phase 2 item 4, 08 Sep 2026 | partly closed · ADR-029 (08 Sep 2026): Delta has no pre-trade margin endpoint, so the live preview shows the exchange's margin in use and available balance and keeps the worst-loss estimate; ROI-on-margin / risk-as-%-of-capital rows still use the estimate | High |
| 36 | `next dev` (Turbopack) cannot resolve the `./x.js`-style imports of `@hapiecoin/pricing` sources through the `development` export condition, the same defect as `@hapiecoin/schema`; `next.config.ts` now aliases both packages to their built `dist`, so `pnpm --filter @hapiecoin/pricing build` must run before `next dev` (the turbo `dev` task does not depend on `^build`). Fix: give the packages a `development` condition Turbopack can follow (extension-less imports or a bundled dev entry). | Phase 2 item 4, 08 Sep 2026 | open | Low (tests) |
| 116 | trading-live.test.tsx "HC-TR-182 … pauses Trade All → Live the same way, with the batch button returning after the countdown" is timing-sensitive: it failed once (mindful-pause not found) in a full web run on 20 Sep 2026 about 05:00 UTC while a fact-checker agent and the dev servers loaded the 15 GB laptop, then passed alone (31 of 31) and in the next full run (753 of 753). The file was not touched by the branch under test | full web unit run on fix/workbench-strikes, 20 Sep 2026 | open: watch for a repeat on the runner; if it recurs, give the pause block its own waitFor instead of relying on the dialog's first render, the rule from the 13 Sep CI clock lessons | High |
| 124 | components/landing/PayoffPreview.tsx reads `Date.now()` while rendering (`useState(() => Date.now())`), so the server-rendered page and the client hydrate from different instants: React logs "Hydration failed because the server rendered text didn't match the client" and regenerates the tree on the client. Seen on /payoff-preview in the visual suite, where the page's clock is pinned 19 days before the Next server's (two to four errors per run, all from that page in its two themes); in production the two instants are milliseconds apart and the dates only differ across midnight, so the mismatch is rare but real. Not a defect of the visual gate: the client re-render uses the pinned clock, so the picture is the same on every run. Fix later: take the instant from the server page as a prop, or render the date labels after mount. The same unpinned server clock renders the footer year (components/landing/Footer.tsx), which will change two visual pictures on 1 January, inside the tolerance | visual suite log, 28 Sep 2026 | open | Medium |
| 125 | At a 1280 px wide window /analyse is wider than the viewport: the header's right end (shortcuts, settings gear, rocket) lies beyond the edge, and a click on the settings gear scrolls the whole page sideways, by about 105 px in one run and 155 px in the next, so the chain and the header slide under an open dialog. Seen in the guide's settings pictures, where it made the first picture differ between runs. The visual gate now takes every picture from the left edge (e2e/shot.ts), which hides the symptom in pictures only; the overflow itself is open | visual suite, 28 Sep 2026 | open | Low (tests) |
| 138 | `HC-WS-016 keyboard moves the highlighted strike and A recentres` (apps/web/e2e/analyse.spec.ts:280) is flaky on the Linux runner: failed its first attempt after 12.4 s and passed the retry in 2.2 s on the otherwise green PR #121 run (42777368297). Not touched by that PR. Look at the first attempt's trace for what the keyboard handler waited on (the chain's focus or a scroll settle) before the picture of the highlighted row. | CI run 42777368297 | open | High |

### Analytics

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 55 | ETF flows, exchange BTC reserves, token unlocks, the Puell multiple and the gold / DXY tiles need paid or terms-restricted sources (ADR-038, research §2C–D). They ship as "coming soon" panels; unblocking needs a provider decision and budget. |  | open | Medium (data) |
| 56 | Binance `/futures/data/*` statistics keep only 30 days and CoinGecko Demo allows 10k calls/month (ADR-038). The 90D/1Y timeframe chips need an ingest-side history table (Postgres) fed from the daily snapshots; until then charts show the provider window. |  | open | Medium (data) |
| 57 | On the user's network `fapi.binance.com` and `www.okx.com` reset every TLS handshake (09 Sep 2026; curl `schannel: failed to receive handshake`, Node `ECONNRESET before secure TLS connection`), so the long-short and taker-volume jobs fail, the liquidation stream never connects and open interest / funding are Bybit-only. Add Bybit fallbacks to the ingest: `/v5/market/account-ratio` for the global long/short ratio, the `allLiquidation.{symbol}` public stream for liquidations, and a tickers job (mark + index price) that also unlocks the basis chart (ADR-040). Until then those panels say which venue they are waiting for. 09 Sep 2026 (ADR-041): long/short fallback and the Bybit liquidation stream shipped; still open: taker volume (OKX `rubik/stat/taker-volume`, units unverified because the OKX docs were unreachable) and the basis chart (needs a mark/index tickers dataset). |  | open (taker, basis) | Medium (data) |
| 58 | Per-coin liquidation history and the liquidation heatmap are built from the newest 100 captured events (ADR-040), so on a busy day they cover minutes, not the 12–24 h the panels name. The ingest should keep per-symbol hourly buckets (and a 5-minute ring for the 1 h/4 h windows) in the `liquidations` snapshot; the pages already say "from the captured events" and show the buffer's reach. |  | open | Medium (data) |
| 59 | Sentiment and options leftovers after PR 5.4a (ADR-042): AHR999 needs its published 200-day cost basis and age-curve constants verified from a source; the Puell multiple needs daily miner revenue (on-chain, paid or terms-restricted); the options page lists only Deribit and Delta India until OKX / Bybit / Binance option tickers are verified; the rainbow chart is a regression over the ingest's 1000-day window rather than the genesis-anchored curve. The pages say "n/a" or "coming soon" in each case. |  | open | Medium (data) |
| 60 | Whales (ADR-043) depend on Hyperliquid's undocumented leaderboard for wallet discovery; if it changes shape the job falls back to `WHALE_WALLETS` and the page says "watched wallets". Alerts are poll diffs (one minute), not fills; large orders come from Bybit only (Binance blocked from the ingest); exchange reserves remain coming soon (#55). A future improvement is Hyperliquid's WebSocket `userEvents` per tracked wallet for fill-level alerts. |  | open | High |
| 63 | The terminal's exchange pages (HC-MT-106) and the coin page's per-venue table have no 24 h volume per venue: the ingest reads open interest and funding per venue but no tickers. A small `tickers` job (Binance `/fapi/v1/ticker/24hr`, Bybit `/v5/market/tickers`, OKX `/api/v5/market/tickers`) would fill the tile, the column and the deferred basis chart (GAPS #57). |  | open | High |

### Product

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 46 | Commission rows freeze the referrer's percentage at record time (ADR-031), so raising a referrer's `commission_pct` in admin does not restate their pending rows; the admin sees the new percentage in the Commissions table beside the old amounts (08 Sep). Open: decide whether pending rows should follow a percentage change (restate) or stay frozen (audit-friendly, current). |  | open | Low (tests) |
| 47 | Impersonation (HC-AD-102) is not built (ADR-032): the reference site's button only toasts, and a real one needs a session-swap design (who, why, for how long, banner in the app, audit rows, no access to the user's exchange keys) and a consent rule. Open: decide whether support needs it at all; until then support asks the user for a screenshot or a share link. |  | open | High |
| 48 | The Banner Master table lists every banner on one page and images sit in Postgres as bytea (ADR-033). Fine for tens of banners; at hundreds add paging and move images to an object store behind the same `/v1/banners/{id}/image` URL (08 Sep). |  | open | Medium |
| 50 | Campaign sends run one address at a time inside the request (ADR-035); fine for hundreds, but a 5,000-recipient send would tie the request up for minutes and could hit the proxy timeout. Add a queue (Redis job + progress in History) before opening campaigns to the whole user base (08 Sep). |  | open | Low (tests) |
| 52 | The HapieCoin Assistant answers from a keyword bank in the browser (ADR-036); questions outside it get the fallback and the support email. A hosted model (API route, rate limit, "platform help only" guard, no strategy data leaving the session without consent) is a later item; the panel and the explainer stay as they are. |  | open | High |

### API

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 11 | Delta private signing (`HMAC_SHA256(secret, method + timestamp + path + query + body)`, headers `api-key`/`timestamp`/`signature`) is implemented from the docs and unit-tested, but has not been exercised against the live venue with a real key; verify once a whitelisted test key exists. | api agent, 07 Sep | open | High |
| 13 | `RedisRateStore` is tested against an in-process fake of the sorted-set commands; run it against the Docker Redis (`pnpm db:up`) once the machine restart lands. Testing rule says API handlers run against real Postgres: today they run on PGlite (ADR-013); add the Testcontainers/Docker job in CI. | api agent, 07 Sep | open | Low (tests) |
| 126 | One failed database read in the fills ingest stops the whole API: `startFillsIngest` (apps/api/src/verified.ts) runs `void tick()` with a `try / finally` and no `catch`, so a rejected query becomes an unhandled rejection and main.ts ends the process by design. Seen on the development laptop on 29 Sep 2026: the machine slept for six hours, the first fills read after waking failed (DrizzleQueryError on broker_credentials), the API exited and sign-in answered 500 until it was restarted by hand. In production a short database outage would do the same and rely on the orchestrator to restart the API. Fix later: catch and log inside the tick (as a failed positions read is already an error, never an empty list) and check the other interval jobs for the same shape | user report "not able to login", API log, 29 Sep 2026 | open | High |

### Gateway

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 14 | `fut:<venue>:<symbol>` topics validate in the schema but the gateway answers `err unsupported_topic`: the Phase 1 feed loads options only (spot comes from the perpetual's `spot_price`). Serve futures tickers with a `fut` frame in Phase 2 (HC-PB-009 landing tiles need BTCUSD/ETHUSD/XAUTUSD). | gateway agent, 07 Sep | open | Medium (data) |
| 31 | Open, High and Low are not in the gateway quote: the Delta option ticker adapter maps no candle fields (`packages/venues/src/delta/normalize.ts`, `schema-adapter.ts`), so the OHLC column group of HC-WS-021 is shown muted in Column Settings with "arrives with candle data (Phase 5)". Fix: carry `open`/`high`/`low` from the venue ticker through `Quote`, the gateway diff and the chain columns. | Phase 2 item 2, 07 Sep 2026 | open · partial: the 24 h spot high / low is served by `/v1/market/iv` (ADR-056); the gateway quote and the chain OHLC columns still lack candle fields | Medium (data) |
| 127 | A gateway that loses Redis gives up its feed role, closes its exchange socket and keeps answering with the last price it had, and nothing on the screen says so. Seen on 29 Sep 2026: the development gateway could not reach Redis after the laptop slept (`read ECONNRESET`, `MaxRetriesPerRequestError` on the feed lease), /healthz answered `ok` with role `follower`, socket `closed`, subscribed 0, and a 25 s subscription got one BTC spot frame, the stale 83,165.6. The header kept showing "FEED LIVE · 1 ms": FeedStatus (components/header/widgets.tsx) reports the browser's socket to the gateway, not whether ticks arrive. After a restart the same subscription got five frames with five prices. Open: (a) the badge should turn stale when no tick has arrived for a few seconds, and prices should carry their age; (b) /healthz should not answer `ok` for a follower with no leader and a closed venue socket; (c) a gateway without Redis could keep its own exchange socket in a single-instance setup instead of going silent | user report "BTC price is not updating", gateway log and a subscription probe, 29 Sep 2026 | open | High |

### Live trading

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 67 | The app never compares the exchange's net position per contract with the strategies' open legs: a stop, a manual close or a liquidation on the exchange leaves the strategies out of date and nobody is told. Two strategies holding the same contract net into one position at the exchange, so an exchange-level stop closes both (the user lost a 800 + 200 lot position this way). No overlap warning before an order. | user report, 11 Sep | partly closed 11 Sep 2026 (roadmap A2): the overlap line in every preview and the workbench Review (HC-TR-159), the drift badge and banner on the Live tab (HC-TR-160), Reconcile that books lots closed outside the app with no orders (HC-TR-161; when two strategies share the contract the exchange cannot say whose lots went, so each card offers its own lots and the dialog says so; the trader books only what that strategy lost); still open: a server-side drift pass, Re-enter, a resting reduce-only exit that fills is closed by sync at the order level but its leg stays open until reconciled (its fill price should be the default there), and the strategy-level stop loss (§2.3, roadmap A4) | High |
| 109 | The short-leg margin estimate (ADR-091) reads Delta's `initial_margin_scaling_factor` in the same percent unit as `initial_margin` (1 + 0.000005 × contracts percent); Delta's public docs give the shape (Initial Margin% = Initial Margin%_MIN + Slope × size) but no worked example, so the unit is unverified. If the factor is a fraction the estimate understates large sells by up to a few percent points; if it is a percent the code is right. Also unverified: whether Delta India grants spread relief once the matching long exists (the estimate assumes none) | code review of fix/short-margin-check, 15 Sep 2026 | open: compare the estimate with the margin Delta actually holds after the first live short placed with this build (Live tab → Margin in use), and adjust the unit or the formula from that reading | High |
| 112 | The chain comes from the real public feed while orders go to the testnet (ADR-025), and the testnet lists a coarser strike ladder (ETH 18 Sep 2026: 2300, 2350, 2400, 2450 … while the real exchange also has 2320, 2340, 2360, 2380, 2420, 2440, 2460), so a strike picked from the chain can be refused by the preview as "Delta product lookup failed … HTTP 400 invalid_contract". The gate held (nothing was sent), but the sentence does not say why | user test of an ETH call calendar, 16 Sep 2026 | open: when the trading env is testnet, reword the reason to "C-ETH-2420-180926 is not listed on the testnet (the chain shows the real exchange); pick a strike the testnet lists" and, optionally, grey out unlisted strikes in the Builder while the tag shows; goes away once trading moves to the real exchange | High |

### Trading

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 77 | The margin estimate (ADR-023: worst defined loss at expiry) understates a calendar or diagonal: the exchange margins each expiry on its own, so the short near leg is margined as if naked (CoinGreeks showed ₹10,091 for a calendar whose worst loss is ₹615). | user review, 11 Sep | open · the preview labels the estimate as understated across expiries and the live preview shows the exchange's own figure at placement; a per-expiry margin model needs Delta's formula | High |
| 82 | Stop and target rules (ADR-059 §2.3, A4a) are judged by the API only, from the venue's public tickers every `RULES_TICK_MS` (2 s): the browser does not fire them while a tab is open, the gateway's 1 s Redis feed is not used, and while the API is down nothing fires (the arming dialog says so). Leg stop, spot level, time exit, the workbench Protect entry and Re-enter shipped in A4b (HC-TR-169..172). The percentage bases (credit, debit, max loss) are the figures the client showed when arming, stored on the rule. The engine calls the exit path directly, so the per-user order budget (`ORDER_RATE_MAX_PER_MIN`, ADR-061) does not count its orders; only the venue token bucket spaces them. A rule exit the venue accepted but had not filled is never re-sent; when it fills, the order sync (the Sync button and the background reconciler) books the leg with the rule's reason and closes the strategy. Still open: an exit (or entry) partly filled and then cancelled at the venue books nothing for the filled part (the sync reads the order size, not `size − unfilledSize`); a synced exit whose product lookup fails is left for Reconcile. | build, 11 Sep · Medium · Open | Open · browser-side firing, the order budget and the partial-then-cancelled booking remain; the Redis feed when a 2 s tick proves too slow in practice | High |
| 130 | The settle trigger closes a calendar whole, but only per strategy and only when the trader arms it: there is no account default that arms it on every strategy whose legs span several expiries, so a calendar opened without Protect still ends with the settler leaving its far leg open. Open too: (a) the instant is fixed when armed, so an adjustment that adds a nearer expiry needs a re-arm (the card shows the armed instant, the dialog what a re-arm would fix), and a roll of the near leg while the server is down is not caught (the engine disarms a stale rule only on a tick before the instant); (b) the venue calendar's XAUT settlement (16:00 UTC) is used but unverified on a real XAUT calendar; (c) a live fire a few minutes before settlement sends market exits for the near leg into a thin book; an exit the venue leaves resting is not retried, the rule ends partial and the leg waits for the order sync, which may be after the venue settles it. Fix: a Settings default (arm N minutes before the nearest settlement on every multi-expiry strategy), an engine note when a nearer leg appears, and one real XAUT calendar observed. | review 7 Nov 2026 | open | High |

### Admin

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 5 | Full user page `/admin/users/:id` (deep edits, history) in addition to the quick-view drawer. | ADR-010 (HC-AD-090) | open | Medium |
| 6 | Bulk commission pay requires a payment reference and exports the batch CSV; audit-logged. | ADR-010 (HC-AD-058) | open | Medium |

### Public site

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 53 | /payoff-preview draws synthetic open-interest bars and a fixed spot (ADR-037) because the public gateway does not expose instrument lists or chain snapshots to visitors. Live OI on the preview needs a public, rate-limited chain snapshot endpoint. |  | open | High |
| 54 | Landing extras from the v2 brief are not built (item 5c audit, 09 Sep 2026): the count-up stats animation, feature-tab auto-rotate, the terminal illustration's live top bar / scenario matrix / portfolio bar, the liquidation stat cells and 40-interval sparkline (need the Phase 5 analytics feed), and the IV figure on the Live Markets tiles. The reference parity rows (HC-PB-001..022) are all built; these are HapieCoin-only polish items. |  | open | High |

### Venues

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 8 | Venue and schema packages named Instrument/Quote fields differently; bridged by `packages/venues/src/schema-adapter.ts` (ADR-014). Consider a single vocabulary in Phase 2 to remove the adapter. | venues agent, 07 Sep | open · since ADR-063 the bridge is the adapter's `schema` slot and the registry is keyed by the schema id, so the two vocabularies meet in one place | Medium |
| 87 | After ADR-070 three API seams still assume the default venue: the credential-verify client `deps.delta` (`DeltaPrivateClientImpl`) has no per-venue factory on the port (a second trading venue needs one before its keys can be checked); the trader's lot sizes (`user_settings.lot_sizes`) are stored per asset, so another venue can only take its listed default; and legs are matched to venue positions by raw symbol equality (`settlement.ts`, the positions-exit route), safe only while no two venues share a symbol. Fix when a second trading venue arrives: a `verify` factory on `VenueAdapter`, lot sizes keyed by venue, and a codec-based match. Also: `c24` (the 24 h change) is never produced by the real gateway for any venue; the header badge shows it only from the fake gateway and the fixtures (the Binance spot client in `packages/venues` that carries `change24hPct` is unused). | 4c build, 12 Sep 2026 | open · second trading venue | High |

### Workbench

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 117 | Known limits of the first version: (a) "Cash now" on an idea is at the mark and excludes fees, although the plan promised them (the footer shows the fee estimate once the idea is loaded; pricing fees per idea needs the broker's fee profile for nine drafts); (b) FIXED 21 Sep 2026 (ADR-095, HC-TR-197 / 198): a delta hedge with the perpetual and futures picks in the workbench; still open from it: a held future is not counted as cover for a short call when the wings are sized; (c) ideas use the shown expiry and the next one only; (d) the wing budgets (10 / 25 / 50 % of the short's mark), the two-strike roll and the one-strike skip on a roll out are fixed constants, not user settings; (e) whether Delta India lowers the margin once a wing is on is unverified, so the panel says nothing about margin; (f) when the list re-orders on a refresh a card that holds keyboard focus moves with its focus but the change is not announced to a screen reader; (g) AA contrast of the small muted "unchanged" figures is not measured; (h) the ideas refuse any order that would book two opposing rows on one contract, but the chain's own B / S can still do it and the executor's behaviour for that case on a netting venue is unverified | build of the panel and its code review, 20 Sep 2026 | open | High |
| 121 | Known limits of the first version: (a) the hedge is a snapshot: nothing re-hedges or warns when the delta has drifted again, and there is no target other than fully neutral (the lots are edited by hand after loading); (b) funding payments on the perpetual are not modelled in any figure; (c) live, the margin shown for the future is a floor (GAPS #120) and the exchange can still refuse the hedge after a bought leg has filled; a LIVE hedge has not been placed, on the testnet or for real, so the review dialog's live rows for a future and a limit order on the perpetual are unverified; (d) the hedge uses the perpetual only, never a dated future, and only the strategy's own venue; the ticket's B / S, like every chain pick, names its contract through the WORKSPACE venue, which equals the strategy's only because openAdjust switches it and setVenue closes the workbench (GAPS #118), so that invariant carries the futures pick too; (e) the idea nets against a held future, but the ticket's B / S on a future follows the chain's rule and can flip a held leg into the other side in one click; (f) the future is priced at the spot index, not at the perpetual's own mark (GAPS #14), so its entry can differ from the fill by the basis, and the review dialog's band column compares the index with the index while the server compares the perpetual's mark with it: the dialog can read "at mark" where the server refuses (unverified on the testnet); (g) the hedge card sits with the other cards, so it is hidden while the option ladder is loading and on a futures-only position; (h) the delta comes from the engine, which falls back to a 50 % volatility for a held option without a quoted IV, and the card carries no caveat for that; (i) when the hedge NETS against a held future (no pick), the card re-sizing with the delta makes the loaded change read as hand-built, so the other cards ask before replacing it; found by the code review of the build and fixed with it: a false "notional exceeds the balance" warning on every live hedge, a limit order that would have rested at the index, a "never defines your risk" claim nothing enforced, and ticket button titles that were wrong once a future was held or picked | build of the hedge, 21 Sep 2026 | open | High |

### Accounts

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 85 | Several labelled keys per exchange ship as accounts, and Delta Exchange India does scope an API key to the sub-account it was created under: verified 12 Sep 2026 on the demo account (Main and subashsub1 keys; HapieCoin showed 121.6 and 8.98 USD available against Delta's $121.59 and $8.82, and each key saw only its own positions). The Live tab's Margin used tile read the first account's wallet as its "of" figure; it now sums every account the tab trades through and says how many. Also open: a strategy from before accounts on an exchange with several keys names none, is left out of the out-of-sync check and cannot be exited by the engine until it goes live again or its exchange is back to one key (its card says so). | build, 11 Sep · Medium · Open | Open · scoping confirmed, tile fixed 12 Sep; a one-time "name the account" action on old live cards if any exist in production | High |

### Autopilot results

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 148 | Left open: the fee is the estimate logged at entry, not a per-fill charge (a settled trade pays the settlement fee, a trade closed leg by leg pays per leg); a trade Autopilot entered before a card's exit style was changed keeps its logged style; results older than 90 days drop out with the log; an entry logged with no days to expiry is in no band; no chart of the result over time, no export, no filter by date; the read is unbounded over the 90 days and polled each minute (fine at proving scale; a partial index on entered lines is the fix); a failed re-read keeps the last figures with a notice, which has no test of its own; an account that is deleted takes its results with it; per-trade figures are in the newest 100 only; the screen's tables were not opened in a real browser by me and have no phone layout pass; nothing yet turns the results into a suggestion (which exit style to keep, which strategy to switch off). | ADR-111, 21 Nov 2026 | open | High |

### Autopilot screen

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 146 | Left out of the first screen: a budget with a minimum and maximum capital per strategy, an open-trade cap and a daily loss limit; sizing to a budget; a per-strategy pause separate from its switch; Telegram for an entry, a better-entry note or a health change; a results view per strategy and exit style (win rate, average result after fees, by days to expiry), which is what the proving phase is for and today needs a query on the log; today's result is before fees and counts closed trades by the browser's local day; capital in use reads the newest 200 log lines, so a trade older than that counts as nothing; today's change of an open trade follows the UTC day of its P&L history while a closed trade counts by the browser's local day; a trade Autopilot entered since the page last read has no quote subscription yet, so Stop everything names it "no live price" and it needs a second press; Go live is disabled on the Paper card only, the other ways to the trade ticket (the pane, the batch) show the server's refusal after the fact; a strategies read that fails on its own while the Autopilot read succeeds is handled but has no test of its own; the page has no phone layout pass and no pixel baseline; not opened in a real browser by me (unit tests against the mock API only), and no e2e spec covers it. For the live step (not allowed yet): Autopilot must trade through an account of its own, because positions on one strike net inside a venue account; the Go live refusal and the tag are the only guards today. | ADR-109, 21 Nov 2026 | open | High |

### Autopilot screen rework

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 151 | Left open: the selection is not remembered or shareable in the address; "All" still lists every strategy (twenty-two rows); the backtest figures of a clock playbook are constants beside its evidence sentence (a test keeps them equal) and a recorded playbook shows none in that column; the paper column and the results are before any filter by date; on a phone the header's tabs scroll inside the header with no hint that more are there, and the command-palette button is hidden; the summary tiles do not follow the selection; a trade or log line of a playbook that no longer exists belongs to no family and shows under All only; the header change has no test of its own (seen in Chrome at 400 px); no XAUT or monthly strategy exists yet, so those buttons are absent; looked at in a real browser at desktop and phone width as an empty test account only, never with trades on it; no pixel baseline and no e2e spec. | ADR-116, 22 Nov 2026 | open | Low (tests) |

### Autopilot, first version: the paper entry engine

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 145 | Not built yet: the Autopilot screen (the switch and the log are reachable through `GET` / `PUT /v1/autopilot` only), the budget, the open-trade cap, the daily loss limit and the stop-everything switch, sizing to a budget (every entry is the playbook's fixed 10 lots), Telegram messages for an entry or a better-entry note (the note is written to the log only; a fired exit still notifies through the rule's channels), and a health light per running trade. Known limits: an entry needs a playbook to fire, and five of the six tradable playbooks judge a daily condition (the 50-day average, the IV rank), so "every opportunity" means every snapshot on which that condition and the structure hold, not an intraday signal such as the 14:00 to 16:00 IST window, which needs a new detector; the fill is the snapshot's mark, not a bid or an offer, so paper results flatter illiquid wings (GAPS #127 stale-feed guard still open; the twelve-minute age limit is the only guard); the exit fee is taken as equal to the entry fee; the snapshot writes its spot row before its mark batches without a transaction, so a failed batch could leave a partial ladder that the engine would price on (the twelve-minute limit does not catch it); the covered call is left out (futures margin unverified, GAPS #109 / #120); Deribit has no paper exchange row, so nothing enters there; settings changes do not ask for the second factor (paper only); the "never auto-place" wording in the Playbooks tab and the proposal Telegram text is still true for what those do, and is to be reworded when the screen arrives; nothing e-mails the trader when Autopilot enters. Not run: the web and e2e suites (no web change in this PR). | ADR-108, 21 Nov 2026 | open | High |

### Autopilot, several trades per strategy

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 147 | Left open: the cap (5) and the wait (15 minutes) are constants, not settings; no budget bounds the capital five trades tie up; two structures that share a strike are treated as unrelated (on paper they are, on a venue they would net: the live step's own-account condition in GAPS #146 covers it); structures are told apart by strikes and expiry only, so the same strikes at a different size would count as held; the engine test for the cap fills the places with rows written directly, not with five real entries; a row from before the structure column whose legs the trader also edited is known only by its edited legs; the log is busier while a strategy holds trades (a skip is written per change of reason, about one line per 15 minutes per held trade at worst); capital in use on the screen still reads the newest 200 log lines; results by structure width are not compared (ADR-111 groups by strategy, exit style and days to expiry). | ADR-110, 21 Nov 2026 | open | High |

### Autopilot's evening strangles and the study behind them

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 149 | The backtest is in-sample (the six were picked from 456 combinations on the same 106 days), BTC only, 8 Aug to 21 Nov 2026, at marks with a 1 % slippage check, and does not model margin; not yet tested: calendar spreads, ETH, strikes set by the day's expected move, skipping announcement days, a trend filter on the sold side, a timed exit before settlement. In the product: the window, the strikes out, the stop multiples and the 100 lots are constants; no margin or capital figure for a naked strangle; the six-hour "once per window" guard is a clock rule, not a per-expiry one; a clock playbook has no record card on the Playbooks tab; the entry uses the 5-minute snapshot's marks, so it enters up to five minutes into the window; the strikes are counted in listed strikes, so a ladder with another step sells at another distance than the study did; the trades the ADR-110 ladder opened stay open with their exits; nothing switches a strategy off when its paper results fall below its backtest; the take-half share (ADR-113) is a constant, and the take-profit is offered on the naked strangle only: on the winged ones it lowered the result in the study, so no winged take-half playbook exists; like the stops, the target is judged every two seconds on live marks, not on 5-minute closes. The trail on the rest (ADR-114) runs on the engine's rule, which the study does not copy exactly: it starts on the tick after the stop (the study in the same bar), has a minimum give-back of ten cents, and the 50 % was the best of three give-backs tried on 64 stop days. Differences between the paper engine and the study that will make paper results differ from the cards: the rules engine judges a stop every two seconds on the live mark while the study judged it on 5-minute closes, so a brief spike stops a leg the study held; the product centres a structure on the last strike at or below the spot (the Builder's rule) while the study centred on the nearest strike, so the sold strikes can sit up to one strike off-centre; the study's 20:30 IST bar was better for the two naked versions (+8.87, +13.30) and far worse for the wide-wing one (+0.08), a sign of how much one hour moves a thin sample. Operations: a settlement whose spot is never recorded leaves the legs open and the key held ("Holds a trade already" each evening) until someone exits by hand; a naked strangle counts in no capital figure and its health never reads "close to its stop" (it has no strategy stop). | ADR-112, 21 Nov 2026 | open | High |

### Autopilot's weekly strangles

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 150 | The weekly study is in-sample, BTC only, one year, hourly marks (a stop is judged on hourly closes there and every two seconds in the engine), no margin; the Tuesday entries are run although the study has them about flat; monthly expiries are not offered (11 expiries is no evidence); distances other than 3 % (5 % and 7 % were tested and earned) and weekdays other than Friday and Tuesday are not offered; the percentage, the days, the window and the 100 lots are constants; one trade a week makes the paper record slow to read; with the daily and weekly sets all on, up to sixteen strangles are open at once with no budget; a week in which the snapshot at the window has no price on the Friday expiry is skipped, not retried the next day; the cards are not opened in a real browser by me, and twenty-two cards have no filter or collapse. Differences from the study: it took the exact strike 500 apart or skipped the week (which is why the winged version has 26 of 51 weeks), while the engine takes the nearest strike that has a mark, so in a week the 7 % strike has none it buys a nearer or further wing; the study settles and enters on the perpetual's mark, not the index; a held key whose pass has no fresh prices writes no line, which now costs a week and not a day. | ADR-115, 22 Nov 2026 | open | High |

### Backtest

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 93 | The backtest is open to every plan although the research puts it behind the paywall: the billing plans carry numeric limits only (`LIMIT_KEYS`), not feature flags, so gating needs a plan-schema change. Also open: the first recorded day is the only history there is (no reconstruction of earlier chains: ATM IV rows carry no ladder), the backfill from the mark stream loses the oldest day for XAUT (its 16:00 settlement runs the first write after the noon prune), results carry no fees or slippage, and a template is entered every recorded day with no signal or exit rule beyond expiry (B9b adds replay; custom entries and exits are a later item); the in-process memo of folded days is per replica (a second API replica warms its own). | build, 12 Sep · Low · Open | Open · a `features` set on plans for the paywall; replay next | High |

### Backtest evidence

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 134 | Deferred from the walk-forward and the sweep: no strike-offset axis (the templates place strikes by rows from the ATM, so sweeping an offset needs the materialiser to take one); folds are a plain contiguous split with no anchored or rolling re-fitting (nothing is fitted automatically yet); no Sharpe-type, annualised or deflated metrics (daily-settled option P&L is too lumpy for the sixty-day halves the ranges give); sweeps are not saved or shared and the Sweep view keeps preset values per axis (no free-form grids); the plateau reading uses grid neighbours only (same sign, at least half the size) and says nothing about the surface beyond one step. | build 9 Nov 2026 | open | High |

### Backtest rules

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 133 | What the rules leave out: exits are judged once a day on the settlement-hour marks (an intraday target touch is missed, a stop fires at the next mark, so real exits are earlier and worse); the settlement fee is charged on in-the-money legs only (the two research notes disagree on whether a worthless expiry pays it; if a real settlement shows one, the rule needs a second base, the uncapped notional fee, since the premium cap of a worthless option is zero); the IV-rank condition sees only days with a recorded ATM IV (reconstructed days carry none, GAPS #132), so it is effectively blind before mid-September 2026; no slippage and no spread, fills at the mark; the trend filter averages the last N recorded days, so a gap in the record shortens its window in calendar terms (the IV-rank look-back is in calendar days); a target or stop on a near-zero-premium unbounded structure cannot fire and the trade is counted as inert instead; the walk-forward split and the bounded sweep are PR 2b. | build 9 Nov 2026 | open | High |

### Billing

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 49 | Razorpay webhooks need `RAZORPAY_WEBHOOK_SECRET` and a public API URL registered in the Razorpay dashboard (ADR-034); until then a payment whose tab closed before the confirm call stays Pending and support settles it by hand. Refunds and proration are not built (08 Sep). |  | open | High |

### Chain history

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 132 | What the candle reconstruction lacks: no mark IV on a reconstructed day (a modelled exit falls back to the entry IV, and the IV-rank filter planned for the backtest rules PR cannot read those days); strikes further out than eight empty grid steps are not found (quarterly ladders step 1,000 to 2,000 on the 200 grid, so wings beyond about 1,600 from the last found strike are missed); an expiry listed more than 166 days before it settles loses its oldest days (two 83-day candle windows per symbol); a strike listed after the settlement hour appears a day late; XAUT (step unprobed) and Deribit (no candles through VenueRest) are not reconstructed; the first full run costs on the order of 100,000 public requests over several hours (in progress on the dev stack on 9 Nov 2026: 117 BTC expiries, 7,013 rows when this was written; the run resumes across restarts). | build 9 Nov 2026 | open | High |

### Closed trade in the pane

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 142 | Left out of the first version: a closed trade that was adjusted or rolled shows every leg it ever entered in one payoff, though they were never all held together (the Details payoff has the same limit; the position at each moment needs the adjustment history); the curve is drawn around today's spot, not the spot at entry or at the close, and there is no marker for where the trade actually ended on the price axis; a closed trade whose strikes are far from today's spot can sit at the edge of the axis; the Share button shares the entered legs with no word that the trade is closed; other date fields (Journal, alerts, P&L history) still use their own formats and UTC dates; in the stacked (narrow / phone) layout the analysis pane is unmounted while the cards show, so a trade that closes under it is still followed when Analysis is opened (the hand-back of ADR-105 point 3 lives in the pane's bar) and the next open trade is not auto-followed; the Playwright configs pin no time zone, so card and Details times read IST on a laptop and UTC on the runner, and the Linux pixel baselines of every screen with a paper / live card or Details need a refresh because the started / closed text changed; Details' adjustment history and its "since" line keep their own date formats; not checked in a real browser against the user's own closed trades by me (unit tests only), and no pixel baseline covers the closed pane. | ADR-105, 19 Nov 2026 | open | High |

### Drafts on the server

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 104 | The unsaved Builder working set (legs, name, basket, price mode) and the per-device `draftId` pointer stay in the browser by design: a draft never saved does not travel, and another device opens an empty Builder with the draft listed under My templates rather than continuing where the first device left off; the list is not refetched on focus or on a timer, so a draft saved on another device appears here on the next mutation or when My templates mounts after 15 s; no e2e proves the second-device case (the mock resets per test). | ADR-088, 13 Sep 2026 | open | Low (tests) |

### Fees

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 129 | The seeded Delta India fee defaults are wrong for options: `packages/venues/src/port/delta-india.ts:87` seeds 0.05 % of notional capped at 10 % of premium, but the exchange product list on 6 Nov 2026 answers `taker_commission_rate` 0.0001 (0.01 %) and `premium_commission_rate` 0.035 (cap 3.5 % of premium) for every option, with 18 % GST and a settlement fee at the taker rate on contracts open at expiry (delta.exchange/fees); 0.05 % is the perpetual taker rate. The Trade Preview, the Journal and the backtest therefore overstate option fees three to five times. Fix: per-contract-type defaults (options 0.01 % / 3.5 % cap, perpetuals 0.05 % taker / 0.02 % maker), read from the product list when available, plus the settlement fee. Found by the paper timing analysis (docs/research/paper-timing-analysis.md §5). Narrowed 9 Nov 2026 (ADR-099): the backtest now charges the real rule from `VenueCore.feeRule` / `packages/pricing/src/fees.ts`; the broker profile behind the Trade Preview, the paper engine and the Journal still carries one rate for every contract type and the wrong seed, so that half stays open. | review 6 Nov 2026 | open (narrowed) | High |

### Fixtures

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 7 | `spec/fixtures/delta-tickers.json` holds BTC call tickers only; put-side Greeks and exchange put-call parity are untested against Delta. Refresh the fixture with `P-BTC-*` tickers (and ETH/XAUT) and re-run `packages/pricing` validation. | pricing agent, 07 Sep | open | Low (tests) |

### Home-screen app

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 98 | Real Safari is untested: the iPhone 14 profile runs on Chromium (no WebKit here), so Add to Home Screen, standalone display and the safe-area handling (status bar kept opaque black until then) need a device check; no push, no background sync, no toast when a new service worker takes over (the next navigation gets it); the venue switch, terminal and admin tables remain desktop-first (GAPS #96); the Capacitor shell (native push, biometric unlock, store listings) waits for the user's Play Store and App Store accounts. | build, 13 Sep · Low · Open | Open · a WebKit Playwright run or a device pass; then the Capacitor half of E4 | Medium (data) |

### Leg stop that trails the rest

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 141 | Left out of the first version: a live leg stop whose exit rests on the exchange and fills later through the order sync starts no trail (the fired note says the exit is not confirmed; the trader arms protection by hand); the backtest's exit rules do not model the choice; a percentage give-back waits until the rest is a cent in profit, so a rest that never turns positive is guarded only by its own stops; a close books its leg before the strategy's realised total (the class already noted under #140), so between the two writes the rest looks lower by that leg's profit: a trim of a profitable leg (milliseconds) or a live square-off of several legs (seconds, one venue order per leg) can fire a running trail, whose exits are reduce-only orders for legs already being closed, and a money trail is exposed from its first tick because it has no activation level (fix: book the total per leg in the close-all paths, or leg and total in one transaction); the one-per-strategy rule is a read then an insert with no unique index, and a rule-set save that lands in the same instant as the fire can delete the trail the leg stop's note says has started; a changed give-back restarts the trail from where the rest stands, so the best reached before the change is given up; the trail's level is the realised total when the stop fired, so a leg added afterwards counts toward the gain from its entry and a second leg stop's loss counts as a fall of the rest (it usually ends the trail at once, by design); one trail per strategy, taking the give-back of the stop that fired first; nothing tells the trader the trail started beyond the leg stop's own message and the card line; the dialog's worked exit level uses where the other legs stand now, not where they will stand when the stop fires. | ADR-104, 19 Nov 2026 | open | High |

### Live data

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 9 | Delta's compact `ticker` channel omits `oi` in underlying units and `volume`; if the migration away from legacy `v2/ticker` happens, OI/volume must come from REST polling. | venues agent, 07 Sep | open | High |

### Mindful pause, server side

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 100 | The pause stamp (`MindfulGate`) is in memory per API replica, so a second replica asks the trader to preview again (a Redis stamp keyed like the rate store would share it); the day figure re-reads the marks per live strategy on every preview (a per-user cached row would make it one read); `POST /strategies/{id}/pnl` accepts any day from the client, so the trader's own browser (a skewed clock) or script can move the baseline the server subtracts (a self-inflicted skip, like turning the setting off; bounding the day to the server's today breaks the browser's write at the UTC boundary); an adjustment that mixes a trim with an add waits as a whole; a partially filled leg is valued at its entry price like every open leg; the mock's day figure is a per-account knob with no closed-today share; no e2e (the server pause is exercised through the mock in unit tests only). | ADR-084, 13 Sep 2026 | open | High |

### No free tier: the Desk needs a plan

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 144 | Left out of the first version: the gate is on the Desk page, not on the data behind it, so the price feed (gateway) and the read-only market routes still answer a signed-in user without a plan; Market Analytics and the Terminal are open to everyone as before; the redirect itself lives in a server layout that the unit suites cannot reach and no browser test switches the Free plan off yet (the API answer, the page, the banner and the note are unit-tested); a user is not e-mailed when an admin adds their plan; the payment note is free text in the audit log, not a payment record, so it does not appear in the user's payment history or on an invoice; the Free plan is switched off by hand in Admin → Plans on each environment. | ADR-107, 21 Nov 2026 | open | High |

### Observability

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 97 | better-auth answers its own 500s inside `auth.handler` and logs them through its console logger, not pino, so they never reach the sink (wire its `logger.log` into pino once its messages are known to carry no PII); errors only, no traces: no spans or timings beyond the request histogram; browser frames arrive minified (no source-map upload, so a browser event names chunk files and columns); no sampling (the 60-a-minute cap drops the rest of a storm blindly); the sink file is duplicated in apps/api and apps/gateway (no shared server package); alert rules and uptime pings are deploy-time work (docs/deploy.md §6); the web sends no build release yet (the body field exists and becomes the event's release when set; the app leaves it empty); `/v1/client-errors` is open to any address at 5 reports a minute (rate limit only, so a scripted flood is bounded but not refused); the API's unhandled-error log line now carries the stack. | ADR-081, 12 Sep 2026 | open | High |

### Open interest unknown vs zero

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 101 | The gateway wire (`QuoteDelta`, absent field = unchanged) cannot express an open interest that went from known to unknown; never produced today because both venue sessions carry the last figure forward and a restart re-seeds from REST (the periodic reload never replaces a quote newer than its own, so a carried figure lives until a frame brings one or the gateway restarts); that a compact tick omitting its oi cell means "not sent" rather than zero is Delta's documented shape, to be checked on the first live compact-channel run. The screener drops unknown-OI rows only when a positive minimum is set (an unknown figure cannot prove a minimum); the terminal's per-instrument OI analytics come from the separate ingest and were never affected. | ADR-085, 13 Sep 2026 | open | High |

### Options screener

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 92 | The screener ranks on the live chain only: there is no per-instrument IV rank (the mark history keeps 168 h per symbol and answers one symbol per request, so a rank column would need a per-asset history route), the screener is not plan-gated although the research note puts it behind the paywall (no entitlement key; add one when the plans are revisited), filters are not saved between visits, the gateway's topic limit (50 per connection) is not surfaced when it stops a far expiry from subscribing (the basis line then counts fewer priced expiries without saying why), and the `analyse-screener` screenshots await a successful local visual run. | screener build, 12 Sep 2026 · Low · Open | open · a `/v1/market/iv-by-instrument?asset=` route over a longer mark history; an entitlement key; a persisted filter preset | High |

### Passkeys

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 105 | The mock verifies no attestation or signature (a forged credential id signs in on the mock, never on the API); the seeded-user fixture cannot pre-register a passkey the virtual authenticator holds, so the e2e adds one first and covers no second device; no conditional UI / browser autofill; no passkey count on `/v1/me` or the settings menu row; a 2FA account cannot use a passkey as its second factor (the plugin does not offer it); the button is not shown on the Delta sign-in page or verified in the phone pass; on the real API the 2FA refusal of a passkey sign-in rests on ADR-078's allow-list default, not on a passkey test; adding a passkey needs a session younger than a day (the plugin's fresh-session rule; the app keeps the default fresh age), told to the trader in one sentence; the passkey e2e ran locally on 13 Sep 2026 (chromium project, one worker, one spec at a time) and runs in CI. | ADR-089, 13 Sep 2026 | open | High |

### Phone pass

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 96 | Desktop-first still: the venue switch (hidden below 768 px; switching venue on a phone needs the desktop for now), the terminal and admin tables, the column settings dialog, the chain picker and the screener table scroll sideways inside their container but are not laid out for a phone; the adjustment workbench stacks but its ticket rows are dense at 390 px; native tooltips (`title=`) are invisible on touch, so the hover-only hints (header widgets, chain cells, portfolio bar) have no phone equivalent; there is no bottom tab bar or install prompt (E4 mobile, item 23, covers the manifest, icons and service worker). | build, 12 Sep · Low · Open | Open · a phone layout for the screener and terminal tables; tap-to-show hints; then E4 | Medium |

### Playbooks

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 135 | Left out of the first playbooks: proposals, cards and Telegram delivery landed in PR 4 (ADR-102, GAPS #139 for its own leftovers); two research playbooks are not expressible on the engine (a calendar on a term-structure inversion and a butterfly centred on max pain need conditions the engine lacks) and the 14:30 to 16:30 IST expiry-day window needs intraday data; the size rule is a fixed 10 lots (volatility-based sizing deferred); the engine charges no perpetual funding, so the covered-call record (and any future perp-hedged playbook) overstates the real result by the funding paid (the research puts it at 9 to 12 points of return a year) and the card says so; the pass thresholds (twenty closed trades, positive net, positive out-of-sample half) are first guesses with no calibration behind them; ETH records share BTC's parameters; records are per venue and asset, not per plan tier, so the tab is open to every plan like the backtest (GAPS #93); the record's trial count is declared by the playbook author, not measured. | build 9 Nov 2026 | open | High |

### Pricing

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 84 | After ADR-066 the engine and the strategy analysis measure time on an injected calendar, but seven helpers still count act/365 to 12:00 UTC by their own arithmetic: `apps/web/src/lib/format.ts` `daysToExpiry` (ten UI call sites with only an ISO date in hand), `lib/strategy/paper.ts` `daysLeft`, `lib/strategy/analysis.ts` `nearestExpiryValuationMs`, `components/adjust/PositionTicket.tsx`, `components/analysis/VolHistory.tsx` (`sqrt(365)`), `packages/pricing/src/chain.ts` `expectedMove` (`sqrt(days / 365)`), the per-leg `yearFraction(...)` calls in `GreeksPanel.tsx` and `BuilderPanel.tsx`, the private 365 that converts theta to a day in `black76.ts` (and `bsm.ts`), and the schema's asset-keyed `settlementHourUtc` / `settlementMsOf`. Harmless while every venue is act/365; a venue with another day count or holidays needs them on `TradingCalendar` first. | pricing calendar build, 11 Sep 2026 | open · with the first non-act/365 venue | High |

### Proposals

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 139 | Left out of the first proposals: no intraday detection (a proposal is computed once a day from the settlement-hour chain, so a plan whose condition appears at 15:00 UTC proposes the next day) and no live-chain mirror in the browser by design; a proposal is not linked to the paper strategy the trader then creates (the mark says `taken`, nothing says which strategy came of it, so the Journal cannot yet show a plan's live record against its backtest); the Telegram cap is one number for every playbook and user, with no per-playbook mute; delivery runs on the first venue's snapshotter cadence (up to five minutes after the write) and only for `pass` records, so a `fail` or `insufficient` plan that enters is visible in the tab only; proposals are computed for Delta India and Deribit alike but Deribit records are before fees; the proposals of past days stay in the table unpruned (a day index exists; a retention job does not); no Playwright picture of the strip (the Playbooks tab is not in the visual suite), covered by unit tests and the real-stack probe only; `playbook_proposal_marks.proposal_id` was generated as a `bigserial` (an unused sequence and a nextval default on a foreign-key column; harmless, to become a plain bigint in a later migration rather than regenerating 0026 under the dev databases that already applied it); a PUT of settings from a client that omits `proposalsTelegram` switches the opt-in off (the zod default), acceptable because the web client completes every patch from its cache and the reset is fail-safe. | build 10 Nov 2026 | open | High |

### Public page

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 91 | The public trader route recomputes the verified figures from `venue_fills` on every uncached request (60 s `Cache-Control`, the global 300/min per-IP limit); a page that gets shared widely, or a scan over handles, costs a fills scan per hit. Also open: the reserved-handle list is a judgement call, the share card is a fixed dark design regardless of theme, the X intent uses the twitter.com host like referrals do, and a signed-in user can tell a handle is taken only through the 409 on their own save (the public route answers 404 alike). | build, 12 Sep · Low · Open | Open · a keyed limiter per handle and a stored figure refreshed by the fills job when a page is popular | High |

### Replay

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 95 | Replay shows only what was recorded: 5-minute steps reach seven days (the mark stream's retention) and the daily steps start on the first end-of-day chain; a symbol delisted before its expiry has no rows at later instants, and the recorded chain carries no open interest or volume, so the Structure tab's figures cannot be replayed. The expiries route reads the latest pass's symbols for "listed" (one indexed read per call, cached a minute). | build, 12 Sep · Low · Open | Open · open interest per row in chain_eod if the Structure tab ever replays; longer 5-minute retention only with a cost decision | Low (tests) |

### Resting orders

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 99 | Retry re-sends a cancelled entry at its stored price only (re-price before cancelling to change it); a cancelled entry's leg lingers open with no position until Retry, settlement or a square-off (no "drop the leg" action); a resting *exit* cannot be cancelled or re-priced (exits are market and reduce-only today); whether Delta keeps `client_order_id` across `PUT /v2/orders` is unverified against the live venue (the row keeps its id; a mismatch surfaces as an unknown outcome on the next sync); no batch cancel of every resting order of a strategy; the mock's re-price decides from the mark alone (no partial fills); two venue-contract assumptions the control flow rests on are unverified against the live venue: that `PUT /v2/orders` takes `{ id, product_id, limit_price }` without `size`, and that `DELETE /v2/orders` answers `success: false` for an order already filled (a cancel accepted with an unreadable read-back is booked as cancelled on that assumption); watch the first live exercise. | ADR-083, 13 Sep 2026 | open | High |

### Routes renamed to /desk, /plans, /invite

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 143 | Left for a follow-up: the design mock under `mockup-v2/` (sources, parts, bundles) still uses the old word in its code (`CG.analyse…`, `#/analyse`, `analyse:` events) and file names, and the feature records quote those names as evidence; earlier ADRs and GAPS rows keep the old route names as history; `mockup-clone/` is the reference copy and goes with the IP cleanup; the e2e and visual suites were not run on the laptop for this change (unit tests, typecheck and lint only), so the first CI run is the check of the renamed specs; no redirect is kept from the earlier addresses (no users yet), so a link to one in a message sent from a development stack is not found; the Linux pixel baselines need a refresh because the header now says Desk, Plans and Invite; branch names and research notes that contain the old word are left as they are. | ADR-106, 21 Nov 2026 | open | Low (tests) |

### Second factor on sensitive routes

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 102 | Backup codes are not accepted as a step-up (the authenticator app is the only source; a trader who lost the phone must turn 2FA off with the password first); the currency conversion rate is not gated although it colours every money figure; the step-up bypasses the plugin's own lockout by design and relies on its own budget (5 wrong codes / 15 min per user, in the rate store); the code is asked on every save that changes a knob or touches a key (no grace window after a right code); the admin column shows the state only, admins cannot reset a locked-out account; the header is read by the three routes only (a future sensitive route must opt in); the plugin accepts a code across its ~90 s window and keeps no last-used counter, so one observed code covers every change in that span; the admin's lot-size override (`PATCH /v1/admin/users/{id}`) writes `user_settings.lotSizes` under the admin guard only; a settings save that completes its body from a stale cache in a second tab (GAPS #45) can change a knob unintentionally and meet a refusal the Currency / P&L dialogs have no field for; the web tests do not exercise the 429 path; no e2e. | ADR-086, 13 Sep 2026 | open | High |

### Strategy Wizard

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 88 | The wizard values the thesis at the chosen expiry only: a target date before the expiry ("up 3 % by Friday" on a month-end expiry) is not offered, although the payoff pane can show it once the legs are loaded (move the days slider). Calendar-family templates are not candidates (they need the later chain, GAPS #76). The assistant answers "which strategy" by pointing at the wizard; it does not parse a free-text thesis into the inputs. The basis line shows no "updated N s ago" age (the design's §2). The `analyse-wizard-{dark,light}.png` screenshots are not yet in `e2e/__screenshots__`: the local Playwright run on 12 Sep died of memory (the Next dev server hit "Zone Allocation failed - process out of memory" three times while the other session's test runs shared the machine); the visual spec writes them on the next successful local run, and PR CI runs the e2e. | wizard build, 12 Sep 2026 · Low · Open | open · a target-date select decoupled from the expiry (value with `targetSpot` / `targetDays` per candidate, one repricing per input change); calendars once GAPS #76 is closed | Low (tests) |

### Strikes by premium and the monthly strangles

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 152 | The monthly study has eleven expiries (2026 only), hourly marks, overlapping entries, no margin, and is in-sample; the competitor's rule is known only from the owner's description; premium levels other than 100 daily and 200 weekly earned more with larger worst cases and are not offered; the monthly range, the premium, the percentages, the stop multiples and the take are constants; a monthly figure is the mean over every entry day of its range while Autopilot enters on the first evening only (the study prints no first-day row); the winged result with a stop (ADR-118) depends on model marks of far wings and on a trending year; while a monthly trade is open the next expiry's window passes as "Holds a trade already", which the study does not model; the study's premium pick has no half-premium refusal and its ladder is the fetched range, so the weekly 100-a-side row is probably cut short; the stops and the take are judged on hourly closes there and every two seconds here; only the 12 %-near take-half playbook is driven through the engine in a test; once per expiry is read from the stored structure text; a monthly trade holds its key until it ends; ETH and XAUT are not studied or offered yet (next); calendar spreads, skipping announcement days, strikes by expected move and a trend filter are still untested. | ADR-117, 22 Nov 2026 | open | High |

### Test

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 51 | `analyse.spec.ts` "legs and stripes survive a reload" failed once in a full Playwright run (the leg's side attribute was not yet on the chain row after reload) and passed on the immediate re-run of the spec (09 Sep). Likely a race between the persisted-legs restore and the first chain render; add an explicit wait on the legs count before asserting, and watch for repeats. |  | open | Low (tests) |

### Tests

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 78 | `apps/web/src/components/analytics/analytics-pages2.test.tsx` line 120 asserts the premium chart's empty note synchronously right after the page state settles; under the full parallel run (88 workers) it failed once on 11 Sep 2026 and passed on every rerun, alone and in the full suite. Fix: wrap that assertion in `waitFor` like the line above it. Second symptom (11 Sep 2026, twice in the stop hook's `pnpm test` while the dev stack was running): a vitest fork running `src/components/header/AppHeader.test.tsx` died with Windows exit code 3221226505 (STATUS_STACK_BUFFER_OVERRUN fast-fail) after every test in it passed; the file passes alone every time and the full suite passed 579/579 in the same hour. Environmental (88 forked jsdom workers plus the dev stack, 16 cores / 16 GB); `apps/web/vitest.config.ts` and `packages/ui/vitest.config.ts` now cap `maxWorkers` at 50 % (the ui Preview file died with "Zone Allocation failed" at one fork per core), after which both suites passed twice in a row with the dev stack running (11 Sep); the root `pnpm test` script now runs one package at a time (`--concurrency=1`): all twelve at once hit "JavaScript heap out of memory" with about 4 GB free, and at three at a time the api's PGlite forks still died beside the web forks; every package passes alone (CI runs `pnpm run ci`, unaffected). The line-120 `waitFor` fix is still to do. | Low | Open | High |

### Trade All → Live batch preview

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 103 | No per-strategy worst-loss figure in the batch (the dialog has no analysis result for saved strategies; the premium rule is the only wallet rule, as on a single placement without a client figure); the per-placement notional cap is not summed across the batch; a multi-account batch states the wallet rule without naming the account; the preview runs twice on a placement; the venue still has no pre-trade margin estimate (ADR-029), so margin in use is shown, never a rule; premiums received are not netted against premiums paid (placing the credit legs first would fund the rest, but the batch goes in the order given); the mock has one wallet and no account grouping; the single place route still flips a draft or paper row without a status guard; the wallet cache (one exchange read per account across the batch) is not asserted by a test (the fake trading client counts no balance reads); the batch preview route has no per-user budget beyond the global one although it opens the vault and reads the exchange per account on every re-check; no e2e. | ADR-087, 13 Sep 2026 | open | High |

### Trailing target

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 140 | Left out of the first trailing target: the backtest's exit rules have no trail (a daily judgement on settlement-hour marks would not describe the 2 s engine; needs intraday marks first); no stepped lock ("at +A lock +B, then every +X raise by +Y"), only the continuous trail; no trail on a single leg's mark or on the spot; the best is not reset by an adjustment (a roll or an added leg keeps the best reached before it); the exit is at the mark of the tick that saw the fall, so a gap can book less than the exit level shown on the card (the card does not warn beyond the Protect dialog's wording); the card's best and exit level come from the strategies list, refetched every 10 s, so they can lag the server by that long; nothing tells the trader the moment the trail starts (no message, only the card line changes); a close books its leg and the strategy total in separate statements, so a pass that reads between the two values the strategy without that leg's result for one tick (the total is now read beside the legs, which narrows the window from seconds to milliseconds; it exists for every rule kind and matters most for a trail); the dialog has no test in INR (ruleText has). From the code review of 17 Nov 2026. Not yet seen in a real browser against the dev stack or covered by a Playwright case. | build 17 Nov 2026 | open | High |

### Typed LIVE + TOTP

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 94 | No QR image for the authenticator key (needs a QR library; the key in groups of four and the otpauth link cover manual entry and same-device apps); no trusted-device option (the server refuses `trustDevice` on the verify endpoints, so every sign-in asks for the code; offering it means lifting that refusal knowingly); ~~the admin users table does not show whether an account has 2FA on; the API-key (credential) routes and the `/v1/settings` PUT take no second factor~~ (closed 13 Sep 2026, ADR-086: a fresh code on the key routes and on a settings save that changes the pause or the lot sizes, a 2FA column for admins; leftovers in #102); the passkey UI is still missing (GAPS #12); the typed word proves intent, not a human (a script that sends `confirm: "LIVE"` is not refused); the plugin's `twoFactorRedirect` never fires on the email-OTP, Google and passkey paths, so those are refused for a 2FA account rather than routed to the code step (the account must know its password); a refused Google sign-in has already linked the Google account row before the session is refused (harmless: the next password sign-in still asks for the code); a sign-in `send-verification-otp` answers 403 for a 2FA email and 200 otherwise, so an unauthenticated caller can learn whether an email has 2FA on (accepted for the plain sentence). | ADR-078, 12 Sep 2026 | open | High |

### Verified P&L

| # | Gap | Source | Status | Priority |
|---|---|---|---|---|
| 89 | The fills reader is written against Delta India's documented fill shape and the `meta.after` cursor, neither seen in a live response yet: a one-off capture was refused as it would have decrypted stored keys outside the app, so the first real read comes from the user's Refresh on the demo account, and the raw rows kept in `venue_fills` are the fixture. Also open: whether pages come newest first (the walk assumes it and would otherwise read only its first pass), fills history depth (how far back the venue pages), whether an expiry settlement shows up as a fill or only in the wallet ledger (a settled-at-expiry option would then realise nothing here), commission asset assumed to be the settling asset (USD), and the P&L float convention (cents can differ from the venue's statement). | build, 12 Sep · Medium · Open | Open · read once with the demo key, then pin the parser to the real shape and record a sanitised fixture | High |

## 3. Screens built on mock data (62 spec rows)

These screens render and are tested, but the number they show comes from the mock catalogue until a paid or additional data feed is connected (roadmap 16). They are marked "coming soon" in the product where a whole page is affected.

| ID | Screen | Feature | What is missing |
|---|---|---|---|
| HC-SH-044 | Shared chrome · P&L Settings dialog | Explanatory note about mark vs bid/ask differences | Static info alert with the bundle text ('…so the two figures will differ — usually by the bid/ask spread, and more on illiquid strikes.') |
| HC-PB-004 | Landing page | Hero: ‘LIVE ON DELTA EXCHANGE’ mono tag with pulsing dot, headline “Trade Crypto Options / Like a Pro” (second line muted, no gradient), lead paragraph, 6 check bullets | Copy unchanged; dark ground, no gradient washes |
| HC-PB-006 | Landing page | Hero product visual: terminal mock built from live CG.chain / CG.analyze data — top bar (asset segments, futures price, ATM IV, expected move, feed, Ctrl K), 11-row mirrored chain (Δ · OI · Mark/IV \| Strike \| Mark/IV · OI · Δ, ITM tint, amber ATM row, OI bars, leg outlines), builder strip, payoff tiles + chart, scenario matrix, portfolio bar | CG.pubTerminal(kind) (alias CG.pubMock); the BTC price in the mock updates on every tick |
| HC-PB-007 | Landing page | Floating hero chips replaced by data inside the terminal (Bull Call Spread legs with Δ/Θ, max profit / max loss / breakeven / POP tiles, 5×4 P&L matrix) | Absolutely positioned cards around the mock; the mini frame lifts on hover |
| HC-PB-010 | Landing page | WHY HAPIECOIN? “Stop Guessing. Start Trading Smart” — two-column comparison table: Without HapieCoin (× rows, muted) vs With HapieCoin (✓ rows) | Same 5 + 5 statements as v1 rendered as a table |
| HC-PB-012 | Landing page | CAPABILITIES “Built for Serious Traders” — 6 hairline cells (two wide) in one bordered grid | 4-column grid; the two “large” cards span 2 columns exactly like the original; hover lift |
| HC-PB-013 | Landing page | MARKET ANALYTICS “Liquidations & Market Pulse” — 24H Total Liq / Long Liq / Short Liq / Top Coin stat cells | Values come from CG.mock.global (liq24h, longLiq24h, shortLiq24h, topLiqCoin) formatted as $214.00M etc. |
| HC-PB-014 | Landing page | “Live liquidation pattern · last 40 intervals” bar sparkline | 40 bars from the last 40 entries of CG.mock.liqHistory; height ∝ long+short, red when long liquidations dominate, green otherwise; bars grow in on view and show a tooltip with the hourly values |
| HC-PB-016 | Landing page | EVERYTHING YOU NEED “Full Feature List” — 6 hairline cards × 6 bullets | Exact bullet copy from the bundle's jot[] array rendered in a 3-column grid |
| HC-PB-018 | Landing page | INTEGRATIONS “Supported Exchanges” — Delta Exchange (● LIVE, Connected via API) plus CoinDCX, CoinSwitch, Mudrex (Coming Soon) | Text-logo tiles; the live card is highlighted, coming-soon cards are dimmed to 60% like the original |
| HC-PB-023 | Sign in / Sign up | Split layout: panel-tone brand column (mono eyebrow, “Master Options Trading” with amber word, paragraph, 4 hairline feature rows, live futures ticker, mono copyright) + form column | Glows and grid backgrounds removed |
| HC-WS-061 | Greeks | 'Understanding Greeks' explanations for Delta, Gamma, Theta and Vega | Static explanatory cards (Delta and Gamma/Vega texts as in the original) |
| HC-AC-004 | My plan | Current plan summary strip: Billing / Price / You Pay / Currency / Valid until | Five-cell mono stat strip under the plan header (micro labels, tabular numbers, struck list price with % off pill, days-left pill); Feature Limits and Plan Features sit side by side below it |
| HC-AC-007 | My plan | Features & Usage → Plan Features list | Check-marked two-column bullet list from plan.features of the subscribed plan |
| HC-AC-011 | My plan | Available Plans heading | Section heading with subtitle; anchor target for Choose a Plan / Upgrade |
| HC-AD-004 | Subscription Plans | Page title + subtitle | Slim title row: 'Subscription Plans' / 'Manage subscription tiers and pricing' left, the single amber primary action right, hairline underneath |
| HC-AD-020 | Menu Pricing Master | Page title + subtitle | 'Menu Pricing Master' / 'Manage menu items linked to subscription plans' |
| HC-MA-047 | Derivatives | Chart: Basis · Perp/spot basis % · positive = contango (± bars) | Amber bars for contango, red for backwardation, hourly |
| HC-MA-055 | ETF | Tiles: 7-day net flow, Total AUM, Funds tracked | Sum of last 7 flows, sum of fund AUM (+ coins held), count of funds |
| HC-MA-056 | ETF | Chart: Daily net inflow/outflow (USD) with price overlay · last 60 sessions | Heat-coloured ± bars (inflow green / outflow red) with the asset price line on the right axis; tooltip |
| HC-MA-057 | ETF | Chart: Cumulative Net Flow (area) | Running total of flows since launch |
| HC-MA-058 | ETF | Table: Per-fund AUM, holdings and daily change (Ticker, Fund, Type, Price, 24h %, Volume, AUM, Holdings, Δ 24h) | Sortable; Spot badge; heat cell for 24h %; holdings in BTC/ETH; Δ 24h coloured |
| HC-MA-059 | ETF | Table: Grayscale Holdings · Trust holdings & premium/discount (Asset, Holdings, Value, Premium, Δ 30d) | Grayscale funds from both ETF lists; premium and Δ 30d as heat cells |
| HC-MA-072 | Whales | Table: Exchange BTC Reserves · On-chain balances · falling reserves = supply leaving exchanges (Exchange, BTC Balance, Δ 24h, Δ 7d, Δ 30d) | CG.mock.exchanges balances with heat cells for each Δ |
| HC-MA-077 | Sentiment | Chart: AHR999 Accumulation Index · < 0.45 bottom zone · > 4 top zone | Log-scale area with 0.45 (green) and 4 (red) reference lines |
| HC-MA-078 | Sentiment | Chart: Puell Multiple · Miner revenue vs 365d average | Amber area with 0.5 / 4 reference lines |
| HC-MA-115 | ETF | Timeframe chips on Net Flows and Cumulative Net Flow | Net flows 7D/30D/90D/1Y (daily bins, generated flows for ranges beyond the mock), cumulative 30D/90D/1Y; funds table has Columns ▾ + CSV |
| HC-MT-007 | Market Analytics terminal | Header "Live" indicator | Live pill (green dot) in the shared header, hidden on small screens |
| HC-MT-011 | Market Analytics terminal | Sidebar section labels: Markets, Derivatives, ETF, On-chain, Indicators | Grouped navigation with small inline-SVG icons |
| HC-MT-031 | Market Analytics terminal | Footer note "Market data · auto-refreshing · intervals vary per dataset" | Rendered by CG.chrome["terminal-footer"] on every terminal screen |
| HC-MT-034 | Market Analytics terminal | Chart legends | Multi-series charts show a colour legend above the plot |
| HC-MT-037 | Market Analytics terminal | Number formatting: .ma-mono numbers, .ma-up/.ma-down colours | Prices with 2/4/8 decimals by magnitude, compact USD ($1.23B), signed % in green/red, funding to 4 decimals |
| HC-MT-039 | Market Analytics terminal | Extra coins added to CG.mock.coins at init | MNT, METIS, ZK, COMP, DYDX, SUSHI, 1INCH, MEME, POPCAT, BRETT added with plausible numbers so every sector symbol resolves (50 coins total) |
| HC-MT-045 | Dashboard | Stat tile "BTC ETF Net Inflow (USD) · Net Flow" | last CG.mock.etfFlows flow, green/red by sign |
| HC-MT-068 | Bitcoin Spot ETFs | Page title "Bitcoin Spot ETFs · Issuer flows, AUM and holdings" | Behaves as in the v2 mock. |
| HC-MT-069 | Bitcoin Spot ETFs | Stat tile "Total AUM" | sum of aum over CG.mock.etfs (bitcoin) |
| HC-MT-070 | Bitcoin Spot ETFs | Stat tile "Total BTC Held" | sum of btcHeld with USD equivalent |
| HC-MT-071 | Bitcoin Spot ETFs | Stat tile "ETF Count" | number of spot funds tracked |
| HC-MT-072 | Bitcoin Spot ETFs | Stat tile "Net Flow (1d)" | sum of flow1d, green/red by sign |
| HC-MT-073 | Bitcoin Spot ETFs | Chart "Net Inflow History · Net Flow USD" (bars) | CG.mock.etfFlows daily flows; positive bars accent, negative bars red; hover tooltip |
| HC-MT-074 | Bitcoin Spot ETFs | ETF List column "Ticker" (sortable) | from CG.mock.etfs |
| HC-MT-075 | Bitcoin Spot ETFs | ETF List column "Issuer" (sortable) | issuer with fund name underneath (ma-dim) |
| HC-MT-076 | Bitcoin Spot ETFs | ETF List column "AUM" (sortable) | from CG.mock.etfs |
| HC-MT-077 | Bitcoin Spot ETFs | ETF List column "BTC Held" (sortable) | from CG.mock.etfs |
| HC-MT-078 | Bitcoin Spot ETFs | ETF List column "Net Flow (1d)" (sortable) | signed compact USD in green/red |
| HC-MT-079 | Bitcoin Spot ETFs | ETF List column "Change %" (sortable) | from CG.mock.etfs |
| HC-MT-081 | Coin detail | Coin header: icon, symbol, name, rank chip, sector chip, price, 24h % | Sector chip links to the sector page; BTC/ETH/XAUT price updates live on the 2.5s CG tick with a green/red flash |
| HC-MT-106 | Exchange overview | Stat tile "24h Volume" | exchange volume24h |
| HC-MT-107 | Exchange overview | Stat tile "BTC Balance" | exchange btcBalance with 24h % change |
| HC-MT-135 | Exchange Balance | Page title "Exchange Balance · Bitcoin held on exchanges" | Tiles: Total BTC Balance, 24h / 7d / 30d change |
| HC-MT-136 | Exchange Balance | Chart "BTC Balance" (area, 90 days) | Derived 90-day series anchored to CG.mock.global.btcExchangeBalance (CG.terminal.exchBalance) |
| HC-MT-137 | Exchange Balance | Table column "Exchange" (sortable) | from CG.mock.exchanges btcBalance / btcBalanceChg*; row click opens the exchange page |
| HC-MT-138 | Exchange Balance | Table column "BTC Balance" (sortable) | from CG.mock.exchanges btcBalance / btcBalanceChg*; row click opens the exchange page |
| HC-MT-139 | Exchange Balance | Table column "24h %" (sortable) | from CG.mock.exchanges btcBalance / btcBalanceChg*; row click opens the exchange page |
| HC-MT-140 | Exchange Balance | Table column "7d %" (sortable) | from CG.mock.exchanges btcBalance / btcBalanceChg*; row click opens the exchange page |
| HC-MT-141 | Exchange Balance | Table column "30d %" (sortable) | from CG.mock.exchanges btcBalance / btcBalanceChg*; row click opens the exchange page |
| HC-MT-142 | Token Unlock Schedule | Page title "Token Unlock Schedule · Upcoming vesting events" | Behaves as in the v2 mock. |
| HC-MT-143 | Token Unlock Schedule | Empty panel "Token unlock data unavailable" | Exact text: "This data source is not enabled on the current plan. Enable a token-unlock endpoint in the proxy to populate this view — no mock data shown." |
| HC-MT-149 | BTC Cycle Indicators | Panel "AHR999" (area chart) | CG.mock.cycleHistory ahr999 with Bottom 0.45 / Top 1.2 reference lines |
| HC-MT-150 | BTC Cycle Indicators | Panel "Puell Multiple" (area chart) | cycleHistory puell with Undervalued 0.5 reference line |
| HC-MT-163 | Bitcoin Spot ETFs | Timeframe chips on Net Inflow History | 7D/30D/90D/1Y; CSV on the ETF list |
| HC-MT-171 | Exchange Balance | Timeframe chips 30D/90D/1Y + heat cells for % + CSV | Shared chart + table |

## 4. How to use this page

- A launch bug is not backlog: it goes to GAPS.md as a row and gets fixed on a branch.
- To schedule an item, move it back to ROADMAP.md with a number and an owner; leave the GAPS row until the fix merges.
- Regenerate §2 and §3 from GAPS.md and the spec with `node spec/gen-backlog.js` rather than editing them here.
