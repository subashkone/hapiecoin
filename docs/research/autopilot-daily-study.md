# Daily-expiry BTC structures: what earned, at which hour, and whether a ladder helps (21 November 2026)

Status: analysis for the owner's decisions of 21 November; the product change it led to is ADR-112. Scripts and full tables: [scripts/autopilot-study/](scripts/autopilot-study/) (`study.py`, `results-2026-11-21.txt`, and the same with 1 % slippage). Earlier work on the same data source: [backtest-daily-structures.md](backtest-daily-structures.md) (6 November, 90 expiries, 8 structures).

## 1. Data and method

- **Source.** Delta Exchange India's public candle history (5-minute `MARK:` candles, which it serves for expired options), downloaded with `scripts/paper-timing/fetch.py`: every BTC daily expiry from 8 August to 21 November 2026 (106 expiries), strikes within 2,400 of the day's spot range in 200 steps.
- **Entries.** Every structure at every hour of the 24 before settlement (12:00 UTC, 17:30 IST), strikes relative to the at-the-money strike at that moment. "21:30 IST" is the bar at 16:00 UTC.
- **Size and prices.** 100 lots (0.1 BTC) per leg, filled at the 5-minute mark close. A second run adds 1 % of each premium as slippage on every fill.
- **Fees.** The exchange's rule as read on 6 November: 0.01 % of notional per fill, capped at 3.5 % of the premium, plus 18 % GST, and the same on every leg still open at settlement.
- **Not modelled.** Margin (a naked strangle needs it and can be liquidated), bids and offers (marks of far strikes are model prices), funding.
- **In-sample.** 19 structures, 24 hours and several exits were tried on the same 106 days. The figures of whatever looks best are optimistic by construction.

## 2. Results at the 21:30 IST entry (net of fees, per entry)

| Structure | Exit | Mean | Days positive | Worst day | Aug | Sep | Oct | Nov |
|---|---|---|---|---|---|---|---|---|
| Strangle sold 600 away, wings 1,600 away | hold to settlement | +5.93 (84 days) | 73 % | −78 | +128 | +130 | +74 | +167 |
| Strangle sold 1,000 away, wings 2,000 away | hold to settlement | +7.68 (55 days) | 89 % | −90 | +42 | +153 | +9 | +219 |
| Naked strangle 600 | each sold option stopped at 2x its price | +7.51 | 45 % | −60 | −53 | +488 | +26 | +334 |
| Naked strangle 600 | each sold option stopped at 3x | +12.00 | 61 % | −98 | | | | |
| Naked strangle 600 | hold to settlement | +7.46 | 76 % | −349 | −25 | +485 | −323 | +654 |
| Naked strangle 400 | stopped at 3x | +14.38 | 63 % | −102 | | | | |
| Naked strangle 1,000 | stopped at 2x | +6.30 | 52 % | −28 | −47 | +391 | +95 | +222 |
| Straddle sold at the money | stopped at 2x | +9.11 | 48 % | −102 | −46 | +408 | −1 | +606 |
| Iron butterfly, wings 1,000 | hold | +1.96 | 51 % | −50 | +236 | +14 | −153 | +109 |
| Iron butterfly, wings 600 | hold | −0.87 | 42 % | −31 | +137 | −121 | −143 | +35 |
| Iron condor 400 / 800 | hold | −0.82 | 53 % | −29 | +52 | −32 | −130 | +24 |
| Long call butterflies (wings 200 / 400 / 800) | hold | −4.35 / −3.08 / −0.12 | 15 to 50 % | −11 to −39 | | | | |
| Debit spreads, credit spreads 400 / 800 | hold | −3.99 to +0.34 | 36 to 75 % | −23 to −37 | | | | |
| Long straddle | hold | −15.31 | 31 % | −136 | | | | |

With 1 % slippage on every fill the naked strangle 600 at 2x is +7.07 and the 1,000 at 2x is +6.19.

## 3. Entry hour

For the naked strangle 600 with the stop at 2x, the two bars at 20:30 and 21:30 IST stand out: +8.87 and +7.51 a day. Every other hour is between −1.9 and +3.0. Held without a stop, the hours just after settlement (17:30 to 19:30 IST) are the worst: −4.6 to −6.6 a day with single days of −590 to −670. The last three hours before settlement (14:30 to 16:30 IST) barely lose (85 to 100 % of days positive, worst day 0 to −70 by width) and barely earn (−0.6 to +2.6 a day).

## 4. Reward to risk

Median maximum profit over maximum loss at entry, over all entry hours: long call butterfly wings 200 6.9 to 1 (87 % of entries at 3 to 1 or better), wings 400 3.1 to 1 (51 %); debit spreads 1.5 to 1.8 to 1; iron butterfly 600 1.8 to 1 (26 % of entries at 3 to 1 or better); iron condor 0.6 to 1; credit spreads 0.2 to 0.3 to 1; the winged strangles 0.18 and 0.08 to 1. The structures at or above 3 to 1 lost in every month. A floor of 3 to 1 keeps them and removes the only family that earned, which has no ratio at all (naked) or a low one (winged). The loss is better bounded by the wings or by a stop on each sold option.

## 5. The ladder

After the 21:30 IST entry, the same structure was opened again on the new at-the-money strike whenever the price stood 400, 600 or 1,000 away from every centre held (up to four trades, none in the last two hours).

| Structure and exit | Single trade, total over 106 days | Ladder at 600, total | Worst day single / ladder |
|---|---|---|---|
| Naked strangle 600, each option stopped at 2x | +796 | +333 | −60 / −265 |
| Naked strangle 600, hold | +791 | −290 | −349 / −1,046 |
| Iron butterfly 600, hold | −92 | −792 | −31 / −106 |
| Long call butterfly 400, hold | −326 | −1,145 | −20 / −69 |

On the days the ladder added, the first trade averaged a small profit for the strangle and the added trades together a loss (−5.78 with the stop, −13.51 without). Two or more of the day's trades ended positive on 0 to 10 % of those days for the butterflies and 24 % for the stopped strangle. The price reaches the next strike by trending, and it usually goes on. ADR-110's several-trades rule was set back to one trade at a time on this evidence.

## 6. Not tested yet

Calendar spreads; weekly and monthly strangles; ETH; strikes set by the day's expected move instead of a fixed distance; skipping US announcement days; a trend filter on the sold side; a timed exit before settlement; margin.
