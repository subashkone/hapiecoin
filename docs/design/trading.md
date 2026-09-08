# Phase 3 · Paper and live trading · plan and design pass · 2026-09-08

Scope: the 43 Phase 3 rows in `spec/traceability.json` (HC-TR-003, 010, 012, 014, 022, 023, 029, 050..089) plus the
ADR-010 decisions on HC-TR-078 and HC-TR-089. Mock reference: `mockup-v2/src-trd/{b-core,c-dialogs,d-lists}.js`.
Spec security design "Trading safeguards": server-side margin check, sanity band against the mark (reject fills more
than 5 % away), per-user max notional and max legs, idempotency key, explicit confirmation, account kill switch,
append-only audit log. Phase exit: a paper trade and a live trade (testnet) complete end to end; kill switch and
limits verified; audit log records every trading action.

## 1. Job
Turn a Builder strategy into tracked positions: paper (simulated at live marks, fees estimated) first, live (real
orders through the user's Delta key) second. First question in 2 s on the Paper tab: **what is my P&L right now, per
strategy and in total?**

## 2. Items and order (one PR each)
1. **Strategies API + paper engine** (this branch, `feat/trading-phase3`): `strategies` and `strategy_legs`
   tables, `/v1/strategies` CRUD (draft | paper | live | archived), Select Trading Mode → Trade Preview → Paper,
   Paper tab (search, sort, refresh, P&L strip, cards, pagination, empty state), Strategy Details (tiles, legs,
   history, statistics, Draft / Archived variant), Add adjustment, Square off leg, Partial exit, Stop paper trading,
   Delete with confirm, Journal hand-off stub. Drafts move from the browser to the API (ADR-023 said so); the
   local `drafts` store becomes a one-time import on first sign-in. Fees per the mock: notional × fee %, options
   capped at cap % of premium, plus GST, per leg, from the user's chosen broker profile.
2. **Live trading (Delta India testnet first)**: order placement through the vault credential, order preview with
   the exchange margin, batch placement with idempotency keys, per-leg order status chips, failed-order banner and
   retry, exit orders for square off / partial exit / square off all, private order/position feed, kill switch,
   per-user limits, audit log on every action, Trade All → Live batch selector (ADR-010). Needs the user's Delta
   **testnet** API key in the API's own env (never in the repo); production keys stay the user's, per account, in
   the vault.
3. **Plan quota checks** (HC-TR-055) and the Live tab polish once Phase 4 plans exist; until then the quota check
   reads `subscriptions.featureLimits` and treats a missing limit as unlimited.

## 3. Data model (item 1)
```
strategies      id, user_id, name, asset, status draft|paper|live|archived, trading_mode paper|live|null,
                template_name, broker_id (nullable), started_at, closed_at, realized_pnl, notes, tags jsonb,
                order_batch_id (nullable, item 2), created_at, updated_at
strategy_legs   id, strategy_id, kind call|put|future, side buy|sell, strike (decimal string), expiry (YYYY-MM-DD
                or PERP), symbol, lots (int), entry_price, exit_price, iv, status open|squared_off, is_adjustment,
                opened_at, closed_at, order_id (item 2), position (int, order in the strategy)
strategy_pnl    strategy_id, day (date), pnl (decimal) — one row per calendar day, upserted by the P&L tick
```
Money and premiums are decimal strings in the API (schema rule 3); the web converts at the edge with `money.ts`.
Unrealised P&L is computed on the client from live marks (the same pricing legs as the pane); realised P&L is
stored when a leg closes. The server never prices; it records entry / exit premiums the client proposes **for
paper**, validated against the mark band (item 2 enforces the band from the venue for live).

## 4. API (item 1)
```
GET    /v1/strategies?status=          list (own rows), newest first, with legs
POST   /v1/strategies                  create draft {name, asset, templateName, legs[]}
PATCH  /v1/strategies/:id              rename / replace legs (draft only) / notes / tags
DELETE /v1/strategies/:id
POST   /v1/strategies/:id/start        {mode: "paper", brokerId, entries: {legId: price}} → status paper
POST   /v1/strategies/:id/legs         add adjustment legs (open strategies, max 10 open)
POST   /v1/strategies/:id/legs/:legId/close   {exitPrice, lots} → full or partial square off (splits the leg)
POST   /v1/strategies/:id/close        square off all {exits: {legId: price}}; live → archived, paper → stays paper
POST   /v1/strategies/:id/stop         paper → {archive: bool, exits} → archived (legs closed) or draft
POST   /v1/strategies/:id/archive · /restore
POST   /v1/strategies/:id/pnl          {day, pnl} upsert (client tick, throttled to once per minute)
```
Every mutation writes the audit log (`strategy.create`, `strategy.start`, `leg.close`, …) with before / after.
Zod schemas live in `packages/schema/src/strategies.ts` and are shared with the web client (rule 2).

## 5. Web (item 1)
- `lib/api/strategies.ts` query keys + hooks (TanStack); `lib/store.ts` loses `drafts` persistence (kept in memory
  for the one-time import) and gains `tradeFlow` dialog state.
- Dialogs: `TradeModeDialog` (HC-TR-050..055), `TradePreviewDialog` (056, 057), `StrategyDetailsDialog`
  (068..078), `SquareOffDialog` (079), `PartialExitDialog` (080), `StopPaperDialog` (081), adjustment through the
  existing `ChainPickerDialog` with `max = 10 − open`.
- Panels: `PaperPanel` (058..067) with the P&L strip (total, day, net Δ, margin est., open legs), sort, search,
  pagination (10 per page), cards with sparkline; `LivePanel` shows the Phase 3 item 2 placeholder until then.
- Builder: Paper Trade (primary) and Live Trade buttons replace "Save & trade"; editing an active strategy allows
  10 legs and marks new legs ADJUSTMENT; Square off this leg on active legs (HC-TR-014); Closed badge (HC-TR-010).
- Templates "My templates" reads the API; Activate on drafts (HC-TR-046) opens Trade Mode.

## 6. Numbers
Entry premium = mark at start (or the custom price in custom mode); P&L per leg = (current − entry) × lots × lot
size × side sign; fees estimated only (paper) and shown as "est."; day P&L = total − last stored day. Currency via
`money.ts`. Margin est. stays the worst defined loss until item 2 returns the exchange figure.

## 7. Safety (both items)
No path in item 1 can reach a venue: the paper engine is bookkeeping. Item 2 adds the venue calls behind: explicit
mode + preview + confirm, server-side band and limits, idempotency keys, kill switch (`users.trading_disabled`),
testnet base URL by env, and the audit log. Tests never call the live venue (rule) — the fake private client
records calls.

## 8. Traceability and tests
Item 1 rows: HC-TR-003, 010, 012, 014, 022, 050, 051, 052 (warning only), 053, 054, 056, 057, 058..067, 068..081,
HC-TR-046, HC-TR-078. Unit: schema tests for strategies.ts, API route tests (create / start / close / partial /
stop / archive / limits / audit), web tests for each dialog and panel against the mock API. Playwright: `HC-TR-057
paper trade from the Builder appears on the Paper tab with live P&L`, `HC-TR-079/080/081 square off, partial
exit, stop`, visual `analyse-paper-<theme>.png`, `analyse-details-<theme>.png`.
Item 2 rows: HC-TR-023, 029, 055, 070, 082..089.

## 9. Decisions to record
ADR-024 (this plan): strategies move server-side; paper is client-priced bookkeeping with server validation; live
trading goes through testnet first with the safeguards list as acceptance tests.

## As built · item 1 (08 Sep 2026)
Shipped as planned in §3–§5 with these differences: Details carries "Square off all" with an inline confirm instead of a separate dialog; adjustments reuse `ChainPickerDialog` in `onAdd` mode; the P&L strip shows Total, Day and the feed state (net Δ and margin wait for the margin API, GAPS #34); the Paper tab's "Trade All → Live", the card's "Go live" and the Builder's "Live trade" are visible but disabled with a note until item 2 (GAPS #37); daily P&L points have the upsert route but no writer yet (GAPS #38). The legacy browser drafts import once on the first workspace mount (`useImportLegacyDrafts`) and the store stops persisting them (`draftsImported`).

