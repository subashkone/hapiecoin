# Strategy lab: the standing brief for the research thread

Started 22 Nov 2026 at the owner's request: one thread works continuously on finding, backtesting and proposing option strategies for Autopilot; a second thread builds what the owner approves. This file is the research thread's memory. Read it first, update it as you go.

## 1. Purpose and the owner's bar
- Goal, in the owner's words: "a good system to make more instead of losing", and many proven strategies, not one.
- The competitor's strategy list is only what they advertise. It is never a target. Propose whatever tests best.
- The owner wants evidence before anything trades, plain reporting when an idea of theirs does not hold, and a recommendation each time.

## 2. Rules of this thread
1. **Research only.** Work on a branch named `research/<topic>`. Touch only `docs/research/**`. Never edit `apps/**` or `packages/**`; never change Autopilot settings or the database.
2. **Pipeline for every idea:** backtest → a short result with a recommendation → the owner approves or rejects → the build thread builds it as a NEW paper strategy beside the existing ones (never by changing an existing one) → the paper record is the final test. Nothing goes live on a backtest.
3. **No real orders, no exchange keys.** Only the exchange's public candle endpoint, read-only, with the User-Agent `research-script`. Do not read `.env`.
4. **One download at a time.** The build thread does not download. Stay under 4 requests a second (the fetch scripts do).
5. **Numbers.** Do not mint ADR, GAPS or HC ids here: results go in this file and in result tables. The build thread records the decision when something is approved.
6. **Commit and push only when the owner asks.**

