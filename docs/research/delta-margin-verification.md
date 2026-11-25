# Delta India margin for sold options: what is verified and what is not

Date: 25 November 2026. Scope: GAPS #109 (and #120 for futures). Research only, no code changed.
Everything below was read or computed in this session. Public, unauthenticated endpoints and public documentation only; no account, no key, no order. Items that could not be confirmed are marked UNVERIFIED.

## Short answer

- **Unit: percent, confirmed from public data and documentation, but the code multiplies the factor by the wrong quantity.** `initial_margin` is a percent (0.5 = 0.5 %, which is exactly `default_leverage` 200). `initial_margin_scaling_factor` is percent points **per USD of position notional above `max_leverage_notional`**, not per contract from the first contract. The fraction reading gives 550 % to 1,225 % margin at the listed limits and is ruled out.
- **Formula: the shape "percent of spot + the option's mark" is what Delta documents for short MOVE contracts in isolated margin; for vanilla options Delta publishes no formula.** No "max(a % of underlying − OTM amount, b %) + premium" rule appears anywhere in Delta's public documentation. Whether a vanilla short really adds the premium is UNVERIFIED.
- **Size of the error today: negligible at the owner's sizes, large for big ones.** Below the threshold (BTC options: 200,000 USD notional in one contract, about 3,378 lots at spot 59,209) the code overstates by at most 1.4 % (0.000002 × 3,378 = 0.0068 percent points on 0.5). Above it the code understates: 26 % too low at 5,000 lots, 59 % too low at 10,000 lots.
- **The larger unknown is leverage, not the unit.** In isolated margin the trader's order leverage sets the margin (Delta's error text: "Margin required to place order with selected leverage and quantity"). The code assumes the maximum leverage. If the account's leverage on an option contract is lower, Delta holds a multiple of the estimate (at 10x: 20 times the 0.5 % figure). How leverage applies to a sold option is UNVERIFIED.
- **Spread relief: none in isolated or cross margin (documented); real only in portfolio margin, which is an account-level mode the trader selects.** The code's "no relief" assumption matches isolated margin. Which mode a new Delta India account starts in is UNVERIFIED (the API documentation's examples show `isolated`).
- **Testnet does not carry production's parameters.** Same base percents, but BTC option scaling factor 0.00002 on testnet against 0.000002 in production, threshold 100,000 against 200,000 USD, and the testnet BTC perpetual has factor 0 and default leverage 10 against 200. A testnet check settles the formula's shape, not production's numbers.

## The code's formula today

Sold option, `shortOptionMarginUsd`, `packages/venues/src/delta/trading.ts:185-193`:

```
pct         = (initial_margin + initial_margin_scaling_factor × contracts) / 100      (line 189)
perContract = pct × spot × contractValue + mark × contractValue                       (line 190)
margin      = perContract × contracts, to the cent                                    (line 192)
```

Futures leg, `futuresMarginUsd`, `packages/venues/src/delta/trading.ts:205-212`: `(initial_margin + factor × contracts) / 100 × price × contractValue × contracts` (lines 208-209).

Where the inputs come from and how the figure is used:

- Product record parsed at `packages/venues/src/delta/trading.ts:286-295` and `:418-420` (`initial_margin`, `initial_margin_scaling_factor` only; `max_leverage_notional` is not read). The public list parser keeps the same two fields: `packages/venues/src/delta/raw.ts:38`, `packages/venues/src/delta/normalize.ts:169`.
- Live preview, per leg: `apps/api/src/routes/live-exec.ts:179-183`; total "margin required" = sum of leg estimates + net premium paid: `apps/api/src/routes/live-exec.ts:232-233`.
- Stored estimate at entry (paper, live, Autopilot): `marginEstimateOf`, `apps/api/src/margin.ts:56-81`; same two functions (lines 72-74), plus `Math.max(debit, 0)` (line 80). A bought option is skipped (line 67): no relief.
- "Margin in use" in the Trade Preview is the sum of the `margin` field of the exchange's open positions: `apps/api/src/routes/live-exec.ts:258-259`, shown at `apps/web/src/components/trading/TradePreviewDialog.tsx:162`.
- The order leverage and the account's margin mode are not read anywhere in `packages/venues/src/delta` (Grep for `leverage|margin_mode` finds only the comment at `trading.ts:200-201`).
- Decisions: ADR-091 (`docs/DECISIONS.md:548`), ADR-095 (`:582`), ADR-128 (`:784`). All three state the unit as unverified; ADR-128 line 787 records hand-run figures of 80.30, 176.51 and 1,557.23 USD for 100-lot strangles.
- The builder's client-side `marginEstimate` (`apps/web/src/lib/strategy/analysis.ts:91-95`) is a different thing: the worst expiry loss, null when unbounded.

