# HapieCoin roadmap (kept current; last edit 10 Sep 2026)

Order agreed with the user. One PR per line unless grouped. Status: ⬜ not started · 🔨 in progress · ✅ merged.

## A. Trade lifecycle (ADR-059; docs/design/trade-lifecycle.md; mockup trade-lifecycle-v1.html)
1. ✅ Pre-filled strategy names · start and expiry with days left on every card · lifecycle chips Open / Expiring ≤ 1d / Closed · sort by expiry · capital block on the trade preview (required, available, fees, after) (HC-TR-155..158)
2. ✅ Overlap line in previews and workbench Review · drift check vs. the exchange · out-of-sync badge · Reconcile (HC-TR-159..161; GAPS #67 partly) · MERGED PR #55 (11 Sep) · deferred: server-side drift pass, Re-enter
3. 🔨 Expiry settlement job · close reasons (expired · squared off · stopped · outside the app) · Journal shows the reason (GAPS #66) · BUILT on feat/trade-lifecycle-3 (HC-TR-162..164): settler at intrinsic from the snapshot spot, closeReason on legs and strategies, chips on closed cards, Journal + CSV
4. 🔨 Stop and target rules run by HapieCoin: strategy stop / target in money or %, leg stop, spot level; Protect step in the trade flow; card, Details and workbench entry points; 1 s quote feed in the API; audit, Telegram; paper too; time rule after · A4a BUILT on feat/trade-lifecycle-4 (HC-TR-165..168): strategy stop + target in money or %, server engine from the public marks every RULES_TICK_MS, paper too, card / Details / Protect step, audit + Telegram; A4b BUILT on feat/trade-lifecycle-5 (HC-TR-169..172): leg stop (× entry or price, one leg or all), spot level, time exit (at an instant or days to expiry), the workbench Protect entry, Re-enter from a closed card
5. ⬜ Accounts: several labelled keys per exchange (Delta sub-accounts), strategy → account, positions and drift per account
6. ⬜ Re-enter a stopped strategy from the card (one click, with preview)

## B. From the competitor research (docs/research/competitors-sensibull-opstra.md)
7. ⬜ Verified P&L: P&L from Delta fills, public page per trader, share to X / Telegram, one exchange account per HapieCoin account
8. ⬜ Easy Options / Strategy Wizard: view + target + date → ranked defined-risk strategies over the templates and the fix ranking
9. ⬜ Backtest and replay on our own IV / mark snapshots (EOD strategy backtest; replay an expiry's chain)
10. ⬜ Mindful Trading pause before a live order when down on the day
11. ⬜ Options screener on the chain data (IV rank, premium per day, skew)
12. ⬜ Phone pass on the workspace, cards and dialogs

## C. Go-live and business
13. ⬜ Deployment (docs/deploy.md) — waits on the hosting provider choice; then DNS, Resend, Razorpay live keys, Telegram bot token
14. ⬜ Delta Exchange India partnership conversation (broker-pays or affiliate; reuses the referral / commission machinery)
15. ⬜ Free tier vs. Pro split tuned to the competitor anchor (₹392–800 / month); education funnel (English + Hindi) tied to paper trading
16. ⬜ Paid-data analytics rows — only with the user's go-ahead on spend

## D. Strategy catalogue (ADR-060; docs/research/platform-roadmap-2026-09.md §1–2; runs beside A)
17. ✅ (PR #50) Templates can hold a perpetual future leg (`TemplateLeg` union, `no-spot` refusal, count derived from the catalogue) (GAPS #74)
18. ✅ (PR #51) Catalogue to 48: Long / Short Perp, Covered Call, Protective Put, Collar, Covered Put, Synthetic Straddle, back and ratio spreads 1x2, diagonals, double diagonal, calendar strangle, broken-wing butterflies, risk reversal, ladders; `tags` badge, no new tab
19. ✅ (PR #52) Per-template textbook invariants test (max profit / loss shape, breakeven count, outlook) on an arbitrage-free synthetic ladder (GAPS #75)

## E. Platform (ADR-060; docs/research/platform-roadmap-2026-09.md §3–5; after C13)
20. 🔨 E1 venue port: ✅ step 1 (ADR-063) `VenueAdapter` + `VENUE_REGISTRY` + `DELTA_INDIA` (no behaviour change) → ✅ step 2a (ADR-064) browser-safe `@hapiecoin/venues/core`, the web client on the port → ⬜ step 2b `venue` column and instrument-id widening → pricing with `q`, `TradingCalendar`, American flagged → Deribit data-only adapter and per-venue gateway feed
21. ⬜ E2 currency: `Money { amount, ccy }`, ISO-4217 display list, ECB reference rates via ingest (`fx_rates`, `GET /fx`), manual override with a basis badge; billing stays INR
22. ⬜ E3 languages: next-intl, cookie locale, chrome → dialogs → settings → content; Hindi, Tamil and Telugu together; per-locale assistant match tables
23. ⬜ E4 mobile: viewport, manifest, icons, service worker, Playwright Pixel 7 + iPhone 14 phone specs, tap targets on the chain → Capacitor shell with native push and biometric unlock (Play Store, App Store)

## F. Hardening (docs/research/platform-roadmap-2026-09.md §6; with C13)
24. ✅ (ADR-061) `.github/workflows/ci.yml` (`pnpm ci` + `check:budget` + e2e), dependabot, LICENSE (GAPS #69)
25. ✅ (ADR-061) API `bodyLimit` and a per-route limiter on `/live/place`, `/live/batch`, `/live/positions/exit` (GAPS #70)
26. ✅ (ADR-062) Replica guards for the reconciler and Telegram poller; gateway feed-leader lock (GAPS #16, #71)
27. ⬜ Error tracking and API metrics (GAPS #72)
28. ⬜ TOTP second factor and a typed LIVE confirmation before a live order (GAPS #73)
29. ⬜ `zod/mini` for `@hapiecoin/schema`; bundle check inside `pnpm ci` (GAPS #19)

## Done this week
- ✅ Trade lifecycle item 1 (PR #47, ADR-059)
- ✅ Workbench H2 pass and four follow-ups (PRs #42–#46, ADR-058)
- ✅ Key rotation + smoke (PR #39), IV history (PR #40), server alerts + Telegram (PR #41)
