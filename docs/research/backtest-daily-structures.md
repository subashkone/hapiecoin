# Backtest: your daily-expiry BTC structures on 90 days of exchange history, with real fees (6 November 2026)

Status: analysis for the user. Read-only: nothing in the app changed. Companion to [paper-timing-analysis.md](paper-timing-analysis.md) (the three days of your own paper trades). Scripts: `docs/research/scripts/paper-timing/fetch.py` (download) and `sim.py` (simulation).

## 1. Data and method

- **Source.** Delta Exchange India's public candle history (`GET /v2/history/candles`, 5-minute, `MARK:` symbols) serves expired options; it reaches back at least to November 2025. Downloaded: every BTC daily expiry from **8 August to 5 November 2026** (90 expiries), all strikes within 2,400 of the day's spot range in 200 steps, plus the BTCUSD mark. 6,634 option symbol-days requested, about 5,360 with candles (strikes the exchange never listed come back empty), cached in the scratchpad (not in git).
- **Entries.** Every structure is opened at every hour on the UTC hour during the 24 hours before settlement (12:00 UTC, which is 17:30 IST), 24 entries per expiry, strikes relative to the at-the-money strike at that moment. That is 2,150 to 2,160 entries per structure. UTC hours are half-hours in IST, so an "IST entry hour" below means that hour plus thirty minutes: the "21" row is the 21:30 IST entry, the 14 to 16 band is 14:30 to 16:30.
- **Size.** 100 lots per leg (0.1 BTC), the size you used in the paper trades.
- **Prices.** Fills at the 5-minute mark close. That is optimistic: a real market order crosses the spread. A second run adds 1 % of each premium as slippage on every fill; both are reported.
- **Fees, the real rule, read from the exchange on 6 Nov.** Taker 0.01 % of notional per fill (product list: `taker_commission_rate` 0.0001), capped at 3.5 % of the premium (`premium_commission_rate` 0.035), plus 18 % GST (fee page), and the taker fee again on every leg still open at settlement (fee page: "Settlement fee applies to all open contracts at the time of settlement"). The app's seeded 0.05 % and 10 % cap are wrong for options (GAPS #129).
- **Settlement.** Intrinsic value at the last mark before 12:00 UTC. Delta settles on an index average; the difference is small for this purpose.
- **Exits tested.** Hold to settlement; a target at 20 / 30 / 50 % of the structure's max profit (of the net premium when the max is unbounded); a 30 % target with a 30 % stop; and, for the 21:30 IST entry, closing at each clock hour of expiry day.
- **Not modelled.** Margin (a naked strangle at 100 lots needs real margin and can be liquidated), the maker rebate, funding, and the fact that marks of far wings are model prices with no bids under them.

## 2. The structures

Named after the paper trades of 3 to 5 Nov:

| Structure | Legs (relative to ATM, strike step 200) | Fills per round trip |
|---|---|---|
| Iron butterfly ±600 | sell ATM call and put, buy +600 call, buy −600 put | 8 |
| Iron condor | sell +400 call and −400 put, buy +800 call and −800 put | 8 |
| Short strangle ±600 (naked) | sell +600 call and −600 put | 4 |
| Call ladder (your 3C) | sell ATM call, buy +400 call, buy +800 call | 6 |
| Long call butterfly 1:2:1 (your 3C / 3P) | buy −400 call, sell 2 × ATM call, buy +400 call | 8 (middle leg 200 lots) |
| Call ratio (your CS) | sell ATM call, buy 2 × +400 call | 6 |
| Put ratio (your PS) | sell ATM put, buy 2 × −400 put | 6 |
| Debit call condor (your CBF-2109) | buy −600 call, sell −200 and +200 calls, buy +600 call | 8 |

## 3. Results over all entry hours (90 days, 100 lots, net of fees)

Mean P&L per entry in USD; "win" is the share of entries that ended positive after fees; "max DD" the deepest drawdown of the running total in the order traded.