## 3. Data
- Location: `E:\Subash\Projects\HapieCoin-data\option-history\` (outside the repository, about 1 GB). Folders: `daily-BTC`, `daily-ETH`, `daily-XAUT` (5-minute marks, 8 Aug to 21 Nov 2026, the 24 hours before each settlement), `weekly-BTC`, `weekly-ETH`, `weekly-XAUT` (hourly, 5 Dec 2025 to 20 Nov 2026), `monthly-BTC` (hourly, month-end expiries of 2026); `monthly-ETH` and `monthly-XAUT` were still downloading when this was written (`fetch.log` in that folder ends with `== done`).
- Each expiry is a folder of `<symbol>.json` candle files plus the underlying's mark.
- Source: Delta Exchange India `v2/history/candles`, MARK prices. Marks of far strikes are model prices with little trading behind them.
- To extend: `docs/research/scripts/paper-timing/fetch.py` (daily), `autopilot-study/fetch_weekly.py`, `autopilot-study/fetch_monthly.py`. Each resumes from what is on disk. A download stopped mid-file can leave a truncated JSON: delete it and rerun.

## 4. Facts that differ by coin (check before every study)
| | BTC | ETH | XAUT (Gold) |
|---|---|---|---|
| One lot | 0.001 BTC | 0.01 ETH | 0.001 oz |
| Daily settlement | 12:00 UTC (17:30 IST) | 12:00 UTC | **16:00 UTC (21:30 IST)** |
| Daily expiries | every day | every day | every day except Sunday |
| Strike spacing near the money | 200 | 10 | 10 |
Autopilot trades 100 lots a leg. Never reuse one coin's settlement hour, strike step, lot or entry time for another: the first Gold study did, and every figure was wrong.

## 5. Method (every study)
- Fees as the exchange charges them: 0.01 % of notional per fill, capped at 3.5 % of the premium, plus 18 % GST; the same on every leg open at settlement.
- Fills at the mark close of the bar. Stops and takes are judged on bar closes (5 minutes daily, hourly weekly and monthly); the live engine checks every few seconds, so results will differ.
- Report for every variant: trades, mean, share positive, worst single trade, and the two halves of the period separately.
- Say how many variants were tried. A result chosen after seeing the table is in-sample: say so. Prefer findings that hold across neighbouring settings and across coins over a single best cell.
- State what the test cannot see: slippage, thin strikes, a regime the months did not contain.

## 6. Tools
`docs/research/scripts/autopilot-study/`:
- `study_premium.py <cache> <lot_size> <bar_minutes> <hours_before,…> <premiums,…> <percents,…> [wing_factor] [half-trail give-backs] [scale]`: sold strangles by premium or by distance, any cycle; exits hold, stop at 2x / 3x, take half, trail the rest, half-then-trail, takes at 25 / 75 %, four-part scale-out. Takes the settlement hour from the coin.
- `study_monthly.py`: month-end expiries, entry ranges of days.
- `study.py`, `study_weekly.py`: the first BTC studies (19 structures, 24 entry hours, the ladder).
- `study_exits.py <cache> <lot_size> <bar_minutes> <entry_hours_before> <percent_away> <timed exits, hours before> <distances to the strike, %>`: profit lock and rising floors, timed exits, exit by distance to the sold strike, 12 step ladders, with the known exits as yardsticks (they reproduce `study_premium.py` to the cent).
- `study_risk.py` (same arguments as `study_exits.py` plus a label; run without `-I`): per exit the worst trade, the longest run of losing trades and its loss, the deepest drawdown. `risk_bundles.py results-risk-<date>.txt`: the three bundles from their rules.
- `entry_grid.py <results file of study_premium.py> <exit rule>`: one grid of entry hour against strike choice.
Result tables sit beside them as `results-*.txt`. The write-up is `docs/research/autopilot-daily-study.md`.

## 7. What is known (22 Nov 2026)
- Of 19 daily structures on BTC only **sold strangles** earned after fees. Structures with 1:3 reward to risk (bought butterflies) lost every month. Re-entering on new strikes (a ladder of trades) lost.
- **A stop on each sold option is essential.** Without one the worst day or week is 3 to 7 times larger.
- **Entry time:** BTC 8:30 to 9:30 PM IST; ETH about 7:30 to 10:30 PM IST, best at 9:30 PM; every other hour is flat or negative. Gold: the hour after the previous expiry (9:30 PM IST) is the best and weak; it fades over the next two hours and the rest of the day loses (stop at double with take half: +0.19 a day at 24 hours before, +0.12 at 23, +0.09 at 22; build thread's figures).
- **Weekly:** Friday entries for the next Friday earn; Tuesday entries are about flat. **Monthly:** held to settlement loses; a stop with the take at half pays; wings with a stop was the best monthly result (model wing marks).
- **ETH daily:** sold 1 % away, stop at triple: +4.46 a day, 61 % of days, worst −50. **Gold daily:** sold 1 % away, stop at double with take half: +0.19 a day, 67 %, worst −1.4; wings do not earn.
- **ETH and Gold on the longer cycles (build thread's studies and figures, not rerun here):** ETH weekly, Friday entry, 4 % away: stop at triple +14.43 a week, with take half +14.08; Tuesday entry, 3 % away, stop at triple +9.03. ETH monthly: held to settlement loses; 16 % away with wings at 24 %, 60 to 75 days out, stop at triple +88.3 a trade (10 of 11 expiries positive); 12 % away, 30 to 44 days out, stop at double with take half +32.1 (10 of 11). Gold weekly and monthly: too little price history, no playbook.
- **Exit ideas from the owner, tested, not built:** reach half then trail (20 % give-back) beat closing at half on BTC daily, ETH daily and BTC weekly with the same worst result; a four-part scale-out (25 / 50 / 75 % / expiry) earned about what take-half does on daily and more on weekly, with the smallest worst day on BTC daily.
- **Exit study of 22 Nov (backlog 1 to 4, `results-exits-*`, 673 variants over four tables):** no exit clearly beat the plain stop at triple on mean: the few rows above it are within a point or two (BTC daily closed an hour before settlement +12.18 against +11.75; BTC weekly closed six hours before +42.95 and lock 60 > 25 +42.30 against +40.65; ETH daily closed an hour before +4.71 against +4.46). A lock (at 50 % of the premium, floor 25 %) kept that mean on BTC daily (+11.68 against +11.75) and BTC weekly (+40.95 against +40.65) with more positive trades (71 % against 65 % and 57 %) and beat half-then-trail on the weekly (+29.89); on ETH daily it cost a point (+3.47 against +4.46). Closing at a fixed hour loses profit the later hours earn, except closing 4 to 5 hours after entry (about 1:30 AM IST): about half the mean, 78 to 82 % positive, worst day a quarter (BTC −25 against −106) to under half (ETH −20 against −50); the neighbouring hours 0:30 and 2:30 agree on BTC, on ETH only up to 1:30. Leaving a side when the spot nears its strike is far worse than the price stop on BTC daily (best +4.00 against +11.75), ETH daily (+1.98 against +4.46) and BTC weekly (+5.09 against +40.65); on Gold it ties (+0.19). Ladders earn less than the plain stop: late ladders sit between take-half and the plain stop, early ones fall below take-half (BTC daily: early +6.63, take half +9.02, late +10.39, plain stop +11.75) and have the smaller worst trade. Two ways to judge a step were modelled: each part on its own profit (section 4 of the tables, the mean of separate trades) and the whole trade's realised plus open profit (section 5). Judged on the whole trade the last steps can never be reached (25 / 50 / 75 behaves exactly as 25 / 50 / expiry, because banked parts hold the total down), the mean is a little higher, fewer trades end positive, and the early ladder loses its smaller worst day on BTC daily (−59 against −40). A ladder should be built per part. Gold: every figure is within a few cents; nothing to choose.
- **Risk bundles, first pass (22 Nov, `results-risk-2026-11-22.txt`, `results-risk-bundles-2026-11-22.txt`):** a bundle was defined as which exits qualify (share positive, longest losing run, both halves positive, always a stop) plus the capital behind 100 lots a leg (worst trade at most 1 / 2 / 4 % and drawdown at most 3 / 6 / 12 % of it for cautious / balanced / bold). The same exit came out best per unit of risk in all three: BTC and ETH daily the stop at triple closed about 1:30 AM IST, BTC weekly the lock 50 > 25, ETH weekly half then trail 20. So the bundles differ by size, not by strategy. Capital per 100 lots a leg, cautious: BTC daily 2,500, ETH daily 1,990, BTC weekly 16,830, ETH weekly 7,240 USD; balanced half of that; bold a quarter. The exchange's margin is not modelled and is unverified (GAPS #109); it will bind before the bold size does. To be replaced by the paper record after a few weeks: worst trade, drawdown, share positive, and whether stops and timed exits fill near the bar closes assumed here. ETH weekly reproduces the build thread's figures (+14.43, +14.08).
- **Entry hour with closer strikes (22 Nov, backlog 6, `results-entry-closer-*`, read with `entry_grid.py`; 13 entry hours x 8 strike choices x 6 exits per coin):** on BTC every entry hour except 9:30 PM IST is flat or negative at every distance from 1 % down to 0.25 % and at every premium, so the earlier finding was not an artefact of the fixed 1 %. ETH earns from 7:30 PM to about 3:30 AM IST entries, best at 9:30 PM. Gold only at the hour after its expiry. At the 9:30 PM entry closer strikes earned more with the stop at triple: BTC 0.5 % away +14.60 a day (62 %, worst -114) against +11.75 (65 %, worst -106) at 1 %; ETH +6.84 (64 %, worst -51) against +4.46 (61 %, worst -50); 0.35 % and 0.25 % are about the same as 0.5 %, and both halves are positive. A late BTC entry two hours before settlement, 0.25 % away, earned +2.3 to +3.0 (63 %, worst -30 to -45) but its first half is thin: watch, not a recommendation.
- **Wings on the daily strangle (22 Nov, `results-wings-daily-2026-11-22.txt`, wings 1.5, 2 and 3 times as far as the sold strikes, 1 % and 0.5 % away, BTC and ETH):** held to settlement with no stop, the loss is capped by the wings. ETH 1 % away with wings at 3 %: +4.56 a day, 73 %, worst -47.0, both halves positive, the same as the naked strangle with a stop (+4.46, worst -49.6) but with a hard cap. BTC 1 % away: wings at 2 % +3.37 (75 %, worst -86), at 3 % +5.62 (79 %, worst -164, second half thin); about half the naked income. Wings 1.5 times as far earn nothing. A stop on the sold options of a winged trade made it worse (the wing is left alone). Far-strike marks are model prices.
- **Bundles, the owner's decision (22 Nov): different strategies per risk appetite, the bold ones held to the end.** Draft for the dailies: cautious = out by 1:30 AM IST (BTC +6.18, worst -25; ETH +2.58, worst -20); balanced = 1 % away, stop at triple, half then trail 20, to settlement (BTC +11.30, worst -69; ETH +3.65, worst -45); bold = 0.5 % away, stop at triple, held to settlement (BTC +14.60, worst -114; ETH +6.84, worst -51). On the weeklies holding to the end does not earn more than the lock or half-then-trail, so the weekly split is still open.
All of these are in-sample on one period.

## 8. Backlog (take from the top; add ideas at the bottom)
| # | Idea | Status |
|---|---|---|
| 1 | Profit lock: once up X % of the premium, a floor at Y % | tested 22 Nov: lock at 50, floor 25 matches the plain stop on BTC daily and weekly with more winning trades; costs a little on ETH; rising floors lose. Awaiting the owner |
| 2 | Timed exit (for example close at 9:30 AM IST whatever the profit) | tested 22 Nov: 9:30 AM costs about 40 % of the profit for the same worst day; out by 1:30 AM IST keeps about half the profit with a quarter of the worst day on BTC and 40 % of it on ETH. Awaiting the owner |
| 3 | Exit a side when the price comes within Z % of its sold strike | tested 22 Nov: far worse than the price stop on BTC daily, ETH daily and BTC weekly; a tie on Gold. Rejected |
| 4 | Step ladders: 3, 4 and 5 steps, early and late starts (the owner wants this configurable; find good presets) | tested 22 Nov, 12 ladders, judged per part and on the whole trade: where the steps start matters, the number of steps does not. Presets proposed: early 10/25/40/55/exp, standard 25/50/75/exp, late 50/75/exp |
| 5 | ETH and Gold weekly and monthly | closed by the build thread (ADR-119, on paper): see section 7 |
| 6 | Daytime entries with closer strikes (the entry-hour test kept 1 % away, which is unfair to late entries) | tested 22 Nov (`results-entry-closer-*`): closer strikes do not rescue any daytime hour on BTC or Gold; the evening stays the only entry. New: at the evening entry, 0.5 % away earned more than 1 % on BTC and ETH for a similar worst day. Awaiting the owner |
| 7 | Calendar spreads | not tested |
| 8 | Strikes by expected move (from implied volatility) | not tested |
| 9 | Skip or widen on announcement days and on unusually low implied volatility | not tested |
| 10 | Trend filter on the sold side (skew the strangle, or sell one side only) | not tested |
| 11 | Delta hedge with a future when the price crosses a sold strike | not tested |
| 12 | Structures other than strangles on weekly and monthly expiries (iron condors, ratio spreads, broken-wing butterflies) | only daily tested |
| 13 | Out-of-sample check: rerun the chosen strategies on data after 21 Nov 2026 | when a month of new data exists |
| 14 | Risk-profile bundles (the owner's idea, relayed by the build thread 22 Nov): group strategies and exits into cautious / balanced / bold by a rule, later tied to plans | first pass 22 Nov (`results-risk-*`): sized by risk, the same exit wins in every bundle, so a bundle is mostly a position size. Open: the exchange's margin (unverified), wings for a capped loss, monthly cycles, all coins held together, and the paper record. Awaiting the owner |

## 9. How to report to the owner
Lead with the answer and the recommendation. One small table: the idea against the current best, with mean, share positive and worst. Then what it costs, what the test cannot see, and the exact reply that approves it. Plain words; the owner reads between other work.

## 10. Log (newest first)
- 22 Nov 2026 (research thread): the owner approved the daily bundles (cautious = out by 1:30 AM IST, balanced = 1 % away with half then trail 20, bold = 0.5 % away held to settlement; all with the stop at triple) and ETH daily 1 % away with wings at 3 %, held to settlement with no stop, as a new paper strategy. Passed to the build thread. Weekly bundles and the exchange's margin stay open.
- 22 Nov 2026 (research thread): the owner approved, each as a separate paper strategy: out by 1:30 AM IST (BTC, ETH daily), 0.5 % away in the evening (BTC, ETH daily), the late BTC entry two hours before settlement; passed to the build thread. Bundles: different strategies per risk appetite. Wings on the dailies run.
- 22 Nov 2026 (research thread): the owner approved the profit lock as a separate paper strategy on BTC (passed to the build thread), asked for more explanation of the 1:30 AM exit and the bundles, and said to commit and push. A fact-check of sections 7 and 8 found five overstated lines, corrected. Backlog 6 run.
- 22 Nov 2026 (research thread): the build thread is building the ladder (per-part steps, presets early / standard / late); card figures sent from `results-exits-*` line 149. Backlog 14 (risk bundles) added and a first pass run; `study_exits.py` made importable (same output).
- 22 Nov 2026 (research thread, branch `research/exits`): backlog 1 to 4 run with the new `study_exits.py` on BTC, ETH and Gold daily and BTC weekly (`results-exits-*-2026-11-22.txt`, `results-exits-early-out-2026-11-22.txt`). Reported to the owner; nothing approved yet.
- 22 Nov 2026: lab started. Entry hours, half-then-trail and scale-out tables written (`results-entry-hours-*`, `results-half-then-trail-*`, `results-scale-out-*`). Gold restudied on its own settlement time.
