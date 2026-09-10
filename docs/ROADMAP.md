# HapieCoin roadmap (kept current; last edit 11 Sep 2026)

Order agreed with the user. One PR per line unless grouped. Status: ⬜ not started · 🔨 in progress · ✅ merged.

## A. Trade lifecycle (ADR-059; docs/design/trade-lifecycle.md; mockup trade-lifecycle-v1.html)
1. 🔨 Pre-filled strategy names · start and expiry with days left on every card · lifecycle chips Open / Expiring ≤ 1d / Closed · sort by expiry · capital block on the trade preview (required, available, fees, after) (HC-TR-155..158)
2. ⬜ Overlap line in previews and workbench Review · drift check vs. the exchange · out-of-sync badge · Reconcile · Re-enter (GAPS #67)
3. ⬜ Expiry settlement job · close reasons (expired · squared off · stopped · outside the app) · Journal shows the reason (GAPS #66)
4. ⬜ Stop and target rules run by HapieCoin: strategy stop / target in money or %, leg stop, spot level; Protect step in the trade flow; card, Details and workbench entry points; 1 s quote feed in the API; audit, Telegram; paper too; time rule after
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

## Done this week
- ✅ Workbench H2 pass and four follow-ups (PRs #42–#46, ADR-058)
- ✅ Key rotation + smoke (PR #39), IV history (PR #40), server alerts + Telegram (PR #41)