| Structure | Mean credit | Fees per round trip | Hold to settlement | Target 30 % | Target 30 % + stop 30 % | Hold, with 1 % slippage |
|---|---|---|---|---|---|---|
| Iron butterfly ±600 | +36.3 | 3.5 | −2.85, win 45 %, DD −8,068 | −3.22, win 61 % | −4.27, win 49 % | −3.70 |
| Iron condor | +13.6 | 2.3 | −1.93, win 61 %, DD −5,595 | −2.38, win 83 % | −3.15, win 54 % | −2.44 |
| Short strangle ±600 | +24.1 | 1.1 | −1.22, win 81 %, DD −10,145 | −2.90, win 93 % | −0.54, win 63 % | −1.46 |
| Call ladder | +5.2 | 2.5 | −0.40, win 45 %, DD −9,514 | −3.44, win 51 % | −3.62, win 29 % | −0.99 |
| Long call butterfly 1:2:1 | −11.7 (debit) | 4.9 | −4.35, win 34 %, DD −10,244 | −4.75, win 49 % | −5.41, win 44 % | −5.74 |
| Call ratio | −2.2 (debit) | 2.8 | −0.73, win 35 %, DD −10,918 | −3.54, win 44 % | −3.99, win 24 % | −1.39 |
| Put ratio | (debit) | 2.4 | −3.91, win 42 %, DD −9,384 | −2.90, win 45 % | −3.69, win 24 % | −4.50 |
| Debit call condor | (debit) | 4.7 | −4.47, win 44 %, DD −10,514 | −4.90, win 51 % | −5.59, win 37 % | −6.02 |

**Every structure loses money on average over the 90 days, at every exit rule, before slippage.** The high win rates of the condor and strangle (61 to 93 %) are real, and so are the losses: the losing days are several times the size of the winning ones. For the premium sellers, targets raise the win rate and lower the average, because they cut the winners and leave the losers to settle (the put ratio is the one exception: a target trims its loss from −3.9 to −2.9). A stop helps only the strangle, and not to profit.

## 4. Entry hour

The same per hour, for the three premium-selling structures (hold to settlement; IST entry hour, 88 to 90 entries each):

| Entry IST | Iron butterfly mean / win | Iron condor mean / win | Strangle mean / win / worst drawdown |
|---|---|---|---|
| 00 to 06 | −2.1 to −7.3 / 37 to 47 % | −1.6 to −4.2 / 55 to 59 % | −1.7 to −4.5 / 74 to 81 % / −490 to −670 |
| 07 to 09 | −2.0 to −4.2 / 44 to 50 % | −0.6 to −2.1 / 62 to 67 % | +2.6, −1.4, −0.9 / 83 to 84 % / −330 to −440 |
| 10 to 13 | −0.9 to −3.4 / 49 to 54 % | −2.3 to +0.1 / 61 to 72 % | −1.5 to −3.0 / 81 to 92 % / −340 to −500 |
| **14 to 16** | **+1.0, +2.8, −0.7 / 58 to 70 %** | **+1.0, +0.3, −0.9 / 84 to 90 %** | **+1.0, +0.6, −0.6 / 94 to 97 % / −30 to −70** |
| 17 to 19 | −2.4 to −3.9 / 32 to 34 % | −2.9 to −4.7 / 41 to 46 % | −1.7 to −4.2 / 70 to 72 % / −940 to −1,000 |
| 20 to 22 | −0.8 to −4.3 / 37 to 42 % | −0.7 to −2.6 / 50 to 54 % | **+5.2, +3.9, +0.5** / 77 to 78 % / −510 to −800 |
| 23 | −4.3 / 35 % | −3.0 / 53 % | −3.1 / 78 % / −690 |

Two patterns hold across all three structures:

- **The only reliably non-losing window is 14:00 to 16:00 IST**, the last one to three and a half hours before settlement. The credit is tiny (a few dollars at 100 lots), the win rate is high, the drawdowns are a tenth of the other hours. It is a scalp of the final premium decay, and the fee is a large share of the tiny credit.
- **The worst window is 17:00 to 19:00 IST**, the first hours of a new daily expiry and the start of the US session, followed by 23:00 to 06:00 IST. Entering as the US day opens means carrying its whole move.

**The evening entry (20:30 to 22:30 IST) that your paper trades used** is the other band with a positive mean, and only for the naked strangle: +5.2, +3.9 and +0.5 per entry, 77 to 78 % wins (two single hours elsewhere are also slightly positive: the 07:30 strangle at +2.6 and the 13:30 condor at +0.1). The iron butterfly and condor at the evening hours lose. The strangle's number does not survive a closer look:

| 21:30 IST strangle, by month | Entries | Mean | Total | Win | Worst day |
|---|---|---|---|---|---|
| August (from the 8th) | 24 | −1.1 | −25 | 88 % | −299 |
| September | 30 | +16.2 | +485 | 77 % | −306 |
| October | 31 | −10.4 | −323 | 68 % | −349 |
| November (5 days) | 5 | +42.5 | +212 | 100 % | +14 |

One good month, one bad month, and losing days of $300 to $350 against a mean credit of $40 and an average winning day of $33: the worst day is about 10 times the average win. That is the shape of selling naked premium: it looks like an edge until the month it is not. By weekday the Friday expiries lost −45 on average and the Saturday ones made +29, on 12 to 13 samples each, which is not enough to act on.

## 5. Exit hour and where the peak was

For the 21:30 IST strangle entry, closing on the clock of expiry day: 11:00 to 13:00 IST gave the best mean (+8.7, +9.2, +8.0, 79 to 82 % wins), the morning 06:00 to 09:00 about +4 to +5.4, and holding to settlement +3.9. For the iron butterfly and condor every clock exit is negative. The hour of the best unrealised moment for 21:30 entries was most often 16:00 to 17:59 IST (the last two hours before settlement) for the three sold-premium structures (the ladder and the ratios most often peaked in their first hour), so over 90 days the pattern of your three November days (peaks at 06:00 to 11:00 IST) was that week's pattern, not the norm.

## 6. Your own structures

The call ladder, the 1:2:1 butterfly, the two ratio spreads and the debit call condor lose on average over all entry hours under every exit rule, with win rates of 24 to 55 %; a few single hours are positive for the ladder and the call ratio (up to +4.7, at hours scattered through the day with no pattern), the debit condor is negative at every hour. The 21:30 IST entry you used: ladder −2.7 per entry (30 % wins), butterfly −3.2 (29 %), call ratio −4.1 (23 %), put ratio −7.5 (21 %), debit condor −2.8 (42 %). The two 1:2:1 butterflies that won on 4 Nov were in the 29 % that win.

## 7. Are these strategies worth it

On this evidence, as daily-expiry trades at 100 lots on Delta India: **no, not as a routine**. Fees are not the reason (they are 1 to 5 dollars a round trip); the premium on a 20-hour option is simply priced about right, and the days it is wrong are expensive. What the data supports:

1. If you sell daily premium at all, do it as a **defined-risk structure in the 14:30 to 16:30 IST window** and accept a small credit, or not at all. Do not sell the new expiry at 17:30 to 19:30 IST.
2. **The naked strangle at 21:30 IST is the only routine that showed a positive mean, and it is a tail-risk trade**: one month was +485, the next −323, and the worst day is ten times the average win. Without margin modelled and with 100 lots, one bad night can take a month.
3. **Targets do not help the premium sellers** on a 20-hour option; they shave the winners. A stop on the strangle reduced the drawdown the most.
4. The ladders, ratios and 1:2:1 butterflies as you sized them are losing shapes on these 90 days. The butterfly needs the spot to sit still at the middle strike for 20 hours; it did so on 29 to 34 % of days.

What this backtest cannot tell you: whether weekly or monthly expiries (where theta is slower and the credit covers the fee many times) behave differently, whether the ETH and XAUT ladders differ, and whether real fills on the thin far wings match the marks. Each is one more run of the same scripts with a different expiry rule or symbol set.

## 8. Repeating or extending

```
S=C:/path/to/scratch; python -I docs/research/scripts/paper-timing/fetch.py $S/cache 2026-08-08 2026-11-05
python -I docs/research/scripts/paper-timing/sim.py $S/cache        # fills at mark
python -I docs/research/scripts/paper-timing/sim.py $S/cache 1      # 1 % slippage per fill
```

The download is throttled under four requests a second and takes about 45 minutes for 90 days; it caches, so a rerun only fetches new days. Extending to weekly expiries means changing the expiry rule in `fetch.py` and the 24-hour window in `sim.py`; extending to ETH means the symbol prefix and the strike step.