## What Delta documents (all read 25 November 2026)

1. **Margin scaling (India guide, Isolated Margin).** <https://guides.delta.exchange/delta-exchange-india-user-guide/trading-guide/margin-explainer/margin-explainer>
   "Margin requirement remains flat till a certain position size (Position Threshold). Once position size crosses this threshold, margin requirement increases linearly with position size." Below or at the threshold `Initial Margin% = Initial Margin%_MIN`; above it `Initial Margin% = Initial Margin%_MIN + Slope_IM × (Position Size − Position Threshold)`. The page gives no numbers and no unit for the size. Same text on the older page <https://delta-exchange.github.io/user-guide/docs/trading-guide/margin-explainer>.
2. **Order margin (same page).** Sell market order: `IM = InitialMargin% × #Contracts × Multiplier × Max(MarkPrice, BestBid)`; sell limit: `... × Max(Limit Offer Price, BestBid)`. Positions and orders on opposite sides **in the same contract** are netted. The formula is written for futures; the page does not say what "price" is for an option.
3. **API field descriptions.** <https://docs.delta.exchange/> (Product schema): `initial_margin` "Margin required to open a position"; `max_leverage_notional` "Maximum notional position size at the highest leverage"; `initial_margin_scaling_factor` "Scaling factor for initial margin"; `default_leverage` "Default leverage assigned to the product"; `position_size_limit` "Maximum size for a single contract order". So `max_leverage_notional` is the Position Threshold of point 1, in USD notional.
4. **A third-party reading of the same fields.** CCXT's example <https://docs.ccxt.com/docs/examples/js/delta-maintenance-margin-rate-max-leverage> (its comment cites delta.exchange/contracts): if position value ≤ `max_leverage_notional`, ratio = `initial_margin / 100`; else `initial_margin + initial_margin_scaling_factor × (positionSize − max_leverage_notional)`, then `/ 100`, with `positionSize` "the value of the position in quote currency". Not Delta's own text, but it matches points 1 and 3 and the magnitudes below.
5. **A worked example in Delta's own guide.** <https://guides.delta.exchange/delta-exchange-india-user-guide/trading-guide/margin-explainer/margin-explainer/liquidation-of-isolated-margin-positions> ("for illustrative purposes"): "When position size > 5 BTC, MM% = 0.5% + 0.075% × (position size − 5)", and a 200,000-contract position is given "MM% = 1.63% & IM% = 3.25%". The slope adds percent points per unit of size above a threshold; illustrative parameters, not the live ones.
6. **Short MOVE contracts (the only documented short-option formula).** <https://delta-exchange.github.io/user-guide/docs/tutorials/move-contracts/>: "Initial Margin = Initial Margin% × Underlying Index Price + Mark Price", "Maintenance Margin = Maintenance Margin% × Underlying Index Price", isolated margin, "margin requirement scales up with position size". This is the shape the code uses. For vanilla calls and puts neither options guide gives a margin formula: <https://guides.delta.exchange/delta-exchange-india-user-guide/derivatives-guide/options-guide> and <https://delta-exchange.github.io/user-guide/docs/tutorials/options-contracts/>.
7. **Margin modes (India guide).** <https://guides.delta.exchange/delta-exchange-india-user-guide/trading-guide/margin-explainer>: three modes, Isolated, Portfolio, Cross. "Margin mode is an account level property"; it is changed from the selector above the order panel or the sub-account page, and "can only be changed when the account does not have any open positions or orders". Portfolio margin: "Only USD settled futures, perpetuals and options on BTC and ETH". The API documentation lists only two values for `margin_mode`, `isolated` and `portfolio` (`PUT /v2/users/margin_mode`), and every example shows `isolated`.
8. **Spread relief.** <https://guides.delta.exchange/delta-exchange-india-user-guide/trading-guide/margin-explainer/portfolio-margin>: "In cross or isolated margin, the margin requirement for a group of positions is simply the sum of the margin requirement for each position individually. So, recognition of offsetting risks is just not possible. Portfolio margin overcomes this limitation". Portfolio margin = max(Risk Margin, Margin Floor) − UCF, with Risk Margin from 29 price and volatility scenarios (price shock 1 % of spot up to 100,000 USD of BTC notional, rising to 10 % above 2.35 M) and a short-option floor of max(5 % × premium, OM% × notional), OM% = 0.5 % up to 200,000 USD (BTC) or 100,000 USD (ETH) then + 0.0000005 % (BTC) or 0.000001 % (ETH) per USD, capped at 2 % and 5 %. Maintenance = 75 % × (IM + UCF) − UCF. The thresholds 200,000 and 100,000 USD equal the option products' `max_leverage_notional` in the list below.
9. **Cross margin (India guide).** <https://guides.delta.exchange/delta-exchange-india-user-guide/trading-guide/margin-explainer/cross-margin>: formulas "the same as for Isolated margin"; long option value adds to collateral ("max(UCF − Spot Maintenance Margin, 0)"), which is collateral, not a lower requirement.
10. **Other.** Order errors in the API documentation: `insufficient_margin` "Margin required to place order with selected leverage and quantity is insufficient"; `naked_short_restricted` "Order would create a naked short position beyond the allowed limit" (the limit is not documented). Help-centre article "How much margin is reserved while placing an order" <https://www.delta.exchange/support/solutions/articles/80001177915-how-much-margin-is-reserved-while-placing-an-order-on-delta-exchange-> (read through a summarising fetch, not verbatim): order margin = order size × contract value × initial margin %, rising with size, plus estimated entry and exit fees. Delta's calculator covers isolated-margin futures only, not options: <https://www.delta.exchange/support/solutions/articles/80001177923-delta-exchange-calculator-features-to-improve-trading> (same caveat). Spread contracts on the global guide have their own rule, `Initial Margin% = min(0.5%, (Strike2 − Strike1)/Spot)`: <https://guides.delta.exchange/delta-exchange-user-guide/derivatives-guide/options-guide/option-spreads>; the India options guide lists no spread contracts.

