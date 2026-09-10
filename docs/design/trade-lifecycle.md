# Trade lifecycle: naming, overlapping contracts, strategy stop loss, expiry (proposal, 11 Sep 2026)

Status: **for the user's review**. Nothing here is built. Facts about the current build are cited; everything else
is a proposal with options and a recommendation.

## 0. What the user reported
1. Saving a paper or live trade asks for a name with an empty box. Wanted: a pre-filled name (example
   `BTCIBF09SEP2026`, with the time), editable, kept as is when not edited.
2. Two strategies sometimes use the same strike; a buy in one and a sell in another. Does closing one close the other?
3. 800 lots of a contract in one strategy plus 200 of the same contract in another became 1,000 at the exchange. A
   stop loss on the exchange hit and sold all 1,000, collapsing both strategies. Wanted: a warning before saving, the
   industry practice, and whether Delta's sub-accounts can isolate strategies.
4. Paper and live cards should show the strategy's expiry next to its start date; expired strategies should live in
   their own tab or filter; the pages should carry better filters and useful figures.

## 1. Facts about the current build (verified 11 Sep)
- The name is required and starts empty: `SaveDraftDialog.tsx` ("Enter Strategy Name"), called from `TradeFlow.tsx`
  with `initialName={meta.name}` (empty for a fresh Builder). Schema: `name` 1..80 chars.
- A strategy is `draft | paper | live | archived` with legs (`open | squared_off`), `startedAt`, `closedAt`,
  `createdAt`, `tags`, `notes` (`packages/schema/src/strategies.ts`).
- Live entries are placed leg by leg with `reduceOnly: false` (`apps/api/src/routes/live-exec.ts:202`). Nothing looks
  at the exchange's existing position in that contract, or at other strategies holding it.
- The exchange keeps **one net position per contract per account**. The app keeps lots **per strategy**. The two
  agree only while every change goes through the app.
- `live-reconcile.ts` syncs **pending orders** only; it does not compare venue positions with strategy legs.
- The venue client has no stop, trigger or bracket order support (grep of `packages/venues/src/delta`): the app never
  places exchange-level stops. The user's stop was set on the exchange.
- The Live tab's Net positions panel reads `/v1/strategies/live/positions` (the venue's view, HC-TR-082).
- Nothing settles expired legs: a paper or live leg past its expiry stays `open` with no mark. There is no
  "expired" state, no settlement job, no expiry on the card, no expiry filter. Paper/Live tabs have search, sort
  (P&L, date, name), pagination and the P&L strip (`PaperPanel.tsx`).
