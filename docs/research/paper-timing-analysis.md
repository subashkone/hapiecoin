# When the paper trades made money: entry time, exit time and profit target (3 to 6 November 2026)

Status: analysis for the user, from the development database on 6 November 2026, read-only. Nothing in the app changed. The two scripts that produced the numbers are in `docs/research/scripts/paper-timing/` so the run can be repeated after more days (§7).

## 1. What was analysed, and the limits

- **18 closed paper strategies** started between 3 Nov 21:36 and 5 Nov 22:56 IST: 9 condors / butterflies (BTC, ETH, XAUT), 7 three-leg customs, one call spread, one put spread. All on the next daily expiry (settles 17:30 IST; XAUT 21:30 IST). 11 closed on a target, 7 ran to expiry.
- **The P&L path** is rebuilt every 5 minutes from the stored marks with the rules engine's own arithmetic (`apps/api/src/rules-engine.ts:95-103`): sum over legs of (mark minus entry) × lots × lot size, buys positive, sells negative. No fees (§5).
- **Data limits.** The 5-minute marks (`instrument_marks`) are kept 7 days and are written only while the API on this laptop is running, so they exist continuously only from 3 Nov 21:11 IST, with a gap on the night of 4 Nov (about 23:00 to 06:00 IST). Coverage per strategy is in the table. The 31 older paper strategies (September and October) have only one P&L point per day, used in §6.
- **Three days is a tiny sample**, and one market week. Every "best hour" below is as much a record of when you traded as of when the market pays. Read §2 to §4 as hypotheses to test over the coming weeks, not as rules.

## 2. Each strategy: where its profit peaked

| Strategy | Entry IST | Close IST | Held | Close | Realised $ | Peak $ (when) | Structure max $ | Peak as % of max | Coverage |
|---|---|---|---|---|---|---|---|---|---|
| BTC-CBF-03NOV26-2136 | 03 Nov 21:36 | 04 Nov 11:51 | 14.2 h | target | 7.27 | 7.35 (04 Nov 10:50) | 51.08 | 14 % | 100 % |
| ETH-CBF-03NOV26-2152 | 03 Nov 21:52 | 04 Nov 07:34 | 9.7 h | target | 2.44 | 2.20 (04 Nov 07:30) | 24.47 | 9 % | 100 % |
| XAUT-CBF-03NOV26-2153 | 03 Nov 21:53 | 04 Nov 21:32 | 23.7 h | expired | −0.72 | 0.24 (04 Nov 06:35) | 2.28 | 11 % | 100 % |
| BTC-3C-04NOV26-1045 | 04 Nov 10:45 | 04 Nov 11:15 | 0.5 h | target | 7.71 | 7.89 (04 Nov 11:15) | open-ended | – | 100 % |
| BTC-CS-04NOV26-1055 | 04 Nov 10:55 | 04 Nov 11:09 | 0.2 h | target | 6.55 | 3.74 (04 Nov 11:05) | open-ended | – | 100 % |
| BTC-PS-04NOV26-1056 | 04 Nov 10:56 | 04 Nov 17:32 | 6.6 h | expired | −1.40 | 0.58 (04 Nov 10:55) | open-ended | – | 99 % |
| BTC-CBF-04NOV26-2107 | 04 Nov 21:07 | 05 Nov 05:59 | 8.9 h | target | 9.01 | 9.02 (05 Nov 05:55) | 50.37 | 18 % | 20 % |
| BTC-3C-04NOV26-2108 | 04 Nov 21:08 | 05 Nov 10:14 | 13.1 h | target | 6.45 | 5.99 (05 Nov 10:10) | 35.71 | 17 % | 46 % |
| BTC-3P-04NOV26-2108 | 04 Nov 21:08 | 05 Nov 10:13 | 13.1 h | target | 5.99 | 6.06 (05 Nov 10:10) | 35.82 | 17 % | 46 % |
| BTC-CBF-04NOV26-2109 | 04 Nov 21:09 | 05 Nov 07:43 | 10.6 h | target | 7.79 | 7.78 (05 Nov 07:40) | 31.12 | 25 % | 33 % |
| BTC-3C-04NOV26-2111 | 04 Nov 21:11 | 05 Nov 17:32 | 20.3 h | expired | −12.22 | 0.19 (04 Nov 21:10) | open-ended | – | 64 % |
| ETH-3C-04NOV26-2112 | 04 Nov 21:12 | 05 Nov 17:32 | 20.3 h | expired | −2.64 | 1.72 (05 Nov 15:00) | open-ended | – | 64 % |
| ETH-CBF-04NOV26-2113 | 04 Nov 21:13 | 05 Nov 09:26 | 12.2 h | target | 5.99 | 5.94 (05 Nov 09:20) | 24.42 | 24 % | 42 % |
| XAUT-CBF-04NOV26-2234 | 04 Nov 22:34 | 05 Nov 21:32 | 23.0 h | expired | −6.62 | 0.44 (05 Nov 05:55) | 23.35 | 2 % | 70 % |
| XAUT-3P-04NOV26-2237 | 04 Nov 22:37 | 05 Nov 21:32 | 22.9 h | expired | 0.06 | 0.07 (05 Nov 17:25) | open-ended | – | 70 % |
| XAUT-3C-04NOV26-2237 | 04 Nov 22:37 | 05 Nov 21:32 | 22.9 h | expired | −2.05 | 1.89 (05 Nov 10:10) | open-ended | – | 70 % |
| BTC-CBF-05NOV26-2255 | 05 Nov 22:55 | 06 Nov 10:44 | 11.8 h | target | 3.68 | 4.03 (06 Nov 09:40) | 42.60 | 9 % | 100 % |
| ETH-CBF-05NOV26-2256 | 05 Nov 22:56 | 06 Nov 10:46 | 11.8 h | target | 2.51 | 3.76 (06 Nov 08:35) | 24.55 | 15 % | 100 % |

