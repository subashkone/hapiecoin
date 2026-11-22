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
| Naked strangle 600 | each sold option stopped at 3x | +12.00 | 61 % | −98 | −41 | +766 | +130 | +417 |
| Naked strangle 600 | stopped at 2x, whole trade closed at half the premium | +6.75 | 59 % | −60 | +175 | +242 | +5 | +293 |
| Naked strangle 600 | stopped at 3x, closed at half the premium | +9.27 | 77 % | −82 | +211 | +513 | −37 | +296 |
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

## 6. After the first stop: keep, trail or close the other side

For the naked strangle 600 entered at 21:30 IST (`study.py`, section E). With the stop at 2x a stop was hit on 64 of the 106 days; with the stop at 3x on 38.

| After the first stop | Stop at 2x: mean / worst day | Stop at 3x: mean / worst day |
|---|---|---|
| Keep the other side to settlement, with its own stop | +7.51 / −60 | +12.00 / −98 |
| Trail its profit, give back 50 % of the best | +6.45 / −42 | +12.19 / −98 |
| Trail, give back 30 % | +5.50 / −42 | +12.01 / −98 |
| Trail, give back 10 % | +5.81 / −42 | +11.65 / −98 |
| Close it at once | +6.32 / −42 | +11.78 / −101 |

Keeping earns the most: after a stop the other side is usually far from the price and decays to nothing. Trailing or closing had a smaller worst day (the script counts the days both sides were stopped for the keep version only: 5 at 2x). The three give-backs are not ordered (10 % beat 30 %) and 50 % beat closing at once by 0.13 a day, which is noise on 64 days. ADR-114 put the 50 % trail on paper beside the keep version.

## 7. Weekly and monthly expiries

A second run (`scripts/autopilot-study/fetch_weekly.py`, `study_weekly.py`, tables in `results-weekly-2026-11-22.txt`): 51 BTC Friday expiries from 5 December 2025 to 20 November 2026, of which 11 are monthly, 1-hour marks, the same fees, 100 lots. Strikes are a percentage of the spot away on the 500 ladder; the entry is N days before expiry at 21:30 IST.

| Weekly strangle sold 3 % away | Friday entry (7 days): mean a week / weeks positive / worst | Tuesday entry (3 days): mean / positive / worst |
|---|---|---|
| Each option stopped at 3x | +40.65 / 57 % / −168 (51 weeks) | −2.92 / 51 % / −171 (47 weeks) |
| Stopped at 3x, closed at half the premium | +28.59 / 73 % / −168 | −1.69 / 64 % / −132 |
| Stopped at 2x | +28.33 / 43 % / −268 | +0.50 / 38 % / −121 |
| Stopped at 2x, then the rest trailed by half | +23.52 / 41 % / −230 | −3.60 / 38 % / −121 |
| Stopped at 2x, closed at half the premium | +14.52 / 51 % / −268 | +0.35 / 51 % / −121 |
| Wings 7 % away, hold | +35.58 / 73 % / −246 (26 weeks) | +9.03 / 62 % / −183 (21 weeks) |
| No stop, hold | +7.61 / 75 % / −1,220 | −7.58 / 77 % / −963 |

The Friday entry with a stop was positive in both halves of the year under every exit (3x: +1,466 and +607). Sold 5 % away it was similar (3x: +42.01 a week on 36 weeks, worst −137). Entries two to four days before expiry were flat or negative. The monthly cycle has one to seven trades per entry day and swings from +300 to −1,290 a trade: no conclusion. ADR-115 put the five stopped or winged exits on paper for both entry days.

## 8. Strikes by premium, and the monthly expiry

`study_premium.py` (one entry per expiry, the call and the put each priced nearest a target) and `study_monthly.py` (eleven monthly expiries of 2026, every entry day from 75 to 14 days before, hourly marks); tables in `results-premium-daily-2026-11-22.txt`, `results-premium-weekly-2026-11-22.txt` and `results-monthly-BTC-2026-11-22.txt`. 100 lots, net of fees.

| Daily, entered 21:30 IST | About how far | Stop at 3x: mean / worst day | Stop at 3x, take half: mean / days positive / worst |
|---|---|---|---|
| 50 a side | 2.2 % | +1.71 / −84 | +2.17 / 82 % / −25 |
| 100 a side | 1.6 % | +4.53 / −78 | +4.25 / 84 % / −55 |
| 150 a side | 1.2 % | +7.00 / −78 | +6.53 / 82 % / −64 |
| 200 a side | 0.9 % | +8.61 / −90 | +6.14 / 77 % / −90 |
| 300 a side | 0.6 % | +10.79 / −148 | +7.98 / 75 % / −148 |
| 400 a side | 0.3 % | +12.58 / −148 | +10.29 / 73 % / −148 |

Every level was positive in both halves of the period with a stop. The mean and the worst day grow together.

| Weekly, Friday entry | About how far | Stop at 3x: mean / worst week | Stop at 3x, take half: mean / positive / worst | No stop: worst week |
|---|---|---|---|---|
| 100 a side | 9.8 % | +6.00 / −94 | +3.13 / 80 % / −78 | −1,106 |
| 200 a side | 7.6 % | +8.91 / −86 | +7.26 / 78 % / −68 | −1,140 |
| 300 a side | 6.3 % | +14.46 / −100 | +7.42 / 73 % / −100 | −1,173 |
| 500 a side | 4.5 % | +20.74 / −131 | +14.99 / 73 % / −131 | −1,188 |
| 800 a side | 2.8 % | +26.61 / −176 | +21.76 / 71 % / −176 | −1,228 |

