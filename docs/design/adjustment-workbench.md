# Adjustment workbench · design (approved 09 Sep 2026)

Status: **approved by the user on 09 Sep 2026** from the clickable mockup v2, layout H2 ("Workbench"), with all six extras.
Mockups: `docs/design/mockups/adjustment-workbench-v2.html` (the approved one, open it in a browser; the earlier
v1 comparison is `adjustment-workbench-v1.html`). Published copies: v2 https://claude.ai/code/artifact/645f6391-e757-460b-92f0-72f5d2dbb350,
v1 https://claude.ai/code/artifact/a2219fa3-03fe-49e5-96e1-3e86659732cd. The repo copies are the durable ones.

## 1. Problem
A trader with a losing paper or live strategy opens Details → "+ Add adjustment" and today gets the modal chain picker;
paper legs are added immediately with no preview, live legs get a confirm dialog with a leg table only. They cannot
see the combined position (existing open legs at entry + proposed legs at mark) in Payoff / Greeks / Ladder before
committing, cannot trim, close or add to an existing leg from the same place, and get no margin, fee or mark-freshness
information.

## 2. Decisions taken with the user (chronological)
1. Reuse the Builder (user's option A) vs inline picker (B): both prototyped; specialists (front-end design skill,
   architecture agent, options-terminal UX critic) recommended a hybrid. User chose **H2 · Workbench**: one screen,
   three columns: position + ticket | chain | preview.
2. The critique's five MVP points are mandatory: netting (opposite side trims / closes; cap counted after netting),
   analytical max-loss bounds with "Unlimited loss" distinct from "Unlimited profit", venue margin held → after and
   available after, mark freshness (age counter, re-read at Review, per-leg band in ticks for live), a live confirm that
   is visually and mechanically different (red frame, order type, per-leg fill state, hold-to-place).
3. Adjustments on **other expiries** (expiry tabs on the chain; "value at" chips for today and each expiry; later legs
   keep time value when valued at an earlier date; default valuation date = latest expiry of the combined position).
4. After a live adjustment the card and Details show the **combined max loss / profit / POP**, realised P&L on closed
   lots and unrealised on open legs, plus an ADJUSTED badge.
5. Lots are edited **in both places**: a "lots now → after" stepper on each open leg (fewer = trim, 0 = close, more =
   add at mark on the same side) and a stepper on the proposed row; the chain's B/S on a held strike does the same.
   Effect labels: NEW LEG, ADDS +n to …, TRIMS … by n, CLOSES …, FLIPS +n.
6. Six extras, all approved for the build: (1) compare plans (Plan A / Plan B tables), (2) scenario at a date between
   today and expiry, (3) suggested-fix ranking of the quick fixes (smallest max loss, largest credit, delta-neutral),
   (4) keyboard-first picking (arrows, B, S, Enter, Esc), (5) alerts from the workbench ("alert me if max loss exceeds
   X" — ships with the Alerts item if that lands first, else a stub), (6) mobile layout (one column, sticky summary and
   Review).
7. Quick fixes in the first release: Roll wings up, Roll out (next expiry), Hedge with a call; Widen to condor later.
   "Square off all" stays in Details; the workbench changes a position, it does not end it.
8. A "why" note at Review is stored as the adjustment reason and shown in Details as Adjustment history (journal hook).
9. Change summary line above the strip ("This change: max loss worsens by ₹6,370 · you pay ₹4,781 · POP 12% → 0%")
   with guard rails: unlimited loss introduced, margin after exceeds available, new 0-DTE legs.

## 3. Architecture (ADR-044)
- **API**: one atomic batch `POST /v1/strategies/{id}/adjust` with `adds` (StrategyLegInput[]), `changes`
  (`{ legId, lotsAfter }` → trim / close / add-to), `expected` marks per symbol, `idempotencyKey`, `reason`. Paper:
  applied in one transaction (entry = client mark for adds, exits at client mark for trims, realised P&L booked, adds to
  an existing leg average the entry). Live: preview → place entries for adds / add-tos and exits for trims / closes
  through the executor with the mark band; a refused check rolls the batch back. Live preview accepts `legs` and
  `exits` overrides so it can price the proposed batch instead of the open legs. Response: the strategy plus an
  `adjustment` record (before/after max loss, profit, POP, cash, reason) appended to the strategy's history.
  **As built (A1, 09 Sep):** `changes` carry `{ legId, lotsAfter, price }` with `lotsAfter ≤ open lots` (adding lots to a
  held contract goes through `adds` and keeps a separate leg row with its own entry; the workbench nets rows per contract
  for display, ADR-044 as-built note). Live: all checks before the first order (exits planned as reduce-only rows, adds
  through the placement guards), exits then entries, realised P&L booked per fill, a failed exit stops the batch with the
  history row saying where. The history row is written first with a unique `(strategy, batch)` key, so the same key
  cannot apply twice and the workbench sends a fresh key per Review. The live preview overrides are `adds` / `changes` on
  `POST /live/preview` (exits listed first). The history row stores reason, added / trimmed / closed counts, realised P&L
  and the batch id; `StrategyOrder.batchId` links orders to it; before/after max loss, POP and cash are computed
  client-side from the legs and shown in Details (A2), not stored.
  **As built (A2, 09 Sep):** the workbench is a mode of `/analyse` (the `adjust` draft in the store swaps the left
  pane, the pane source follows the strategy), not a route. The Builder's own legs are never touched (ADR-026).
  Lots edited above the open lots become separate add rows (API data model); the ticket nets them per contract in
  the effect label. Card figures price each active card once per mount at entry premiums.