"Structure max" is the most the position can make at expiry from its entry prices; "open-ended" marks the structures whose upside has no cap (five of the customs and both spreads), so a percentage means nothing there; two customs have a capped payoff and carry a max. "Coverage" is the share of 5-minute points the marks could value.

What the table says:

- **Most targets fired within a tenth of that strategy's best moment.** The targets you set ($2.40 to $8.98) were tight enough that the engine took the profit at or near the peak; the two condors of 5 Nov were the exceptions, closing 9 % and 33 % below their peaks ($0.35 and $1.25 left). Six show a realised figure at or above the 5-minute peak because the engine fired between two samples.
- **The winners peaked in the morning.** Ten of the eleven targets fired between 05:55 and 11:15 IST; the exception fired at 11:51. Of the overnight condors, none peaked in the evening it was opened.
- **The losers never had a good moment.** BTC-3C-04NOV26-2111 was down $7.8 within 50 minutes of entry and $13.7 within two hours, and never recovered. XAUT-CBF-04NOV26-2234 went negative at 06:10 IST the next morning and drifted lower all day. No loser ever got above +$1.9.
- **Condors on BTC and ETH won; XAUT condors lost both times.** The XAUT ladder's wings are so close that the credit was $2.28 on one of them; there is nothing to harvest.

## 3. Time of day

Mean P&L of the open strategies at each IST hour, as a percentage of their structure max (all 18 strategies; the open-ended customs and spreads contribute near-zero percentages, so the figures are driven by the nine condors and butterflies; "open then" is the 5-minute point count divided by 12, so approximate):

| IST hour | Open then | Mean P&L, % of max | Share in profit |
|---|---|---|---|
| 00 to 05 | 5 | +2 to +5 % | 93 to 100 % |
| 06 to 09 | 12 to 14 | +4 to +6 % | 66 to 69 % |
| 10 | 10 | +2 % | 62 % |
| 11 to 16 | 7 | −3 to −8 % | 29 to 34 % |
| 17 to 20 | 4 to 6 | −10 to −15 % | 27 to 36 % |
| 21 to 23 | 6 to 9 | −3 to +2 % | 36 to 71 % |

The afternoon figures are survivorship: the winners had already closed on target, so from 11:00 IST only the losers remain. The honest reading is narrower: **premium sold at 21:00 to 23:00 IST on the evening before expiry was most profitable between 06:00 and 11:00 IST the next morning**, during the quiet Asian session when the overnight time decay has been collected and before the European and US sessions move the spot.