Entered on a Tuesday the same trades were flat or negative at every premium.

| Monthly (11 expiries) | Entry | Hold, no stop | Stop at 2x, take half: mean / expiries positive / worst expiry | Stop at 3x, take half |
|---|---|---|---|---|
| 1,000 a side (about 20 % away) | 60 to 75 days before | −139 | +26.4 / 7 of 11 / −69 | +44.8 / 8 of 11 / −132 |
| 1,000 a side | 30 to 44 days before | −307 | +37.1 / 8 of 11 / −33 | +34.4 / 8 of 11 / −131 |
| 8 % away | 60 to 75 days before | | +102.7 / 9 of 11 / −123 | +161.0 / 9 of 11 / −264 |
| 12 % away | 30 to 44 days before | | +45.9 / 9 of 11 / −8 | +49.7 / 9 of 11 / −115 |
| 16 % away | 60 to 75 days before | | +58.1 / 8 of 11 / −99 | +86.1 / 9 of 11 / −130 |

Held to settlement with no stop, or with wings bought half as far again and nothing else, every monthly shape lost. The take at half the premium is what pays on a naked one: the trade is usually closed in its first weeks. ADR-117 put three monthly shapes, a daily one at 100 a side and a Friday one at 200 a side on paper.

With every exit on the winged shapes as well (rerun for ADR-118), entered 30 to 44 days before:

| Monthly, one month out | Hold | Stop at 3x | Stop at 3x, take half |
|---|---|---|---|
| 12 % away, naked | −243 / 6 of 11 | +71.3 / 7 of 11 / worst entry −199 | +49.7 / 9 of 11 |
| 12 % away, wings 18 % | −105 / 6 of 11 | +209.1 / 11 of 11 / worst entry −266 | +33.6 / 9 of 11 |
| 8 % away, wings 12 % | −38 / 5 of 11 | +338.5 / 10 of 11 / worst entry −428 | +54.8 / 11 of 11 |

Wings with a stop on the sold options is the best monthly result: the wing behind a stopped option is kept and pays when the month keeps trending. It rests on eleven expiries of a year with large one-way months and on far-wing marks that are model prices. Every figure is the mean over every entry day of the range; Autopilot enters on the first evening only.

## 9. ETH and XAUT (ADR-119)

Each coin on its own settlement time, lot and strike spacing. XAUT options settle at 16:00 UTC (21:30 IST) and list no Sunday expiry; a first study that reused BTC's 12:00 UTC was discarded.

| Set | Shape and exit | Mean | Positive | Worst |
|---|---|---|---|---|
| ETH daily, entered 21:30 IST, 106 days | 1 % away, stop at 3x | +4.46 a day | 61 % | −50 |
| | 1 % away, stop at 3x, take half | +3.10 | 75 % | −45 |
| | 1 % away, no stop | +6.67 | 81 % | −138 |
| | 1.5 % away, wings 3.75 %, held | +4.22 on 105 days | 83 % | −59 |
| XAUT daily, entered 21:30 IST (the hour after the previous expiry), 91 days | 1 % away, stop at 2x | +0.19 a day | 48 % | −2.1 |
| | 1 % away, stop at 2x, take half | +0.19 | 67 % | −1.4 |
| ETH weekly, Friday entry, 51 weeks | 4 % away, stop at 3x | +14.43 a week | 57 % | −83 |
| | 4 % away, stop at 3x, take half | +14.08 | 75 % | −72 |
| | 4 % away, no stop | +11.74 | 76 % | −582 |
| ETH weekly, Tuesday entry | 3 % away, stop at 3x | +9.03 | 57 % | −82 |
| ETH monthly, 60 to 75 days out, 11 expiries | 16 % away, wings 24 %, stop at 3x | +88.3 a trade | 10 of 11 expiries | −250 |
| ETH monthly, 30 to 44 days out | 12 % away, stop at 2x, take half | +32.1 | 10 of 11 | −69 |
| | 12 % away, no stop | −96.0 | 5 of 11 | −767 |

Entry hour (`results-entry-hours-*`, strikes 1 % away at every hour): on BTC only 20:30 and 21:30 IST earn (stop at 3x: +12.82 and +11.75 a day; every other hour between −1.90 and +4.89); on ETH 19:30 to 22:30 IST, best at 21:30; on XAUT the hour after the previous expiry is the best and thin (+0.19 a day; +0.12 an hour later, +0.09 two hours later, then flat or negative until the next evening). XAUT weekly had a price in 16 or 17 of 51 weeks and came out flat to negative; XAUT monthly has no prices before the middle of 2026. Neither is traded.

Two exit ideas of the owner were tested the same day and are not built: reaching half the premium and then trailing with a 20 % give-back beat closing at half on BTC daily (+11.30 against +9.02), ETH daily and BTC weekly with the same worst result (`results-half-then-trail`); closing in four equal parts at 25 %, 50 % and 75 % of the premium and at expiry earned about what closing all at half does on daily and more on weekly, with the smallest worst day on BTC daily (`results-scale-out`). That figure is the mean of four separate trades, each judged on its own profit; a rule that counts the whole trade's realised and open profit together would come out differently. Further exit studies are the strategy lab's (`docs/research/STRATEGY-LAB.md`).

## 10. Not tested yet

Calendar spreads; XAUT weekly and monthly once a year of prices exists; strikes set by the day's expected move instead of a fixed distance; skipping US announcement days; a trend filter on the sold side; a timed exit before settlement; margin.