## 4. PR plan
- **A1 · API + schema**: `AdjustBody`, `/adjust` route, live preview overrides, executor band for adjustments, journal
  reason, mock API parity, tests at the strict floors. **Built 09 Sep** (branch `feat/adjust-api`): schema `AdjustBody` / `AdjustChange` /
  `StrategyAdjustment` + `Strategy.adjustments`, table `strategy_adjustments` (migration 0008), route, preview overrides,
  mock parity, 3 API + 1 schema test groups.
- **A2 · Workbench core (paper)**: store slice, before/after hook, pricing bounds + multi-expiry valuation, chain
  picker body, workbench layout (H2), lots-after steppers, netting labels, summary line + guard rails, paper confirm,
  post-confirm Details history, keyboard, mobile; unit + Playwright + visuals. **Built 09 Sep** (branch
  `feat/adjust-workbench`): `analyze({ valuationMs })` in `packages/pricing` (later legs keep time value; grid
  extremes with analytical tails), `lib/adjust/model.ts` (draft, netting, effects, before / after legs, cashflow,
  body, summary), store `adjust` slice (not persisted), `useStrategyAnalysis` adjusting mode (after legs on every
  tab, `before` for the ghost curve and the strip), `ChainPickerBody` extracted (keyboard opt-in, held pills),
  `AdjustWorkbench` + `PositionTicket` + `AdjustConfirmDialog` (paper amber; live red with the venue check, the
  basic version A3 extends), Details history + `AdjustedBadge`, `CardFigures`, Workspace left-pane swap, narrow
  stacking at 720 px with a sticky footer. Traceability rows HC-TR-148..154 (153/154 static until A3).
- **A3 · Live + extras**: live confirm with preview verdict, order type, hold-to-place, fill states; plans compare;
  quick fixes with ranking; scenario date slider; alert stub. **Built 09 Sep** (branch `feat/adjust-live`): limit
  entries end to end (`AdjustBody.orderType`, executor `placeEntries(..., orderType)` with the reviewed mark as the
  limit, venue clients `orderType` / `limitPrice`, `strategy_orders.order_type` migration 0009; exits stay market
  reduce-only; a resting limit is a pending order Sync books), `AdjustConfirmDialog` live extras (per-leg band, order
  type, `HoldButton` 1.2 s, results view with fill states and Done, notional-over-balance rail), `PlansBar` +
  `useDraftFigures`, `lib/adjust/fixes.ts` + `QuickFixes`, scenario slider on the ticket, `riskAlerts` store stub.

## 5. Presentation pass (ADR-058, 11 Sep 2026)
The user compared the shipped workbench against the H2 mockup: chain cramped (Δ / OI columns from the Builder picker),
open legs on two lines without Close, "This change" in the footer. Competitor moved to a popup with leg selection,
which the user does not want. Kept: the workbench as a pane mode, the model and figures. Changed to the H2 form:
`WorkbenchChain` (B/S · Mark · IV | Strike | Mark · IV · B/S, held pill, cap line, legend, Δ / OI / bid-ask on hover),
one-line legs with Close / undo, `AdjustChangeBox` + six before → after tiles at the top of the analysis pane, footer
tiles You receive / pay (fees est.) · Max loss after · Margin est. · Open legs after, a real P&L alert line (opens the
Alerts center pre-filled), Plans table under a toggle. Checklist test: the same change reads the same everywhere.
Follow-ups from the user's tests (11 Sep): rows and tiles fit the pane (PR #43); lots-after edits are orders under
Proposed (PR #44, GAPS #65); Save as plan starts the next change, the table has a Before row and the working row
says which plan it equals.

## 6. Traceability
Extends HC-TR-071 (+ Add adjustment), HC-TR-088 (Confirm Adjustment Order), HC-TR-118/119 (Details restyle, payoff
mini chart), HC-TR-125/126 (per-leg value and fee). New rows HC-TR-148..154 (HC-TR-146/147 are Builder rows; workbench, before → after strip and ghost
curve, lots-after editing with netting, paper confirm, live confirm with band and hold, plans compare, quick fixes)
added through `mockup-v2/features` + `spec/buildspec.js` when A2 lands.