An exit-at-clock test on the same strategies (close whatever is still open at HH:00 IST on its last day, keep the realised result of anything already closed):

| Exit at | Still open | Total with the rule $ | Actual total of those $ |
|---|---|---|---|
| 06:00 | 14 | +0.45 | +17.93 |
| 07:00 | 14 | +2.02 | +17.93 |
| 09:00 | 12 | −12.45 | +7.70 |
| 11:00 | 10 | −24.09 | −4.06 |
| 15:00 | 7 | −21.01 | −25.59 |
| 17:00 | 7 | −22.04 | −25.59 |

A fixed morning exit would have been worse than your targets, because the winners needed until 05:59 to 11:51 to reach them. For the seven that ran to expiry, closing at 15:00 IST would have saved about $4.6 in total; not worth a rule.

**Synthetic check, independent of your entries.** `sweep.py` opens a standard short iron condor on BTC (sell ATM ± 2 strikes, buy ± 4, one lot) at every hour of the stored chain and follows it to settlement: 66 entries over the expiries of 30 and 31 Oct and 4 to 6 Nov, 42 with a settlement value. Findings, each on 2 to 4 entries per hour so treat as weak: evening entries (21:00 to 22:00 IST) reached +25 % of their credit in 8 of 8 cases and peaked on average at +53 % of credit, 13 hours later; entries at 14:00 to 16:00 IST (three and a half hours or less to settlement) kept 57 to 99 % of a very small credit; entries at 17:00 to 20:00 IST and 00:00 to 05:00 IST peaked at only 17 to 36 % of credit and mostly settled at a loss. For the evening entries, the P&L on expiry day was highest at 11:00 to 15:00 IST (+15 to +18 % of credit) and back to zero by 17:00. A profit-taking rule on this set made no difference to the mean, because the losing days lose more than the winning days win at this width.

## 4. How much profit to take

For the credit structures that won, the realised profit was 9 to 25 % of the structure's max profit. The losers peaked at 2 to 11 % of max. No single percentage separates the two cleanly: a target at 10 % of max is reached by 8 of 18 (one of them a loser, the XAUT condor that peaked at 11 %) and missed by two winners that peaked at 9 %; 15 % is reached by 6; nothing ever reached 30 %. So the honest answer is **about a tenth to a fifth of max profit, which is what your fixed-money targets already were**; no percentage rule beat them on this sample, and the synthetic sweep in §3 found the mean result unchanged under any target from 10 % to 75 % of credit. The daily options you sell have about 20 hours of life, so the whole premium is not available to harvest; a fifth of it overnight is what the market paid this week.

The same test on the older strategies is in §6: 23 of 31 had a day whose P&L beat the final result, $361 left on the table in total, most of it on same-day trades that were in profit during the day and expired at a loss.

## 5. The finding that matters more than timing: fees

