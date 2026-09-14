# HapieCoin feature guide

HapieCoin is a crypto options strategy builder for Delta Exchange India: BTC, ETH and XAUT options and futures, a live options chain, a strategy builder with 48 templates and a wizard, payoff and greeks analysis, paper and live trading with rules, an adjustment workbench, a journal with exchange-verified P&L, alerts, market analytics, subscriptions, referrals, an admin console, a phone layout and a home-screen app.

This guide is written for two readers at once: someone testing the product by hand, and someone explaining it to others. Each area page has a plain-language overview, a numbered **Try it** walkthrough, screenshots, and a table of every traced feature with the rule its tests check. The build is frozen at main `933dcdc` (13 September 2026); what is not built is in [../BACKLOG.md](../BACKLOG.md), and the launch assessment is in [../GO-LIVE-READINESS.md](../GO-LIVE-READINESS.md).

## The product in one pass

1. [Public site and sign-in](01-public-site.md): landing, sign-up with an emailed code, sign-in with password, Google, passkey or authenticator code, the free payoff preview, legal pages, and every trader's public page.
2. [Workspace chrome, settings and dialogs](02-workspace-and-settings.md): header, portfolio bar, the settings gear (profile, API keys and accounts, currency, lot sizes, P&L basis, Mindful pause, security, public page), command palette, shortcuts, tour and assistant.
3. [Options chain and the analysis tabs](03-chain-and-analysis.md): the live chain, column settings, payoff, greeks, ladder, scenarios, vol, structure, screener, backtest, replay and share.
4. [Strategy Builder, templates and the wizard](04-builder-templates-wizard.md): legs, ticket, select-from-chain, the 48-template catalogue, the wizard, server-side drafts.
5. [Paper trading, live trading, rules and accounts](05-paper-and-live-trading.md): the trade flow, cards, details, square-off, partial exit, rules, go-live with the typed LIVE word and the Mindful pause, batch preview, resting orders, accounts, settlement and reconciliation.
6. [Adjustment workbench](06-adjustment-workbench.md): change an open position with before → after tiles, plans, review and confirm.
7. [Journal, verified P&L and the public page](07-journal-and-verified-pnl.md): closed trades, stats, equity curve, tags, CSV, verified fills.
8. [Alerts](08-alerts.md): price, IV and P&L alerts by push, email and Telegram.
9. [Subscription, billing and referrals](09-subscription-and-referrals.md): plans, coupons, Razorpay checkout, invoices, entitlements, referral commissions.
10. [Admin console](10-admin.md): plans, pricing, coupons, subscriptions and commissions, banners, promotional emails, users.
11. [Market Analytics](11-market-analytics.md): hub, markets, derivatives, options, liquidations, whales, sentiment, coins.
12. [Market Analytics terminal](12-terminal.md): dashboard, spot, sectors, exchanges, open interest, funding, long / short, indicators, coin detail.
13. [Phone and the home-screen app](13-phone-and-home-screen.md): the stacked layout, touch chain, install and offline.
14. [Platform and operations](14-platform-and-operations.md): limits, replicas, the venue port, error tracking and metrics.

## Run the app on your machine

```
pnpm db:up                                   # Postgres + Redis in Docker
pnpm --filter @hapiecoin/schema --filter @hapiecoin/pricing --filter @hapiecoin/venues --filter @hapiecoin/ui build
pnpm dev                                     # web :3000, api :3001, gateway :3002, ingest
pnpm --filter @hapiecoin/api db:seed         # once: the admin account, the Delta broker, the plans
```

Open http://localhost:3000. Sign up with any email: without a Resend key the API prints the code in its log as `[mail] to=<email> otp=<code>`. The seeded admin account is the one in `apps/api/src/db/seed.ts`; sign in with it to reach `/admin`. Live trading needs a Delta Exchange API key entered in Settings → API Settings; nothing in this guide places a real order unless you do that on purpose.

## Run the feature tests yourself

The Playwright suites are the executable version of this guide: 109 desktop tests (26 of them the screenshot captures in both themes) and 5 phone tests run on two device profiles, titled by the feature ids you see in the tables. They run against a mock exchange and API (`apps/web/test/mock-api.ts`, `fake-gateway.ts`) started for you on ports 3100–3102, so they never touch the real exchange and need no keys. Stop `pnpm dev` first (the two stacks compete for memory).

| What you want | Command (from `apps/web`) |
|---|---|
| Watch tests run in a browser, pick any test, step through it | `pnpm test:e2e:ui` |
| Run everything headed, one at a time | `pnpm test:e2e:headed` |
| Run one area, for example trading | `npx playwright test analyse --headed --workers=1` |
| The phone layout on a Pixel 7 and an iPhone 14 profile | `npx playwright test --project=phone --project=phone-ios --workers=1` |
| Open the last run's report with a screenshot trace of every test | `pnpm test:e2e:report` |

In UI mode, each test lists its actions on the left and shows the page on the right; click any action to see the screen at that moment. In the report, each test has a **Trace** with the same replay plus network calls. Mock accounts use the password `Passw0rd!` and the one-time code `123456`.

Which suite covers which area:

| Suite | Areas |
|---|---|
| `auth.spec.ts` | sign-up, sign-in, OTP, Google, two-factor, passkey, referral code |
| `public.spec.ts` | landing, legal pages, payoff preview, share landing, public trader page, assistant on the public site |
| `analyse.spec.ts` | chain, builder, templates, wizard, analysis tabs, paper and live trading, rules, workbench, journal, alerts, screener, backtest, replay, tour, assistant |
| `settings.spec.ts` | every settings dialog, security (two-factor, passkeys), public page, exchanges, API keys and accounts |
| `account.spec.ts` | subscription, checkout, coupons, invoices, referrals, entitlements |
| `admin.spec.ts` | plans, pricing, coupons, subscriptions and commissions, banners, emails, users |
| `analytics.spec.ts`, `terminal.spec.ts` | every Market Analytics and terminal page |
| `visual.spec.ts` | the screenshots in this guide, dark and light |
| `phone.spec.ts` | the phone layout, touch chain, install and offline |
| `guide.spec.ts` | the extra screenshots for this guide |

## How this guide is kept true

The overviews and walkthroughs are written by hand. The feature tables are generated from `spec/traceability.json`, the same file the tests are titled from, so a feature cannot be in the product without a row here, and a row cannot claim a test that does not exist. The screenshots are the ones the Playwright runs write under `apps/web/e2e/__screenshots__` (the visual suite for the main screens in both themes, `guide.spec.ts` for the rest); the pages link to them there, so a rerun of `npx playwright test visual guide` refreshes every picture.
