# HapieCoin go-live readiness (13 September 2026)

Build under assessment: main `933dcdc` (PR #95) plus the fixes on `chore/go-live-docs` listed in §3. Feature set frozen (ADR-090); everything not built is in [BACKLOG.md](BACKLOG.md). The feature guide with screenshots is in [guide/README.md](guide/README.md).

## 1. Verdict

The product is complete for a first launch and every feature has passed its tests on this machine today. It is **not deployable yet**: the deployment itself (roadmap item 13) has not started, three engineering tasks remain before the first deploy, and five decisions are still yours (§6). Nothing found today needs a code change beyond the one defect fixed in §3.

What "good" means here, honestly:
- **Trading on the fake venue is proven end to end** (paper and live flows, rules, settlement, reconciliation, the workbench, resting orders, the batch preview, the typed LIVE word, the Mindful pause). Against the real Delta Exchange, only read paths have been exercised on the demo account (positions, wallet, sub-account key scoping). The real fill shape for verified P&L is unread until you press Refresh once with a real key (GAPS #89). Treat the first live orders as a supervised canary, not a launch-day feature.
- **Everything else** (accounts, billing, referrals, admin, analytics, alerts, phone, home-screen app) is exercised by the suites below on a mock API that mirrors the real one contract for contract. The real API is covered by its own 398 unit and integration tests on an in-process Postgres.
- **Payments** work through Razorpay's test keys and checkout; the webhook path is not wired (GAPS #49), so a payment whose tab closed early stays Pending until support settles it by hand.

## 2. What was verified today, and how

All runs were on this laptop, alone, with the dev stack stopped. Commands are the ones in CI.

| Check | Command | Result |
|---|---|---|
| Typecheck, lint, unit + integration tests with coverage floors, production build, all 8 packages | `pnpm turbo run typecheck lint test:coverage build --force --concurrency=1` | 34 of 34 tasks passed |
| Unit and integration tests | part of the above | 1,889 passed, 1 skipped: ui 80, pricing 116, schema 220, venues 155, ingest 59, web 746, api 398, gateway 115 |
| Desktop end-to-end, every suite, with traces | `playwright test --project=chromium --trace on --workers=1` | 109 passed in 9.6 min |
| Phone layout and home-screen app, Pixel 7 and iPhone 14 profiles | `playwright test --project=phone --project=phone-ios --workers=1` | 10 passed in 1.1 min |
| Regression test for the defect in §3 plus the analytics suite | `playwright test analytics --workers=1` | 10 passed |
| Guide screenshots (35 extra screens) | `playwright test guide --workers=1` | 8 passed |

Coverage floors held: pricing and schema at 100 % lines, the API at 95 %, the web app above 90 %. The GitHub Actions gate (`ci.yml`) runs the same commands on Linux on every pull request and builds the API and gateway images on main; the `smoke.yml` workflow can be run by hand against real Delta market data.

The Playwright report with a step-by-step trace of every test is in `apps/web/playwright-report` after any run (`pnpm test:e2e:report`); the guide's README explains how to watch the tests run.

## 3. Defects found on this pass

| # | Where | What | Fix |
|---|---|---|---|
| GAPS #106 | `/analytics/markets`, `/analytics/derivatives`, `/analytics/options` | React "Hydration failed": each page sat in its own Suspense boundary, hydrated after the shell had fetched the markets snapshot, and rendered "ready" against a server render of "loading". Invisible to the trader (React re-renders on the client) but every visit would have logged a browser error to the error sink. | Boundaries removed (the routes are dynamic, so `useSearchParams` needs none); a regression test in `analytics.spec.ts` asserts no hydration error on the three pages. |

Not a defect: one "attributes didn't match" warning about a `caret-color` style on the coin search box appeared only while the guide spec took full-page screenshots of terminal pages. It did not reproduce in the probe or in any product suite, and matches Playwright hiding the text caret during screenshots.

Not reproduced today: GAPS #78 (a web unit test that failed once under a fully parallel run on 11 September). The suite passed twice today, with two workers and inside the gate.

## 4. What stays unverified until launch

| Area | Why it cannot be verified here | How it gets verified |
|---|---|---|
| Real Delta fills and the verified P&L parser (GAPS #89) | Reading stored keys outside the app was refused by design | Your first **Refresh** in the Journal with a real key; the raw rows are kept so the parser can be pinned |
| Live order behaviour on the real venue beyond reads | No real orders from tests or tooling, ever | A supervised canary: one small defined-risk strategy on a sub-account, watched through Details, Reconcile and the Journal |
| Real Safari and iOS install (GAPS #98) | No WebKit on this machine; the iPhone profile ran on Chromium | A device check after deploy: Add to Home Screen, standalone display, the status bar |
| Email delivery (sign-up codes, alerts, campaigns) | No Resend key locally; codes are printed to the API log | Resend domain verified (SPF, DKIM) and one sign-up on the deployed stack |
| Razorpay live keys and the webhook (GAPS #49) | Test keys only; the webhook needs a public URL | Live keys in the secret store, webhook registered, one real ₹ payment refunded |
| Telegram alert delivery | No bot token locally | Token in the secret store, one linked chat, one triggered alert |
| Production build and memory on a server | The laptop ran out of commit memory for the build twice this week; the gate passed when run alone | CI builds it on every PR; the deploy runs the image, not this laptop |
| Backups and restore | Nothing provisioned | A restore drill on the staging database before the first real user |

## 5. Risks in the frozen build, by severity

From the 56 open gaps; the full text of each is in the backlog.

**High (money, safety or a product promise): fix or accept before real money**
- #49 Razorpay webhook not wired: closed-tab payments stay Pending; refunds and proration are manual.
- #89 Verified P&L parser unproven against a real fill response.
- #82 Stop and target rules fire only from the API every 2 s from public tickers; while the API is down nothing fires (the arming dialog says so). Acceptable for launch if the API is monitored (uptime check on `/healthz`).
- #67 partly closed: exchange-level stops or manual closes on Delta are detected by the drift check and Reconcile, not pushed; a trader who trades outside the app must press Reconcile.
- #77 Margin estimate understates calendars and diagonals (the preview says so); the exchange's own number wins at placement.
- #99, #103 Resting-order and batch-preview edges: a cancelled entry's leg lingers until Retry or square-off; the batch preview has no per-strategy worst-loss figure and does not sum the notional cap.
- #100 The Mindful pause stamp is per API replica; run one replica or accept a second preview.
- #102 Backup codes are not accepted as a step-up; a trader who lost the phone turns 2FA off with the password first.

**Medium: launch as is, schedule after**
- #19 First-load bundle on `/analyse` is 385 KB gzipped against a 350 KB budget (a CI warning). Roadmap 29 is the fix.
- #94, #105 Two-factor has no QR image (manual key entry works); passkeys have no autofill UI and the mock cannot verify signatures (the real API does).
- #91 The public trader page recomputes from fills on every uncached request; fine at launch volume, a keyed limiter later.
- #93 Backtest is open to every plan; the paywall needs a plan feature flag.
- #85, #87 Accounts scoping confirmed on Delta; a second trading venue needs three API seams generalised.
- #96, #98 Phone: the venue switch and the terminal and admin tables stay desktop-first; real Safari unchecked.
- #97 better-auth's own 500s bypass the error sink; no traces beyond the request histogram.
- Analytics data gaps (#55–#60, #63): ETF flows, reserves, unlocks, per-coin liquidation history need paid feeds; those pages say "coming soon".

**Low**
- Test hygiene (#13 real Redis in CI, #20, #51, #78), build seams (#36 dev alias, #18 package boundary), naming (#8), the impersonation decision (#47), landing extras (#54).

## 6. Launch checklist

**Engineering, before the first deploy (small, not features)**
1. `apps/web/Dockerfile` (Next standalone output) and `apps/ingest/Dockerfile`, on the pattern of the API and gateway ones; tag by git SHA. (deploy.md step 1, not done.)
2. A compose or provider manifest for the five processes plus Postgres with TimescaleDB and Redis; the API runs migrations at boot with one replica during a deploy.
3. Secrets generated once and stored in the provider's secret store, never in the repo: `BETTER_AUTH_SECRET`, `CREDENTIALS_ENC_KEY`, `DATABASE_URL`, `REDIS_URL`, `METRICS_TOKEN`, `ERROR_SINK_DSN` (optional), `TRUSTED_PROXY_IPS`, `EGRESS_IP`, plus the keys in the next list as you provide them.

**Decisions and accounts you own**
4. Hosting provider and region (deploy.md §4 recommends one India-region VPS with Docker Compose and Caddy; DigitalOcean BLR1 or Linode Mumbai) and who holds the `hapiecoin.com` DNS.
5. Resend: sending domain verified and `RESEND_API_KEY`.
6. Razorpay: live `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`, and the webhook URL plus `RAZORPAY_WEBHOOK_SECRET` (GAPS #49).
7. Telegram: `TELEGRAM_BOT_TOKEN` for alert delivery.
8. Whether the smoke job runs nightly against staging or only before releases.

**First day on the deployed stack**
9. Release check from deploy.md §3.7: API and gateway `/healthz` 200, the gateway lists expiries, a sign-up with a real emailed code, a paper trade from a canary account, the alerts bell reads.
10. Add a real Delta key on a sub-account with a small balance; Refresh the Journal once (pins the fills parser); place one small defined-risk live strategy and watch it through Details, Reconcile and square-off.
11. Device check on an iPhone and an Android phone: layout, install, offline page.
12. Restore drill: take a backup, restore it to a scratch database, sign in against it.

## 7. Where the numbers come from

- Spec: 1,011 traced features across 155 screens; 949 built and tested, 62 on mock data (backlog §3).
- Decisions: ADR-001 to ADR-090 in [DECISIONS.md](DECISIONS.md). Gaps: 106 rows in [../GAPS.md](../GAPS.md), 56 open, listed in full in the backlog.
- Test titles carry the feature ids, so any row in the guide can be traced to the test that proves it.
