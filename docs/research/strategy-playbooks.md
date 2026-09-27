# Strategy playbooks: entry, management and exit rules on the templates we already have (27 September 2026)

Status: research for the user's decision; not scheduled (feature freeze, ADR-090; backlog item 31). Companion to [ai-leverage.md](ai-leverage.md): these playbooks are what the opportunity radar in that note would surface.

## 1. The gap

The catalogue holds 48 structures, from Buy Call to Jade Lizard, including perp-hedged positions (`packages/pricing/src/templates.ts`). A structure is half of a strategy. The other half is when to enter, how large, how to manage, and when to leave. Today the trader supplies all of that by hand: the Wizard ranks structures once the trader states a view, the Screener ranks options when the trader opens it, and the rule engine runs the stop, target, leg stop, spot and time rules the trader arms. Nothing in the product carries a complete, named, tested plan.

A **playbook** is that plan: a template from the catalogue, an entry condition computed from data we record, a size rule, management rules the rule engine already runs, and an exit. Because the backtest replays templates over our own end-of-day chains (ADR-077), every playbook can carry its own track record.

## 2. A caution that belongs in the product copy

No strategy is proven to make money. The playbooks below are the ones with the best-documented edge in options and crypto markets as far as I know, and I have not verified any of them against our own data. Each ships only after the backtest on our recorded chains says what it did, and it is retired by the same numbers. Crypto moves in tails more often than equity indices do; every playbook here is defined-risk for that reason, and the two that are not by nature (covered call, risk reversal) are noted.

## 3. Expiry playbooks

| Playbook | Structure in the catalogue | Entry | Manage and exit | Main risk |
|---|---|---|---|---|
| Expiry-week credit spread | Bull Put Spread or Bear Call Spread | Start of the expiry week; short strike near 15 to 20 delta on the side away from the trend; width two to three listed strikes | Close at half the credit, or one day before settlement, whichever comes first; stop at twice the credit | A fast move through the short strike |
| Pin butterfly | Long Call Butterfly or Long Put Butterfly | One to two days before expiry, centred on the max-pain strike (`maxPain` in `packages/pricing/src/chain.ts`, already shown in the chain footer and the Structure tab), wings one to two strikes out | Hold to settlement; take profit at three times the debit | Low hit rate; the loss is the small debit |
| Front-week calendar | Long Calendar with Calls or Puts | Front expiry ATM IV above the next expiry's by a set margin (term structure on the Structure tab) | Close before the front leg settles, or at a quarter of the debit lost | A large move away from the strike; the margin estimate understates calendars (GAPS #77) |

## 4. Momentum playbooks

| Playbook | Structure | Entry | Manage and exit | Main risk |
|---|---|---|---|---|
| Trend with defined risk | Bull Call Spread in an uptrend, Bear Put Spread in a downtrend | Price above its 20 and 50 day averages, or a close above the 20 day high; mirror for shorts; two to four weeks to expiry | Exit on a close back through the 20 day average, at the target, or at half the debit lost | Whipsaw in a range |
| Volatility squeeze breakout | Long Strangle, or Call / Put Back Spread 1x2 | Realised volatility at a multi-week low and IV rank under 20 | Exit after a move of one and a half expected moves, or on a time stop at half the life | Premium decay if nothing happens |
| Trend financed by skew | Risk Reversal, kept defined by using a put spread on the sold side | Uptrend plus 25-delta put skew above its own one-year median | Stop on trend failure | A gap against the sold side; undefined if the plain risk reversal is used |

## 5. Carry playbooks, the best-evidenced group

| Playbook | Structure | Entry | Manage and exit | Main risk |
|---|---|---|---|---|
| Premium harvest | Iron Condor | IV rank above 50, 30 to 45 days to expiry, short strikes near 16 delta, wings two to three strikes | Close at half the credit or at 21 days left; stop at twice the credit | Tail moves |
| Covered call on a holding | Covered Call (perp or spot holding plus a sold call) | Monthly, call near 25 to 30 delta | Roll up and out when the call is tested | Upside capped in a rally; downside is the holding's |

The evidence base, stated carefully: implied volatility has exceeded realised on average in index options over decades, which is the premium that put-write and buy-write indices capture; published research reports time-series momentum in crypto returns. Neither claim is verified here, and neither says anything about next month.

## 6. What the system needs

1. **A playbook object** (schema + API + a Playbooks sub-tab beside Templates and Wizard): template id, entry condition, size rule, management rules, exit. The rule engine's five kinds already cover management and exit; entry conditions are new.
2. **Trend and volatility signals** computed from the marks we record: 20 and 50 day averages, 20 day high and low, realised-volatility percentile, IV rank (exists), term-structure slope (exists), skew percentile, max pain (exists). Today the only moving averages are the three long ones on the cycle page (111, 350 and 730 days, `apps/ingest/src/jobs.ts`); none of the short trend averages a momentum entry needs exists.
3. **A track record per playbook** from the backtest: entries taken, win rate, average win and loss, worst day, shown on the card with the dates it covers. The backtest needs entry-condition support; today it enters a template every recorded day.
4. **Delivery**: the opportunity radar (ai-leverage.md §3.1) raises a card when a playbook's entry condition is met; the card opens the Builder with the legs filled and the rules pre-armed, and the trade flow, the typed LIVE word and the Mindful pause stay as they are.
5. **Copy and compliance**: decision support, never a recommendation; every card carries its own record and the disclaimer.

## 7. Suggested first three

Premium harvest, expiry-week credit spread, and trend with defined risk. They cover the three market conditions (calm, expiry week, trending), all are defined-risk, and all can be backtested on the chains we already hold. Effort, roughly: two weeks for the signals and the playbook object, one week for the backtest's entry conditions and the cards, one week for the radar delivery if the radar itself is not built first.

## 8. What would make me drop a playbook

A backtest on our own data that shows no edge after fees, a live hit rate that falls outside its backtested range for a quarter, or a venue change (margin rules, expiry cadence, liquidity at the wings) that breaks its assumptions.