Paper P&L, the rules engine and the realised figures the API stores contain **no exchange fees**. (Corrected 6 Nov, evening: the first version of this section used the app's seeded fee defaults, which turn out to be wrong for options, see GAPS #129.)

The real rule, read from the exchange on 6 Nov 2026: the product list (`GET /v2/products/C-BTC-77600-061126`) gives `taker_commission_rate` 0.0001 (0.01 % of notional, maker the same) and `premium_commission_rate` 0.035 (the fee is capped at 3.5 % of the premium); the fee page (delta.exchange/fees) adds 18 % GST on fees and a settlement fee at the taker rate on every contract still open at expiry. The app's seeded defaults (`packages/venues/src/port/delta-india.ts:87`) are 0.05 % and a 10 % cap, five and three times too high for options; the Trade Preview overstates fees by that much.

Applied to three of the winning condors, entry and exit, with the real rule:

| Strategy | Paper profit $ | Fees round trip $ | Net $ |
|---|---|---|---|
| BTC-CBF-03NOV26-2136 (100 lots) | +7.27 | 6.53 | +0.74 |
| BTC-CBF-04NOV26-2107 (100 lots) | +9.01 | 6.95 | +2.06 |
| ETH-CBF-05NOV26-2256 (100 lots) | +2.51 | 1.84 | +0.67 |

At 100 lots of BTC (0.1 BTC per leg, about $7,800 notional) the fee is $0.78 per leg per side before GST when the premium is large, less on cheap wings where the 3.5 % cap binds, so about $6.5 to $7 per condor round trip. **Fees took 77 to 90 % of the profit of every target that fired this week.** The trades survive on the real exchange, but barely, and one bad fill wipes a day. Before any live condor:

- Set the target to at least three times the round-trip fee: about $20 for a 100-lot BTC condor, which is 40 % of these condors' credit and was reached by none of them. So either accept the thin edge, or change the structure.
- Fewer fills or wider structures: a short strangle has four fills instead of eight; a wider condor collects more credit per fill.
- The fee cap of 3.5 % of premium means cheap far wings cost almost nothing; the sold near-the-money legs carry the fee.

The 90-day backtest with these fees is in `docs/research/backtest-daily-structures.md`.

## 6. The older strategies (September and October), daily points only

Of 31 archived paper strategies with daily P&L points, 23 had at least one day whose P&L was better than the final result; the gap sums to $361. The largest gaps: the 21 Oct long strangles and condor were all in profit ($4.6 to $9.0) on their one day and expired at −$37 to −$40 ($135 together); BTC-CBF-16SEP26-1917 was at −$120 on 29 Oct and closed at −$165 ($46); BTC-3P-23SEP26-2127 was at +$2 on its first day and expired at −$39 ($41); BTC-CBF-26SEP26-2025 peaked at $61 on 29 Oct and closed at $40 ($21). Two multi-week short strangles went through drawdowns of −$324 and −$949 before ending at +$203 and +$649: profitable, but only because no stop existed.

## 7. Repeating the analysis after more days

The marks are deleted after 7 days, so run this at least weekly while the laptop has been awake. From the repo root, with the Docker Postgres up:

```
S=docs/research/scripts/paper-timing/out; mkdir -p $S
P="docker exec hapiecoin-postgres psql -U hapiecoin -d hapiecoin -At -F , -c"
$P "select s.id, s.name, s.asset, s.template_name, s.close_reason, s.started_at, s.closed_at, s.realized_pnl, l.kind, l.side, l.strike, l.expiry, l.symbol, l.lots, l.entry_price, l.exit_price, l.opened_at, l.closed_at, l.close_reason, l.is_adjustment from strategies s join strategy_legs l on l.strategy_id=s.id where s.trading_mode='paper' and s.status='archived' and s.started_at >= now() - interval '7 days' order by s.started_at, l.position" > $S/legs.csv
$P "select m.symbol, m.ts, m.mark from instrument_marks m where m.symbol in (select l.symbol from strategy_legs l join strategies s on s.id=l.strategy_id where s.trading_mode='paper' and s.started_at >= now() - interval '7 days') order by 1, 2" > $S/legmarks.csv
$P "select symbol, ts, mark from instrument_marks where asset='BTC' and venue='delta_india' order by ts, symbol" > $S/btcmarks.csv
$P "select sp.strategy_id, s.name, s.started_at::date, s.closed_at::date, s.close_reason, s.realized_pnl, sp.day, sp.pnl from strategy_pnl sp join strategies s on s.id=sp.strategy_id where s.trading_mode='paper' and s.status='archived' order by s.started_at, sp.day" > $S/daypnl.csv
python -I docs/research/scripts/paper-timing/analyse.py $S
python -I docs/research/scripts/paper-timing/sweep.py $S
```

The `out/` folder should stay out of git. A better long-term answer is to keep the marks longer than 7 days for the symbols a strategy holds, so the path of every closed trade stays available; that is a small change to the snapshotter's retention and is not scheduled (feature freeze, ADR-090).

## 8. Summary for the trader

1. Entering short premium at 21:00 to 23:00 IST the evening before a daily expiry and letting the target fire between 06:00 and 11:00 IST worked on BTC and ETH condors this week; XAUT condors did not pay.
2. Fixed-money targets of about a tenth to a fifth of the structure's max profit caught the winners near their peaks; no percentage rule did better. The losers never got near those levels, so a stop of about the same size would have cut them early (the BTC loser was negative within an hour, the XAUT one from the next morning).
3. None of it survives fees at 100 lots. Fix the structure and size before going live: the Trade Preview's fee line must be a small fraction of the target.