Not found: any public pre-trade margin endpoint; any worked example of a sold vanilla option's margin; any statement that testnet parameters equal production's. The `deltaexchangeindia.freshdesk.com` article URLs returned HTTP 404.

## The public product list (fetched 25 November 2026, about 09:05 UTC)

`GET https://api.india.delta.exchange/v2/products?contract_types=…&states=live&page_size=1000`: call options 601, put options 588 (1,189 option products), perpetuals 262. Every option of one underlying and expiry carries the same margin fields.

| Product | `initial_margin` | `maintenance_margin` | `initial_margin_scaling_factor` | `maintenance_margin_scaling_factor` | `max_leverage_notional` | `default_leverage` | `position_size_limit` | `position_notional_limit` | `contract_value` |
|---|---|---|---|---|---|---|---|---|---|
| BTC options, expiry 25 and 26 Nov | 0.5 | 0.25 | 0.000002 | 0.000001 | 200000 | 200 | 50000 | null | 0.001 |
| BTC options, 27 Nov, 4 Dec, 11 Dec, part of 25 Dec | 1 | 0.5 | 0.000002 | 0.000001 | 200000 | 100 | 50000 | null | 0.001 |
| BTC options, rest of 25 Dec, 29 Jan 2027 | 5 | 0.5 | 0.000002 | 0.000001 | 200000 | 20 | 50000 | null | 0.001 |
| ETH options, 25 Nov to 11 Dec, part of 25 Dec | 1 | 0.5 | 0.000004 | 0.000002 | 100000 | 100 | 120000 | null | 0.01 |
| ETH options, rest of 25 Dec, 29 Jan 2027 | 5 | 0.5 | 0.000004 | 0.000002 | 100000 | 20 | 120000 | null | 0.01 |
| XAUT options, 25 to 27 Nov | 1 | 0.5 | 0.000005 | 0.0000025 | 100000 | 100 | 500000 | null | 0.001 |
| BTCUSD perpetual | 0.5 | 0.25 | 0.0000025 | 0.00000125 | 100000 | 200 | 125000 | 5000000 | 0.001 |
| ETHUSD perpetual | 0.5 | 0.25 | 0.000004 | 0.000002 | 100000 | 200 | 162683 | 2500000 | 0.01 |