- Alerts (ADR-052/057) notify only; the server evaluates every 5 minutes, the browser every tick.
- Sub-accounts: no reference anywhere in the repo or research notes. **Not verified** whether Delta Exchange India
  offers sub-accounts with separate API keys (Delta's global platform does). Must be checked before promising.

## 2. Proposal

### 2.1 Pre-filled strategy name
Format: `ASSET-CODE-DDMMMYY-HHMM`, e.g. `BTC-IBF-11SEP26-1432` (trade date and time, local to the trader's clock).
- `CODE` from the template (Iron Butterfly IBF, Iron Condor IC, Short Strangle SSTG, Long Straddle LSTD, Bull Call
  Spread BCS, …; full table in the implementation), else from the legs (`2C1P`), else `CUSTOM`.
- Pre-filled in the dialog, selected so typing replaces it; unchanged names are kept. Same default for Save as Draft.
- If the name already exists for the user, `-2`, `-3` is appended.
- Why not the expiry in the name: it belongs on the card and in the filters (2.4); a multi-expiry strategy would need
  two dates. The user's example had the trade date, which this keeps. Alternative the user may prefer: no dashes
  (`BTCIBF11SEP261432`), harder to read; dashes recommended.

### 2.2 Overlapping contracts across strategies
Answer to "does closing one close the other": **no**. Each strategy's exit sends its own orders for its own lots; the
exchange nets them. Strategy A long 200, strategy B short 200 → the exchange shows 0 while both cards show open legs;
closing A sends a sell 200 → the exchange shows short 200, which is exactly B's leg. This is consistent **as long as
every change goes through the app**. It breaks when the exchange changes the position on its own: a stop order, a
manual close on the exchange app, a liquidation, or expiry. Then the strategies in HapieCoin are out of date and
nobody is told. That is what happened in 0.3.

Build:
1. **Pre-trade overlap line** in the paper and live preview and in the workbench Review: "You already hold 800 lots
   of BTC 78,000 P 11 Sep in *Short Strangle A* (sold). After this order the exchange holds 1,000 sold. An exchange
   stop or close on that contract acts on all 1,000." Shown per contract; never blocks (the trader may intend it).
2. **Drift check** on the Live tab: venue net per contract vs. Σ open legs per contract across live strategies. A
   card whose contract differs gets an "Out of sync at the exchange · 1,000 expected, 0 held" badge, and the tab gets
   a banner. Checked on every positions refresh and by the server on each reconcile pass.
3. **Reconcile** on such a card: mark the affected legs squared off "outside the app" at the exchange's last fill
   (from the venue's fills endpoint when available, else the mark at detection time), with the reason kept on the
   strategy (Details → history, Journal). No orders are sent.

### 2.3 Strategy stop loss (the collapse)
Why it happened: an exchange stop is a **position-level** order. The exchange has no idea of strategies, so it closed
the whole 1,000-lot position. Every exchange works this way (Delta, Deribit, Binance).

Industry practice: strategy tools (the NSE ones such as Sensibull, Opstra, Quantsapp, and Dhan's strategy SL)
run the **strategy-level stop on their own servers**: they watch the strategy's P&L and send that strategy's exit
orders when it crosses the level. Exchange-level stops are used for single legs only. Nothing at the exchange can
express "close these 200 of the 1,000".

Options:
- **A. Strategy stop loss in HapieCoin (recommended, the industry answer).** Per strategy: "Exit all legs when P&L ≤
  −X" (and optionally "when P&L ≥ +Y", the take-profit). Set from the card, the Details dialog and the workbench's
  alert line. Executed by the API through the existing exit path (exact lots, per strategy), audited, with a
  confirmation when armed and the admin kill switch respected. The browser engine can also fire it while a tab is
  open. Cadence today is 5 minutes on the server (the IV snapshot). For a stop that is too slow: the API would
  subscribe to the gateway's mark feed for the contracts of armed strategies (1 s). That is the one real piece of new
  infrastructure in this proposal. Until then: 5-minute server checks plus the browser engine, stated plainly on the
  arming dialog.
- **B. Overlap warning only (2.2.1).** Cheap, ships first, prevents the surprise. Not a fix on its own.
- **C. Sub-accounts.** If Delta Exchange India offers sub-accounts with their own API keys: HapieCoin gets an
  "accounts" concept (several credentials per broker, labelled; each strategy tied to one account; positions,
  balances and drift shown per account; the trade-mode dialog picks the account). The exchange then nets per
  sub-account, so an exchange-level stop on one cannot touch another. The user would map strategies to sub-accounts
  themselves (one per strategy that carries an exchange stop). Verification first: the user's Delta India account
  settings, or their API docs, for "sub-accounts". If absent there, C is off the table.
- **D. Never share a contract**: refuse an order on a contract another live strategy holds. Rejected: it blocks
  legitimate trades (a hedge that overlaps, an adjustment) and the user's own case was two intended strategies.

Recommendation: B now, A as the fix, C after verification (it complements A rather than replacing it: A stops the
strategy the app knows about; C protects the user who still sets stops on the exchange).

### 2.3.1 Stop and target rules: what fires, what is sent, real scenarios (brainstorm, 11 Sep)
**Principle.** A rule is set on the whole strategy and, when it fires, HapieCoin sends exit orders for **every open leg of
that strategy** (its own lots only). The system does not pick legs. Reason: closing part of a strangle or condor turns
it into a different position with different risk (a naked side, a lost hedge); the trader who wants that asks for a
*leg rule* (below), never gets it by accident.

**Rule types (v1 proposal)**
| Rule | Fires when | Sends | Typical use |
|---|---|---|---|
| Strategy stop | strategy P&L ≤ −X | all legs | the collapse case; every short-premium trade |
| Strategy target | strategy P&L ≥ +Y | all legs | take the money at 50% of max profit |
| Leg stop | one named short leg's price ≥ N × its entry (or ≥ a price) | that leg only, optionally the whole strategy | strangle traders who stop the tested side at 2–3× premium |
| Spot level | underlying ≥ / ≤ a price | all legs | "out if BTC breaks 82,000" (what Sensibull offers) |
| Time | at a clock time or when DTE ≤ d | all legs | "flat by 17:00 IST on expiry day" |

X and Y can be typed as **₹ / $ or as a percentage**; the other unit is shown live next to it. Percentage bases: for a
credit strategy, % of the credit received (target 50% of credit, stop 200% of credit are the common rules) and, for
defined risk, % of max loss; for a debit strategy, % of the debit paid. The card shows the rule in both units.

**Execution rules.** Short legs first (buying them back frees margin and never leaves a naked side), then longs; market
orders at the mark of that second (limit-with-band as an option later); one leg failing does not cancel the rest:
retries with backoff, then the card reads "stopped · 1 leg still open" with an alert; a fired rule never re-arms;
the admin kill switch and the venue check apply; every fire is audited (rule, marks, orders, fills, slippage) and
sent to Telegram / in-app. Checked every tick by the API from the gateway's quote stream, and by the browser while a
tab is open; the two never double-send (the strategy row is the guard, as for alerts, ADR-057).

**Scenarios walked through (short strangle, 800 lots, credit ₹8,400, stop −₹5,000, target +₹4,200)**
1. Spot gaps up, the call is tested: P&L reaches −₹5,000 → both legs exit. The put is nearly worthless; closing it
   costs little and removes the reversal risk. Correct.
2. Slow decay: P&L reaches +₹4,200 → both legs exit at 50% of the credit. Correct.
3. IV spike, spot flat: P&L drops on volatility alone → the stop fires although the price never moved. A trader who
   wants a price stop, not a P&L stop, uses the spot-level rule instead. Both are offered; the arming panel says which.
4. Expiry day, 30 minutes to settlement: the time rule exits at 17:00 IST regardless of P&L. Optional.
5. HapieCoin's API is down for 10 minutes: nothing fires; the Live tab shows "server unreachable · stops paused"
   and the browser keeps checking while open. Stated on the panel; no way around it without an exchange order.
6. The call's exit fills, the put's exit is refused (rate limit or venue error): retried; after N tries the card
   says "stopped · put still open", Telegram message sent; the put is now a naked short with the same rule still
   trying. This is the honest failure mode and it is visible.
7. The strike is shared with strategy B (the user's case): only A's 800 lots are sent; B's 200 stay. The exchange
   position goes from 1,000 to 200. B is untouched, which is the whole point.
8. The exchange liquidates or the user closes on the exchange before the rule fires: the drift check (2.2.2) flags
   "out of sync", the rule is disarmed, Reconcile books it.
9. Leg rule on a strangle: "exit the call when its price ≥ 2.5 × entry": only the call goes; the put keeps running
   with its own leg rule; the strategy stop still covers the whole thing. Trader's choice, never automatic.

**Open questions for the user.** Which rule types in v1 (recommendation: strategy stop + target in ₹ or %, leg
stop, spot level; time rule later); whether a fired stop should offer "re-enter" from the card; whether stops are
allowed on paper strategies too (recommendation: yes, same engine, no orders, good for practice).

### 2.4 Expiry and lifecycle on the Paper and Live tabs
- **Card**: `started 09 Sep · expires 11 Sep (1.3d)`; multi-expiry: `11 Sep → 25 Sep`. Days to expiry coloured
  (warning under 1 day). Sort by expiry added.
- **Lifecycle chips** on both tabs: `Open` (default) · `Expiring ≤ 1d` · `Closed`. Closed cards carry the reason:
  `expired`, `squared off`, `stopped` (2.3 A), `closed outside the app` (2.2.3). The Journal stays the ledger; the
  Closed chip is the recent view. Alternative: a separate "Expired" tab. Not recommended: two places for closed
  positions, and a live-vs-paper split would need four tabs.
- **Expiry settlement (needed for "expired" to mean anything)**: an API job at each settlement instant (Delta settles
  at 12:00 UTC / 17:30 IST; `settlementHourUtc` already exists) marks paper legs past expiry `squared_off` at the
  settlement value (intrinsic from the venue's settlement price when the market API exposes it, else the spot at
  the settlement minute, stated on the leg), books the realised P&L, and archives the strategy when nothing is open,
  with `closeReason: "expired"`. Live legs are settled by the exchange itself; the job reads the venue position going
  to zero and does the same bookkeeping (this is 2.2.2's drift check with a known reason).
- **Useful figures per card** (each answers a trader's question, none decorative): P&L as % of max profit ("62% of
  max profit captured", the usual credit-strategy exit rule), theta per day, days to expiry, the armed stop/target
  (2.3 A), alerts count, "out of sync" (2.2.2). Filters: asset, expiry, template, tag; the search stays.

### 2.5 What this needs from the user
1. Name format: `BTC-IBF-11SEP26-1432` as proposed, or a variant.
2. Strategy stop loss (2.3 A): yes or no. It means the server places real exit orders on the user's behalf without a
   click at that moment. If yes: accept the 5-minute server cadence for the first release, or fund the 1-second feed
   in the API in the same PR.
3. Sub-accounts: check the Delta Exchange India account for a sub-accounts feature and API keys per sub-account.
4. Closed strategies as a chip on the same tab (recommended) or a separate tab.

## 3. Delivery order (one PR each, tests at floors, reviewer pass on each)
1. Names + expiry on cards + lifecycle chips + expiry sort (small; no server change).
2. Overlap line in previews and Review; drift badge and banner; Reconcile.
3. Expiry settlement job and `closeReason`; Closed chip reasons; Journal shows the reason.
4. Strategy stop loss / take profit (A), with the arming dialog and the audit trail.
5. Sub-accounts (C), only if verified.

Traceability: new rows to be added to `mockup-v2/features/21-trading.json` (naming, overlap, drift, reconcile,
stop, expiry settlement, chips); GAPS rows for the missing settlement and the missing drift check are recorded now.
ADR to follow on approval.