Other margin-related fields on an option (C-BTC-57800-261126): `liquidation_penalty_factor` 0.5, `insurance_fund_margin_contribution` 5, `ui_config.leverage_slider_values` [1, 2, 5, 10, 25, 50, 100, 200], `product_specs.isolated_liq_penalty_factor` 0.0005, `product_specs.isolated_liq_premium_penalty_factor` 0.2, `product_specs.max_oi_usd` 40000000. Spot from the public tickers at about 09:11 UTC: BTC 59,209.3, ETH 1,646.8, XAUT 3,528.304; BTCUSD ticker spot 59,201.9.

### Reading 1: `initial_margin` is a percent

`initial_margin × default_leverage = 100` in every row: 0.5 × 200, 1 × 100, 5 × 20. A percent of 0.5 is 1/200, the listed leverage. As a fraction, 0.5 would be 2x leverage on a product whose slider goes to 200. Confirmed.

### Reading 2: what the scaling factor multiplies

Margin percent at the listed limit, under four readings (size in contracts or in USD above the threshold; factor as percent points or as a fraction):

| Product at its limit | Notional at the limit | Per contract, percent (the code) | Per contract, fraction | Per USD above threshold, percent (documented) | Per USD above threshold, fraction |
|---|---|---|---|---|---|
| BTC option, 50,000 contracts | 50,000 × 0.001 × 59,209.3 = 2,960,465 | 0.5 + 0.000002 × 50,000 = 0.60 % | 0.5 % + 10 % = 10.5 % | 0.5 + 0.000002 × 2,760,465 = 6.02 % | 552.6 % |
| ETH option, 120,000 contracts | 120,000 × 0.01 × 1,646.8 = 1,976,160 | 1 + 0.48 = 1.48 % | 49.0 % | 1 + 0.000004 × 1,876,160 = 8.51 % | 751.5 % |
| XAUT option, 500,000 contracts | 500,000 × 0.001 × 3,528.304 = 1,764,152 | 1 + 2.5 = 3.50 % | 251 % | 1 + 0.000005 × 1,664,152 = 9.32 % | 833.1 % |
| BTCUSD perpetual, notional limit 5,000,000 | 5,000,000 | 0.5 + 0.3125 = 0.81 % (at 125,000 contracts) | 31.75 % | 0.5 + 0.0000025 × 4,900,000 = 12.75 % | 1,225.5 % |
| ETHUSD perpetual, notional limit 2,500,000 | 2,500,000 | 0.5 + 0.65 = 1.15 % (at 162,683 contracts) | 65.6 % | 0.5 + 0.000004 × 2,400,000 = 10.10 % | 960.5 % |

What the magnitudes say:

- With size in USD above the threshold (what the documentation describes), only the **percent** reading is sane: 6 % to 13 % at the limits, a leverage of 8x to 17x on the largest allowed position. The fraction reading is above 500 % everywhere. Ruled out.
- With size in contracts (what the code does), the fraction reading gives 251 % for XAUT options: ruled out on its own. The percent reading gives 0.6 % for the largest BTC option position, 167x leverage on 2.96 million USD. Not impossible, but it would make the scaling pointless, it ignores `max_leverage_notional`, and it contradicts "flat till a certain position size".
- The portfolio-margin floor uses the same construction with the same thresholds (200,000 USD for BTC, 100,000 USD for ETH) and a slope quoted "in % per USD".

Conclusion: `IM% = initial_margin + initial_margin_scaling_factor × max(0, position notional in USD − max_leverage_notional)`, all in percent. Confirmed from documentation and magnitudes; not yet confirmed against a position's margin (the owner's check below). How "notional" is measured for an option (contracts × contract value × spot is assumed here) is UNVERIFIED.

### What that does to the estimate (production BTC option, 0.5 %, spot 59,209.3, premium term left out)

| Lots (contracts) | Notional USD | Code today | Documented reading | Code ÷ documented |
|---|---|---|---|---|
| 100 | 5,920.93 | 29.62 | 29.60 | 1.000 |
| 1,000 | 59,209.30 | 297.23 | 296.05 | 1.004 |
| 3,000 | 177,627.90 | 898.80 | 888.14 | 1.012 |
| 5,000 | 296,046.50 | 1,509.84 | 2,048.92 | 0.737 |
| 10,000 | 592,093.00 | 3,078.88 | 7,603.58 | 0.405 |

The threshold is 200,000 ÷ (0.001 × 59,209.3) = 3,378 lots in one contract. The 100-lot strangles of ADR-128 sit far below it, so the scaling term is not what could make their stored figures wrong.

## Short option formula: documented against the code

| Question | Delta's public documentation | The code |
|---|---|---|
| Base rate | Percent of the underlying index, per contract specification | Same (`initial_margin / 100 × spot`) |
| Premium added for a short | Yes for MOVE ("+ Mark Price"). Vanilla options: not documented | Adds the mark (`trading.ts:190`). UNVERIFIED for vanilla |
| OTM reduction (max(a % − OTM, b %)) | Not documented anywhere for Delta | None. Consistent |
| Scaling | Percent per USD of notional above `max_leverage_notional` | Percent per contract from the first contract. Wrong quantity |
| Leverage | Isolated: the trader's order leverage per contract; cross: always the maximum | Assumes the maximum; leverage never read (GAPS #120 says so for futures; it applies to options too) |
| Sell order pricing | Max(mark, best bid) or max(limit, best bid) | Mark only. A small understatement when the bid is above the mark |
| Fees | Entry and exit fees are reserved on top (help article, read as a summary) | Not included |
| Spread relief | None in isolated or cross; portfolio mode only | None. Right for isolated; wrong (too high) for an account in portfolio mode |

## Spread relief and portfolio margin

- Documented: a sold option covered by a bought one of the same expiry gets **no** margin relief in isolated or cross margin. Netting exists only inside one contract.
- Portfolio margin does recognise the hedge (risk scenarios on the whole underlying). It covers BTC and ETH futures, perpetuals and options; XAUT is not listed.
- It is opt-in in the sense that it is one of three account-level modes the trader picks, switchable only with no open positions or orders. The India page states no minimum equity; the global page (<https://guides.delta.exchange/delta-exchange-user-guide/trading-guide/margin-explainer/portfolio-margin>) requires 500 USDT. Which mode a new India account starts in: UNVERIFIED.
- In portfolio mode the code's whole estimate is the wrong model: the requirement is max(risk margin, floor) − UCF for the underlying's entire book, not a sum of legs.

## Testnet against production

The API documentation names the hosts (production `https://api.india.delta.exchange`, testnet "Demo Account" `https://cdn-ind.testnet.deltaex.org`) and says nothing about the parameters being the same. The public testnet product list, fetched in the same minute, shows they are not:

| Field | Production | Testnet |
|---|---|---|
| BTC options `initial_margin` by expiry | 0.5 / 1 / 5 | 0.5 / 1 / 5 (same) |
| BTC options `initial_margin_scaling_factor` | 0.000002 | 0.00002 |
| BTC options `max_leverage_notional` | 200000 | 100000 |
| BTC options `position_size_limit` | 50000 | 10000000 |
| ETH options scaling factor / size limit | 0.000004 / 120000 | 0.00002 / 10000000 |
| XAUT options | 1, 0.000005, 100000, 500000 | identical |
| BTCUSD perpetual scaling factor / threshold / default leverage / size limit | 0.0000025 / 100000 / 200 / 125000 | 0 / 10000 / 10 / 5000 |
| ETHUSD perpetual `initial_margin` / default leverage | 0.5 / 200 | 1 / 5 |

Also seen on testnet at 09:12 UTC: the 26 Nov BTC options near the money had no bid or ask and zero open interest, calls marked at 0.5 and puts near intrinsic value. A market sell there may not fill, and the mark is not a market price.

Not traced in this session: which host the stored-estimate path (`apps/api/src/venues.ts:75`) reads when the trading host is the testnet. If it reads production's list while orders go to testnet, the stored figure uses the wrong parameters above the threshold.

## What remains unverified and the one check that settles it

Unverified: (a) the scaling quantity against a real position, (b) whether a sold vanilla option's margin includes its premium, (c) how the order leverage enters, (d) the account's margin mode, (e) relief once the long exists.

The check, for the owner, on the testnet account. All figures use testnet parameters (0.5 %, factor 0.00002, threshold 100,000 USD, contract 0.001 BTC) and the testnet spot S = 59,209.7 read at 09:12 UTC; recompute with the spot at the time. P is the fill price of the sold option in USD per BTC.

1. On Delta's testnet site, note the **margin mode** shown above the order panel and the **leverage** on the slider for the contract chosen in step 2. Write both down. If the mode is not Isolated, the predictions below do not apply; record the figure anyway.
2. With no other open position, sell **100 lots** (0.1 BTC) of one BTC put or call that expires within two days (`initial_margin` 0.5) and has a bid, for example `P-BTC-<strike near spot>-261126`. Use the app's Trade Preview and note "Margin needed · est.".
3. After the fill, read the position's margin: in the app, "Margin in use" in the Trade Preview of any next trade (it is the sum of the open positions' `margin`), and on Delta's own Positions table as a cross-check. Predicted:
   - 0.5 % of notional + premium: 0.005 × 59,209.7 × 0.1 + 0.1 × P = **29.60 + 0.1 × P** (the code says 29.72 + 0.1 × P).
   - No premium in the margin: **29.60**.
   - Factor a fraction per contract: 41.45 + 0.1 × P.
   - Leverage L other than 200: 5,920.97 ÷ L, for example **592.10 at 10x**, with or without the premium.
4. Add to the same contract until the position is **2,000 lots** (2 BTC, notional 118,419 USD, above the 100,000 threshold). Read the margin again. Predicted, before the premium term (add 2 × P if step 3 showed the premium is included):
   - The code's reading (per contract): (0.5 + 0.00002 × 2,000) % = 0.54 % → **639.46**.
   - The documented reading (per USD above the threshold): 0.5 + 0.00002 × 18,419.4 = 0.868 % → **1,028.34**.
   - Fraction per contract: 5,328.87. Fraction per USD: 44,216.38.
   - If the testnet wallet cannot carry that, 1,000 lots still separates the two main readings by a smaller gap: 307.89 (code) against 296.05 (documented, below the threshold).
5. With the short still open, **buy 2,000 lots** of a further out-of-the-money option of the same type and expiry. Read the margin a third time. Unchanged margin on the short = no spread relief (what the documentation says for isolated). A drop = relief exists and its size is the difference.
6. Close everything. Record the six numbers (mode, leverage, three margins, the app's estimates) in GAPS #109.

What testnet cannot tell: production's numbers above its own threshold (factor 0.000002, threshold 200,000 USD). The formula's shape carries over; the parameters must be read from the host the order goes to.

## What to change in the code, by outcome (description only)

- **Step 4 gives about 1,028 (documented reading).** Replace `factor × contracts` in `shortOptionMarginUsd` and `futuresMarginUsd` by `factor × max(0, notional − max_leverage_notional)`, with notional = contracts × contract value × spot for an option and × price for a future. That needs `max_leverage_notional` carried through: `RawProduct` and `getProduct` (`packages/venues/src/delta/trading.ts:286-295`, `:411-423`), the list parser (`raw.ts`, `normalize.ts:169`), `VenueProduct`, `MarginParams` (`apps/api/src/margin.ts:20-24`) and both call sites. Without the threshold the term cannot be computed, so return null rather than fall back to the old arithmetic. Update the comments that state the unit, the tests that encode the old formula (`apps/api/src/autopilot.test.ts:723`, `apps/api/src/margin.test.ts`, the venues trading tests), and write an ADR that supersedes the unit clause of ADR-091 and ADR-095. Below the threshold the stored figures barely move.
- **Step 4 gives about 639 (the code's reading).** No arithmetic change; close GAPS #109 on that evidence and say in the comments that the unit is verified on testnet, date and figures.
- **Step 3 shows no premium term.** Drop `mark × contractValue` from the short option estimate (the preview then overstates today, which is the safe side); keep the separate net-debit term.
- **Step 3 shows the margin follows the leverage setting.** The maximum-leverage figure is a floor, not an estimate. Either read the order leverage per product (an authenticated read, `GET /v2/products/{product_id}/orders/leverage` in Delta's documentation) and use notional ÷ leverage, or set the leverage before placing, and until then label the figure "minimum" for options as it already is for futures (GAPS #120). Live Autopilot should not size on a floor.
- **Step 1 shows Portfolio (or step 5 shows relief).** The per-leg sum is the wrong model. Read the account's margin mode (the position and user objects carry `margin_mode`) and either refuse to self-place unless the mode is isolated, or build the portfolio calculation (risk scenarios and floor) as its own piece of work. Do not subtract a guessed relief.
- **Step 5 shows no relief (expected).** Keep the "no relief" rule; replace "unverified" in ADR-091, ADR-128 and `margin.ts:11-12` with the documented statement and the test result.
- **Whatever the outcome.** Read margin parameters from the same host the order is sent to (testnet and production differ by ten times on the BTC option factor), and consider adding the reserved fees and `max(mark, best bid)` for sells if the remaining gap after the check matters.
