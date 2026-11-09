# Empirical verification on Delta Exchange data: trend following, hero-or-zero, mean reversion (8 November 2026)

Researcher notes for the report writer. Everything below was computed in this session from the exchange's public candle history; nothing was taken from literature. Where a number is quoted it comes from a script run listed under "Cited Findings" (the "source" is the script, its command and the output file). Nothing in the HapieCoin app was changed and nothing was committed. All scripts, caches and raw outputs live in `C:\Users\localPC\AppData\Local\Temp\claude\e--Subash-Projects-HapieCoin\aded2ca6-cb54-4f65-afc7-ca2d41aab19b\scratchpad\verify\` (referred to below as `verify\`).

## What data and method were used, and what do the fee and funding assumptions rest on?

### Takeaway
Daily and hourly BTC/ETH history came from two public, read-only Delta endpoints (global `api.delta.exchange` for 2019-2023, India `api.india.delta.exchange` from its launch in December 2023 onward, spliced), the 90 daily-option expiries from the existing 5-minute MARK cache of the earlier backtest, and the funding rate from the exchange's own `FUNDING:` symbol; fees were read off the exchange's product list and fee page, not assumed.

### Cited Findings
- Endpoint: `GET https://api.india.delta.exchange/v2/history/candles?symbol=...&resolution=...&start=<unix s>&end=<unix s>` returns `{"success":true,"result":[{time,open,high,low,close,volume},...]}`. Resolutions `1m, 5m, 15m, 1h, 4h, 1d, 1w` were all accepted (each returned `success:true`; the 2020 window was empty because the India exchange did not exist then). At most 4,000 rows come back per request, so hourly history was paged backwards in 3,900-bar windows. — [`verify\scripts\probe.py`, `verify\scripts\dl.py`; run `python -I scripts/probe.py`]
- India history depth (checked 8 Nov 2026): `BTCUSD` daily from 2023-12-29 (1,045 candles to 2026-11-07), `MARK:BTCUSD` daily from 2023-12-18 (1,056), `ETHUSD` daily from 2024-02-06 (1,006), `MARK:ETHUSD` from 2024-02-05 (1,007); `BTCUSD` hourly from 2023-12-29 13:00 UTC (25,067 bars, no gaps); `MARK:BTCUSD` hourly from 2023-12-18 (25,331 bars). The product record shows `launch_time 2023-12-18T13:10:39Z`. So the India exchange alone cannot reach 2020. — [`verify\scripts\fetch_daily.py` output; `curl https://api.india.delta.exchange/v2/products/BTCUSD`]
- Global Delta (`https://api.delta.exchange/v2/history/candles`, same exchange group, public): `BTCUSD` and `MARK:BTCUSD` daily from 2019-04-03 (2,776 candles), `ETHUSD` from 2021-11-02 (1,832). Its perp and mark closes agree with each other to 0.02-0.07 % mean absolute difference per year in 2019-2023. — [`verify\scripts\probe_global.py`, `verify\scripts\dl.py` runs into `verify\cache\daily_global\`]
- Global feed defect: the global `BTCUSD` series freezes at 67,850.25 with zero volume from late May 2026 (daily candles flat from 2026-02-21 onwards in runs; hourly ends 2026-05-29 11:00). Against India it differs by 8.2 % on average in 2026 and up to 21.6 %. It is therefore used only before the India launch. — [`verify\scripts\splice.py` output: "global BTCUSD 1d full: flat 260 zero-volume 260 first run of 3 flat candles: 2026-02-21"]
- India perp defect: the India `BTCUSD` perp has 28 flat daily candles (open=high=low=close, zero volume), all between 2023-12-29 and 2024-01-30, and 871 flat hourly bars (734 of them in January 2024) from thin early trading. The `MARK:BTCUSD` series has none, and tracks the perp close to 0.026 % mean absolute difference on days with volume (max 2.4 %). Parts A and C therefore run on mark closes. — [`verify\scripts\splice.py`; inline check in the session log: "India BTCUSD 1d flat days: [...2023-12-29 .. 2024-01-30]", "India MARK:BTCUSD 1d flat days: 0"]
- Spliced series used (written by `verify\scripts\splice.py` into `verify\cache\spliced\`): `MARK_BTCUSD_1d.json` 2,776 daily candles 2019-04-03 .. 2026-11-07 (global to 2023-12-17, India from 2023-12-18; at the junction the global 17 Dec close of 41,350 meets the India 18 Dec open of 40,962, −0.94 %, a plausible one-day move; the perp series' junction on 29 Dec differs by +0.35 %); `MARK_ETHUSD_1d.json` 1,832 candles 2021-11-02 .. 2026-11-07; `MARK_BTCUSD_1h.json` 66,618 hourly candles 2019-04-03 06:00 .. 2026-11-07 23:00, no gaps (junction +0.04 %). Year-end closes in the spliced BTC series: 2020 28,970; 2021 46,198; 2022 16,524; 2023 42,291; 2024 93,546; 2025 87,618; last (7 Nov 2026) 75,836. — [`verify\scripts\splice.py` output]
- Funding: the candle endpoint serves a `FUNDING:BTCUSD` / `FUNDING:ETHUSD` symbol whose value is the funding rate in percent per 8 hours (median exactly 0.01, which is the exchange's 0.01 % default; the product list shows `annualized_funding 10.95`, `rate_exchange_interval 28800`, `funding_clamp_value 0.05`). On the India feed the value changes only at 00:00, 08:00 and 16:00 UTC (460/473/460 changes), confirming three 8-hour windows a day. Downloaded at 4 h resolution: India BTC 6,333 rows from 2023-12-18, ETH 6,039 rows from 2024-02-05; global BTC 16,655 rows from 2019-04-03, ETH 10,989 rows from 2021-11-02; spliced the same way as prices. Actual funding was used, not the 0.01 % assumption. Mean rate by year (BTC, %/8 h, implied annual cost of a long): 2020 0.0065 (7.1 %/yr), 2021 0.0193 (21.2 %), 2022 −0.0014 (−1.6 %), 2023 0.0061 (6.7 %), 2024 0.0112 (12.2 %), 2025 0.0074 (8.1 %), 2026 0.0073 (8.0 %). — [`verify\scripts\dl.py` runs into `verify\cache\funding\`; inline check in the session log]
- Perp fee: the India product record for `BTCUSD` gives `taker_commission_rate 0.0005`, `maker_commission_rate 0.0002`, and the fee pages (`https://www.delta.exchange/fees` and `https://india.delta.exchange/fees`, fetched 8 Nov) show taker 0.05 %, maker 0.02 %, "GST is added on top of the trading fee", and "Settlement fee applies to all open contracts at the time of settlement (Taker Fees will be charged)". Part A and C cost model: 0.05 % taker + 0.02 % slippage = 0.07 % per side per unit of position change (a long-to-short flip costs two units), GST not added on the perp side (stated simplification, it would add 18 % of the 0.05 %). — [`curl .../v2/products/BTCUSD`; `curl -L https://india.delta.exchange/fees`]
- Option fee rule (as already verified for the exchange in `docs/research/backtest-daily-structures.md` §1 and re-used unchanged): taker 0.01 % of notional per fill capped at 3.5 % of the premium, plus 18 % GST; the same taker fee on the open leg at settlement, which is zero when the option settles worthless because the cap applies to a zero premium. — [`verify\scripts\hero.py` `fee()`; `E:\Subash\Projects\HapieCoin\docs\research\scripts\paper-timing\sim.py` lines 15 and 29-30]
- Option data: the 5-minute `MARK:` cache of the earlier backtest (90 BTC daily expiries 2026-08-08 .. 2026-11-05, 6,724 symbol-day files of which 5,448 non-empty, 190 MB) was copied from the earlier session's scratchpad into `verify\cache\options\` and used read-only; no new option requests were needed, because every strike Part B asks for already had a cached file (1,453 present with data, 167 cached as empty because the exchange never listed that strike for that expiry). — [`verify\scripts\hero_missing.py` output: "needed symbol-days present 1453 cached-empty 167 missing 0"]
- Request budget actually used this session: about 100 public requests in total (daily series 12, hourly paging 44, funding 13, probes about 30), all throttled to under 4 a second with the retry pattern of `docs/research/scripts/paper-timing/fetch.py`. — [`verify\scripts\dl.py` prints "requests N" per run]
- Commands run (from `verify\`): `python -I scripts/fetch_daily.py cache/daily`; `python -I scripts/dl.py global BTCUSD 1d 2019-01-01 2026-11-08 cache/daily_global/BTCUSD_1d.json` (and likewise `ETHUSD`, `MARK:BTCUSD`, `MARK:ETHUSD`, `FUNDING:BTCUSD`, `FUNDING:ETHUSD`); `python -I scripts/dl.py india BTCUSD 1h 2023-12-01 2026-11-08 cache/hourly/india_BTCUSD_1h.json`; `python -I scripts/dl.py india MARK:BTCUSD 1h 2023-12-01 2026-11-08 cache/hourly/india_MARK_BTCUSD_1h.json`; `python -I scripts/dl.py global MARK:BTCUSD 1h 2019-01-01 2023-12-29 cache/hourly/global_MARK_BTCUSD_1h.json`; `python -I scripts/dl.py india FUNDING:BTCUSD 4h 2023-12-01 2026-11-08 cache/funding/india_FUNDING_BTCUSD_4h.json` (and ETH, and `global` from 2019/2021); `python -I scripts/splice.py cache`; `python -I scripts/hero_missing.py cache/options`; `python -I scripts/trend.py cache/spliced/MARK_BTCUSD_1d.json cache/spliced/FUNDING_BTCUSD_4h.json 2020-01-01 "<label>"` (`> out_trend_btc.md`), the same with `MARK_ETHUSD` / `FUNDING_ETHUSD` and `2022-08-01` (`out_trend_eth.md`), both again with `2024-01-01` (`out_trend_btc_2024.md`, `out_trend_eth_2024.md`), and with a trailing `sweep` argument (`out_sweep_btc.md`, `out_sweep_eth.md`); `python -I scripts/hero.py cache/options > out_hero.md`; `python -I scripts/hero_check.py cache/hero-result.json`; `python -I scripts/meanrev.py cache/spliced/MARK_BTCUSD_1h.json cache/spliced/FUNDING_BTCUSD_4h.json "<label>" > out_meanrev_full.md`; `python -I scripts/meanrev.py cache/hourly/india_MARK_BTCUSD_1h.json cache/funding/india_FUNDING_BTCUSD_4h.json "<label>" > out_meanrev_india.md`.

### Inferences
- A 2020-to-date test of trend rules is possible only by splicing the global exchange's history in front of the India exchange's; the two are the same product family on the same index (perp and mark within 0.1 %), so the splice is defensible, but it is a splice and should be described as such.
- The exchange's own funding history makes the "0.01 % per 8 h" assumption unnecessary; the actual mean was close to it in 2024-2026 (8-12 %/yr) and far above it in 2021 (21 %/yr).

### Gaps
- GST on perp fees was not added (would raise the 0.05 % to 0.059 %); the slippage figure of 0.02 % per side is an assumption, not measured.
- Whether the funding candle's value at hour H is the rate paid at H or the rate for the window starting at H was not confirmed; the daily sum of three values is unaffected except for a one-window shift.

## Part A: does time-series momentum / trend following work on BTC and ETH in this data?

### Takeaway
Long/flat trend rules with a medium lookback (SMA 40-70, SMA 100-150, 12-1 momentum) beat buy-and-hold on a risk-adjusted basis for BTC over 2020-2026 after fees, slippage and actual funding (Sharpe 0.87-1.22 versus 0.73, maximum drawdowns 30-62 % versus 77 %), and the MA sweep shows two broad plateaus rather than one lucky peak; for ETH over Aug 2022-2026 only SMA lengths around 40-60 (Sharpe 0.6-0.7) and 130-200 (about 0.5) clearly beat buy-and-hold's 0.29, 12-1 momentum lost 65 %, and long/short versions mostly lose. 2022 and 2025-2026 were losing or flat years for most rules on BTC.

### Cited Findings
Method for this part: signal on the daily mark close t, position held from close t to close t+1; "gross" is price return only; "fees+slip" charges 0.07 % per side per unit of position change; "fees+slip+funding" additionally pays (receives) the actual 8-hour funding three times a day when long (short). Sharpe uses daily returns, annualised by sqrt(365), zero risk-free rate. CAGR uses 365.25-day years. Evaluation from 2020-01-01 for BTC and 2022-08-01 for ETH (both at least 252 days after the first candle so SMA 200 and 12-1 momentum are warmed up on real data; the 2022 ETH column is therefore August-December only). Buy-and-hold is evaluated over the same window. Trades count every position change. Long/short "time in market" is 100 % by construction. — [`verify\scripts\trend.py`; outputs `verify\out_trend_btc.md`, `verify\out_trend_eth.md`]

- BTC 2020-01-01 .. 2026-11-07 (2,776 candles in the file, about 2,500 evaluated days), after fees, slippage and actual funding — [`verify\out_trend_btc.md`]:

| Rule | Mode | Total | CAGR | Vol | Sharpe | MaxDD | Trades | Time in mkt | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 (to 7 Nov) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Buy & hold | long | +478 % | +29.2 % | 60 % | 0.73 | −77 % | 1 | 100 % | +277 % | +29 % | −64 % | +139 % | +96 % | −14 % | −19 % |
| SMA 20 | long/flat | +170 % | +15.6 % | 40 % | 0.56 | −71 % | 296 | 53 % | +161 % | −5 % | −45 % | +46 % | +49 % | −17 % | +9 % |
| SMA 20 | long/short | −68 % | −15.5 % | 60 % | 0.02 | −91 % | 297 | 100 % | +30 % | −50 % | −38 % | −17 % | +0 % | −29 % | +33 % |
| SMA 50 | long/flat | +1,240 % | +46.1 % | 41 % | 1.12 | −59 % | 136 | 55 % | +268 % | +80 % | −51 % | +127 % | +62 % | +1 % | +12 % |
| SMA 50 | long/short | +730 % | +36.2 % | 60 % | 0.81 | −65 % | 137 | 100 % | +160 % | +87 % | −53 % | +103 % | +22 % | +5 % | +39 % |
| SMA 200 | long/flat | +296 % | +22.3 % | 43 % | 0.68 | −66 % | 59 | 59 % | +147 % | −36 % | +0 % | +82 % | +64 % | −22 % | +8 % |
| SMA 200 | long/short | −21 % | −3.3 % | 60 % | 0.24 | −88 % | 60 | 100 % | +15 % | −74 % | +84 % | +35 % | +29 % | −33 % | +25 % |
| TSMOM 12-1 | long/flat | +1,043 % | +42.7 % | 48 % | 0.98 | −53 % | 59 | 69 % | +239 % | +20 % | +21 % | +55 % | +88 % | −13 % | −9 % |
| TSMOM 12-1 | long/short | +801 % | +37.8 % | 60 % | 0.83 | −64 % | 59 | 100 % | +107 % | +10 % | +197 % | −3 % | +80 % | −12 % | −13 % |
| Donchian 20 | long/flat | +533 % | +30.9 % | 42 % | 0.85 | −61 % | 78 | 56 % | +340 % | +10 % | −46 % | +82 % | +56 % | −12 % | −3 % |
| Donchian 20 | long/short | +95 % | +10.3 % | 60 % | 0.46 | −75 % | 79 | 100 % | +272 % | −30 % | −37 % | +28 % | +12 % | −20 % | +5 % |

- The same BTC rules gross (no costs) and with fees+slip only, for the cost attribution — [`verify\out_trend_btc.md`]: buy-and-hold gross CAGR +41.1 % / Sharpe 0.88 (fees change nothing, funding takes it to +29.2 % / 0.73); SMA 50 long/flat gross +60.7 % / 1.35, fees+slip +58.5 % / 1.32, with funding +46.1 % / 1.12; TSMOM 12-1 long/flat gross +55.9 % / 1.17, fees+slip +55.0 % / 1.15, with funding +42.7 % / 0.98; SMA 20 long/flat gross +28.2 % / 0.81, fees+slip +24.3 % / 0.74 (296 trades, the most fee-sensitive), with funding +15.6 % / 0.56; SMA 200 long/flat gross +33.6 % / 0.89, with funding +22.3 % / 0.68; Donchian 20 long/flat gross +42.3 % / 1.04, with funding +30.9 % / 0.85.
- Funding is the dominant cost for a long-biased daily rule: it removes 9-12 CAGR points from every long/flat rule and from buy-and-hold (the 2021 funding alone cost a permanent long about 21 % that year), while fees and slippage at 59-137 trades over 6.85 years remove 1-2 points (4 points for SMA 20's 296 trades). — [derived from the gross versus net rows above]
- Years that broke the rules on BTC: 2022 (SMA 20/50 long/flat −45 % / −51 %, Donchian −46 %; only SMA 200 at 0 % long/flat and +84 % long/short, and the 12-1 momentum rules, +21 % long/flat and +197 % long/short, survived it) and 2025-2026 (every long/flat rule between −22 % and +1 % in 2025; in 2026 to 7 Nov the SMA 20/50/200 rules made +8 to +12 % while buy-and-hold lost 19 %, and the momentum and Donchian rules lost 3-9 %). The long/short versions of SMA 20 and SMA 200 lost money overall (−68 % and −21 % total, Sharpe 0.02 and 0.24) and Donchian long/short made +95 % against +533 % for its long/flat form. — [`verify\out_trend_btc.md` yearly columns]
- BTC MA-length sweep, long/flat and long/short, after fees, slippage and funding, 2020-2026 — [`verify\out_sweep_btc.md`]:

| MA length | L/F Sharpe | L/F CAGR | L/F MaxDD | L/S Sharpe | L/S CAGR |
|---|---|---|---|---|---|
| 10 | 0.54 | +14.5 % | −70 % | −0.02 | −17.1 % |
| 20 | 0.56 | +15.6 % | −71 % | 0.02 | −15.5 % |
| 30 | 0.84 | +29.7 % | −55 % | 0.40 | +6.6 % |
| 40 | 1.22 | +51.6 % | −50 % | 0.93 | +46.0 % |
| 50 | 1.12 | +46.1 % | −59 % | 0.81 | +36.2 % |
| 60 | 1.03 | +40.9 % | −62 % | 0.69 | +26.6 % |
| 70 | 0.92 | +35.0 % | −56 % | 0.56 | +17.0 % |
| 80 | 0.81 | +28.6 % | −53 % | 0.40 | +6.3 % |
| 90 | 0.78 | +26.7 % | −53 % | 0.34 | +2.8 % |
| 100 | 0.87 | +32.1 % | −41 % | 0.49 | +12.0 % |
| 110 | 1.08 | +44.5 % | −30 % | 0.79 | +34.4 % |
| 120 | 1.02 | +41.1 % | −33 % | 0.71 | +28.1 % |
| 130 | 0.98 | +38.9 % | −36 % | 0.66 | +24.2 % |
| 140 | 0.93 | +35.5 % | −42 % | 0.58 | +18.2 % |
| 150 | 0.89 | +33.4 % | −46 % | 0.52 | +14.5 % |
| 160 | 0.81 | +28.8 % | −50 % | 0.41 | +6.7 % |
| 170 | 0.86 | +31.6 % | −53 % | 0.48 | +11.5 % |
| 180 | 0.72 | +24.2 % | −64 % | 0.29 | −0.3 % |
| 190 | 0.74 | +25.4 % | −62 % | 0.33 | +1.6 % |
| 200 | 0.68 | +22.3 % | −66 % | 0.24 | −3.3 % |
| 210-250 | 0.60-0.62 | +18.3 to +19.4 % | −64 to −68 % | 0.15-0.18 | −8.6 to −6.8 % |
| 260-300 | 0.65-0.70 | +21.3 to +24.6 % | −65 to −71 % | 0.25-0.41 | −2.7 to +6.8 % |

  Every long/flat length from 30 to 170 beats buy-and-hold's after-funding Sharpe of 0.73; lengths 180-300 fall below it (0.60-0.72) apart from 190 (0.74); and every length from 10 to 300 has a smaller drawdown than buy-and-hold's −77 %. There are two plateaus (40-70 and 100-150) rather than a single spike, with the best single lengths 40 (1.22) and 110 (1.08); the 10-20 lengths are the clear losers (too many trades, 296 for SMA 20). Long/short CAGR is positive for lengths 30-170 and, weakly, at 190 and 290-300, negative at 10-20, 180 and 200-280, and at no length does long/short beat the long/flat version's Sharpe.
- BTC in the India era only (evaluated 2024-01-01 .. 2026-11-07, indicators warmed up on earlier data; about 1,040 days), after all costs — [`verify\out_trend_btc_2024.md`]: buy-and-hold +31 % total, CAGR +9.8 %, Sharpe 0.43, MaxDD −56 %; SMA 50 long/flat +75 %, +21.7 %, 0.76, −29 % (70 trades); SMA 50 long/short +70 %, +20.5 %, 0.63; TSMOM 12-1 long/flat +42 %, +13.2 %, 0.51, −37 % (9 trades); SMA 200 long/flat +32 %, +10.3 %, 0.45; SMA 20 long/flat +34 %, +10.9 %, 0.48 (112 trades); Donchian 20 long/flat +28 %, +9.0 %, 0.43; long/short SMA 20 −1 %, SMA 200 +4 %, Donchian −11 %. In this shorter window every long/flat rule still beat buy-and-hold on Sharpe and drawdown, but only SMA 50 did so by a wide margin.
- ETH 2022-08-01 .. 2026-11-07 (1,832 candles in the file, about 1,560 evaluated days), after fees, slippage and actual funding — [`verify\out_trend_eth.md`]:

| Rule | Mode | Total | CAGR | Vol | Sharpe | MaxDD | Trades | 2022 (Aug-Dec) | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Buy & hold | long | −8 % | −1.8 % | 65 % | 0.29 | −70 % | 1 | −25 % | +76 % | +19 % | −19 % | −28 % |
| SMA 20 | long/flat | −10 % | −2.5 % | 46 % | 0.17 | −49 % | 168 | −25 % | +11 % | +21 % | −6 % | −5 % |
| SMA 20 | long/short | −64 % | −21.4 % | 65 % | −0.05 | −80 % | 168 | −36 % | −36 % | −1 % | −19 % | +7 % |
| SMA 50 | long/flat | +164 % | +25.5 % | 44 % | 0.73 | −39 % | 72 | −23 % | +46 % | +6 % | +82 % | +22 % |
| SMA 50 | long/short | +190 % | +28.3 % | 65 % | 0.71 | −60 % | 72 | −33 % | +15 % | −24 % | +189 % | +72 % |
| SMA 200 | long/flat | +61 % | +11.8 % | 42 % | 0.47 | −41 % | 25 | +0 % | +40 % | +26 % | −7 % | −2 % |
| SMA 200 | long/short | −0 % | −0.1 % | 65 % | 0.32 | −54 % | 26 | +1 % | +7 % | +16 % | −23 % | +3 % |
| TSMOM 12-1 | long/flat | −65 % | −21.7 % | 44 % | −0.34 | −81 % | 55 | +0 % | +18 % | −12 % | −42 % | −42 % |
| TSMOM 12-1 | long/short | −95 % | −50.4 % | 65 % | −0.76 | −96 % | 56 | +1 % | −27 % | −41 % | −70 % | −61 % |
| Donchian 20 | long/flat | −14 % | −3.5 % | 45 % | 0.15 | −61 % | 52 | −46 % | +34 % | −24 % | +27 % | +22 % |
| Donchian 20 | long/short | −68 % | −23.5 % | 65 % | −0.09 | −91 % | 52 | −65 % | −4 % | −61 % | +43 % | +74 % |

  Gross (no costs) the ETH picture is the same in shape: buy-and-hold +7.7 % CAGR / Sharpe 0.44; SMA 50 long/flat +35.9 % / 0.91; SMA 200 long/flat +20.5 % / 0.65; TSMOM 12-1 long/flat −15.3 % / −0.16; SMA 20 long/flat +6.5 % / 0.36; Donchian long/flat +3.9 % / 0.31.
- ETH MA sweep (after all costs, Aug 2022-2026) — [`verify\out_sweep_eth.md`]: long/flat Sharpe by length: 10 −0.13, 20 0.17, 30 0.34, 40 0.61, 50 0.73, 60 0.63, 70 0.37, 80 0.33, 90 0.25, 100 0.30, 110 0.28, 120 0.32, 130 0.51, 140 0.50, 150 0.47, 160 0.39, 170 0.32, 180 0.19, 190 0.46, 200 0.47, 210 0.36, 220 0.39, 230 0.36, 240 0.31, 250 0.29, 260 0.20, 270 0.04, 280 0.04, 290 −0.14, 300 −0.09. Long/flat CAGR is positive for 30-170 and 190-250 and negative at 10-20, 180 and 260-300; long/short CAGR is positive only at 40-60 and 130-150 and below zero everywhere else. The 40-60 plateau is shared with BTC; the 130-200 bump is narrower and weaker; the rest is near or below buy-and-hold's Sharpe of 0.29.
- ETH in the India era only (2024-01-01 .. 2026-11-07), after all costs — [`verify\out_trend_eth_2024.md`]: buy-and-hold −33 %, CAGR −12.9 %, Sharpe 0.13, MaxDD −70 %; SMA 50 long/flat +127 %, +33.2 %, 0.86, −39 % (44 trades); SMA 50 long/short +265 %, +57.5 %, 1.01 (2025 +189 %, 2026 +72 %, from the short side); SMA 200 long/flat +12 %, 0.31; SMA 20 long/flat +5 %, 0.27; Donchian long/flat +15 %, 0.32; TSMOM 12-1 long/flat −71 % and long/short −93 %.

### Inferences
- In this data, trend following's value on BTC is mostly risk control, not extra return: after funding the best rules roughly match or beat buy-and-hold's CAGR (SMA 50 +46 % and TSMOM +43 % against +29 %) while cutting the maximum drawdown from 77 % to 53-59 %; many rules (SMA 20, SMA 200, Donchian) earn less than buy-and-hold in total but with far smaller drawdowns, and all of them did that by being flat for roughly 30-50 % of the time.
- The MA sweep argues against pure overfitting for lengths of 40-150 days on BTC: the Sharpe stays above buy-and-hold across whole bands, not at one length. It also argues against the classic 200-day and against anything under 30 days, which are the two lengths the literature most often quotes for crypto.
- 12-1 momentum is the rule most dependent on the asset: the best rule by drawdown on BTC, the worst of all on ETH (−65 % long/flat, −95 % long/short). Its ETH result comes from being long through ETH's 2025-2026 declines after the 2024 rally and short after the recoveries; the report should not describe TSMOM as a general crypto result from this evidence.
- Long/short trend following is not supported: on BTC only SMA 40-60 and TSMOM long/short came close to their long/flat counterparts, and on ETH only SMA 50 did (helped by 2025-2026 shorts). Shorting a perp also receives funding here, so the result is already flattered on that side.
- The 2022 and 2025-2026 columns show the failure mode plainly: in a year of grinding declines with sharp rallies (2022 for the short MAs, 2025 for everything but SMA 50) the rules whipsaw and lose 12-51 %; what they avoid is the single large crash leg (2022 for SMA 200/TSMOM, 2026 for the SMA rules).

### Gaps
- Only 6.85 years of BTC (one full cycle plus the 2024-2026 range) and 4.3 years of ETH; the ETH window starts after ETH's biggest bull market, so ETH's buy-and-hold baseline is unusually poor and its trend results are not comparable to BTC's.
- No bootstrap or significance test was run; the yearly columns are the only dispersion evidence. With roughly 60-140 trades per rule, differences in Sharpe of 0.2-0.3 between neighbouring lengths are within noise.
- Fills at the daily close and slippage of 0.02 % are assumptions; a perp long also carries liquidation risk that a 1x unlevered model ignores.
- The 2019-2023 part of the series is the global exchange (now defunct for BTCUSD trading), not Delta India; funding in that period was the global exchange's.

## Part B: did buying cheap out-of-the-money BTC daily options on expiry day ("hero or zero") pay, and what did the seller face?

### Takeaway
Across 1,426 option positions on 90 expiries (8 Aug-5 Nov 2026) the buyer's expectancy was negative in total (−$124 after fees on $2,649 of premium, hit rate 2.8 %) and became clearly negative (−$1,189, i.e. −46 % of premium) once a single day (21 September 2026, a +4.5 % rally) is removed; the mirror seller made +$935 excluding that day but on it lost $273 against a $15 credit on one option, so the seller's worst day was 37 to 560 times the average credit.

### Cited Findings
Method for this part: for each expiry, at 02:00, 06:00 and 09:00 UTC (07:30, 11:30, 14:30 IST) the ATM strike is spot rounded to 200, and the call (put) strike is ATM plus (minus) 1, 2 or 3 % of spot rounded to 200; buy 100 lots (0.1 BTC) at the 5-minute mark close at that minute; settle at intrinsic value against the last mark before 12:00 UTC (the 11:55 close); fees as in the method section; the seller is the exact mirror (margin, liquidation and the maker rebate not modelled). A cell is skipped for an expiry when the strike was never listed (the exchange returned no candles) or had no candle at the entry minute. All 90 expiries had a settlement mark. — [`verify\scripts\hero.py`; output `verify\out_hero.md`; per-position JSON `verify\cache\hero-result.json`]

- Coverage: 1 % strikes existed on 88-90 of 90 expiries, 2 % on 78-88, 3 % on only 57-71 (e.g. the 3 % put at 02:00 was missing on 33 expiries, the 3 % call at 06:00 on 23). The exchange does not always list a strike 3 % away on a daily. — [`verify\out_hero.md` first line: missing counts per (hour, moneyness, kind)]
- Realised move from entry to settlement (90 expiries each) — [`verify\out_hero.md` "Realised move"]:

| Entry UTC (IST) | mean abs move | median abs move | > 1 % | > 2 % | > 3 % | up > 1 % | down > 1 % | biggest up | biggest down |
|---|---|---|---|---|---|---|---|---|---|
| 02:00 (07:30) | 0.64 % | 0.50 % | 19 % | 3 % | 2 % | 12 % | 7 % | +4.49 % | −1.91 % |
| 06:00 (11:30) | 0.57 % | 0.41 % | 14 % | 2 % | 2 % | 8 % | 7 % | +3.95 % | −1.99 % |
| 09:00 (14:30) | 0.29 % | 0.21 % | 3 % | 0 % | 0 % | 2 % | 1 % | +1.65 % | −1.43 % |

- Buyer, 100 lots (0.1 BTC), net of fees, hold to settlement — [`verify\out_hero.md` "Buyer"]:

| Entry UTC | OTM | Kind | n | avg premium $ | premium % of spot | hit rate | mean P&L $ | median P&L $ | mean multiple of premium | best $ | worst $ | total $ | days > 0 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 02:00 | 1 % | C | 90 | 7.31 | 0.092 % | 12 % | +1.93 | −5.23 | −0.22x | +269 | −34 | +173 | 11 % |
| 02:00 | 1 % | P | 88 | 6.56 | 0.083 % | 7 % | −5.24 | −5.43 | −0.73x | +59 | −50 | −461 | 5 % |
| 02:00 | 2 % | C | 87 | 2.14 | 0.027 % | 2 % | +0.93 | −1.29 | −0.49x | +198 | −15 | +81 | 2 % |
| 02:00 | 2 % | P | 81 | 2.24 | 0.028 % | 0 % | −2.33 | −1.49 | −1.04x | −0 | −35 | −188 | 0 % |
| 02:00 | 3 % | C | 71 | 0.78 | 0.010 % | 1 % | +0.95 | −0.23 | −0.26x | +123 | −9 | +67 | 1 % |
| 02:00 | 3 % | P | 57 | 0.67 | 0.008 % | 0 % | −0.70 | −0.32 | −1.04x | −0 | −8 | −40 | 0 % |
| 06:00 | 1 % | C | 90 | 3.64 | 0.046 % | 9 % | +2.86 | −2.46 | +0.02x | +238 | −15 | +257 | 8 % |
| 06:00 | 1 % | P | 90 | 3.19 | 0.040 % | 6 % | −1.37 | −2.25 | −0.79x | +76 | −17 | −123 | 4 % |
| 06:00 | 2 % | C | 88 | 0.70 | 0.009 % | 2 % | +2.39 | −0.30 | +1.83x | +163 | −6 | +210 | 2 % |
| 06:00 | 2 % | P | 83 | 0.70 | 0.009 % | 1 % | −0.62 | −0.35 | −1.01x | +6 | −6 | −51 | 1 % |
| 06:00 | 3 % | C | 67 | 0.16 | 0.002 % | 1 % | +1.11 | −0.06 | +3.44x | +85 | −2 | +74 | 1 % |
| 06:00 | 3 % | P | 61 | 0.22 | 0.003 % | 0 % | −0.23 | −0.06 | −1.04x | −0 | −3 | −14 | 0 % |
| 09:00 | 1 % | C | 90 | 0.99 | 0.012 % | 2 % | −0.28 | −0.39 | −0.81x | +40 | −20 | −25 | 2 % |
| 09:00 | 1 % | P | 90 | 0.80 | 0.010 % | 1 % | −0.57 | −0.37 | −1.02x | +7 | −4 | −51 | 1 % |
| 09:00 | 2 % | C | 88 | 0.15 | 0.002 % | 0 % | −0.16 | −0.06 | −1.04x | −0 | −6 | −14 | 0 % |
| 09:00 | 2 % | P | 78 | 0.16 | 0.002 % | 0 % | −0.16 | −0.06 | −1.04x | −0 | −5 | −13 | 0 % |
| 09:00 | 3 % | C | 66 | 0.04 | 0.001 % | 0 % | −0.04 | −0.05 | −1.04x | −0 | −0 | −3 | 0 % |
| 09:00 | 3 % | P | 61 | 0.06 | 0.001 % | 0 % | −0.07 | −0.05 | −1.04x | −0 | −1 | −4 | 0 % |

  "Mean multiple of premium" is the mean over positions of net P&L divided by premium paid; −1.04x means every position lost its whole premium plus the entry fee. "Cheap" here means 0.08-0.09 % of spot for a 1 % OTM option ten hours before settlement (about $7 for 0.1 BTC at an $80,000 spot), 0.01 % for 3 % OTM, and 0.001-0.012 % (4 cents to $1 for 0.1 BTC) at 09:00 UTC, three hours before settlement.
- Buyer totals by entry time, all 18 cells: 02:00 UTC −$368, 06:00 UTC +$354, 09:00 UTC −$110; all −$124 on $2,649 of premium. Calls +$821, puts −$946. — [`verify\out_hero.md` "Totals"; `verify\scripts\hero_check.py` output]
- Concentration: the best buyer day, 2026-09-21 (spot 81,217 at 02:00 UTC, 84,860 at 11:55 UTC, +4.49 %), produced +$1,065 over the 16 option positions entered that day; the top five buyer positions in the whole sample are all 21 Sep calls (82000C bought at $149.83 per BTC, i.e. $14.98 for 0.1 BTC, settled for net +$269 = 18.0x; 82400C +$238 = 36.2x; 82800C +$198 = 30.1x; 83200C +$163 = 101.8x) plus the 20 Aug 70000C (+$185 = 39.4x). Without 21 September the buyer's total is −$1,189 on $2,581 of premium (calls −$272, puts −$918; mean −$0.84 per position; hit rate 2.3 %). — [`verify\scripts\hero_check.py` output]
- Hand check of that position: 02:00 mark 81,217.18, 11:55 mark 84,860.29, 82000C mark at 02:00 149.83; intrinsic 2,860.29; gross (2,860.29 − 149.83) × 0.1 = $271.05; fees entry min(0.0001 × 81,217 × 0.1, 0.035 × 149.83 × 0.1) × 1.18 = $0.62 and settlement min(0.0001 × 84,860 × 0.1, 0.035 × 2,860 × 0.1) × 1.18 = $1.00; net $269.43 as reported. — [inline check in the session log against `verify\cache\options\2026-09-21\MARK_C-BTC-82000-210926.json`]
- Winning days for the 02:00 1 % call buyer (10 of 90): 20 Aug +$137, 21 Aug +$62, 24 Aug +$36, 18 Sep +$58, 21 Sep +$269, 29 Sep +$43, 2 Oct +$47, 9 Oct +$31, 13 Oct +$2, 4 Nov +$34. For the 02:00 1 % put buyer (4 of 88): 14 Aug +$14, 8 Sep +$13, 15 Sep +$21, 22 Oct +$59. — [`verify\scripts\hero_check.py` output]
- Seller (mirror), 100 lots, net of fees, hold to settlement, margin not modelled — [`verify\out_hero.md` "Seller"]:

| Entry UTC | OTM | Kind | n | avg credit $ | win rate (expired worthless) | mean P&L $ | median $ | best $ | worst $ | total $ | max drawdown of running total $ | worst day / avg credit |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 02:00 | 1 % | C | 90 | 7.31 | 88 % | −2.71 | +4.81 | +32 | −273 | −244 | −421 | −37x |
| 02:00 | 1 % | P | 88 | 6.56 | 93 % | +4.65 | +5.00 | +48 | −62 | +409 | −62 | −9.5x |
| 02:00 | 2 % | C | 87 | 2.14 | 98 % | −1.15 | +1.18 | +14 | −201 | −100 | −210 | −94x |
| 02:00 | 2 % | P | 81 | 2.24 | 100 % | +2.15 | +1.37 | +33 | +0 | +174 | 0 | 0 |
| 02:00 | 3 % | C | 71 | 0.78 | 99 % | −1.04 | +0.21 | +8 | −125 | −74 | −125 | −160x |
| 02:00 | 3 % | P | 57 | 0.67 | 100 % | +0.64 | +0.30 | +7 | +0 | +36 | 0 | 0 |
| 06:00 | 1 % | C | 90 | 3.64 | 91 % | −3.28 | +2.27 | +14 | −241 | −295 | −445 | −66x |
| 06:00 | 1 % | P | 90 | 3.19 | 94 % | +1.03 | +2.07 | +16 | −79 | +93 | −79 | −25x |
| 06:00 | 2 % | C | 88 | 0.70 | 98 % | −2.49 | +0.27 | +5 | −165 | −219 | −250 | −236x |
| 06:00 | 2 % | P | 83 | 0.70 | 99 % | +0.55 | +0.32 | +6 | −7 | +46 | −7 | −10x |
| 06:00 | 3 % | C | 67 | 0.16 | 99 % | −1.15 | +0.05 | +2 | −87 | −77 | −87 | −560x |
| 06:00 | 3 % | P | 61 | 0.22 | 100 % | +0.21 | +0.06 | +3 | +0 | +13 | 0 | 0 |
| 09:00 | 1 % | C | 90 | 0.99 | 98 % | +0.15 | +0.36 | +18 | −42 | +14 | −44 | −43x |
| 09:00 | 1 % | P | 90 | 0.80 | 99 % | +0.48 | +0.34 | +4 | −10 | +44 | −10 | −13x |
| 09:00 | 2 % | C | 88 | 0.15 | 100 % | +0.15 | +0.05 | +5 | +0 | +13 | 0 | 0.1x |
| 09:00 | 2 % | P | 78 | 0.16 | 100 % | +0.15 | +0.05 | +4 | +0 | +12 | 0 | 0.1x |
| 09:00 | 3 % | C | 66 | 0.04 | 100 % | +0.04 | +0.05 | +0 | +0 | +3 | 0 | 0.2x |
| 09:00 | 3 % | P | 61 | 0.06 | 100 % | +0.06 | +0.05 | +1 | +0 | +4 | 0 | 0.2x |

  (The 09:00 2-3 % cells show a positive "worst day" because every option expired worthless and the seller kept the credit minus the entry fee; the "best day" there is tiny because credits were 4-16 cents.)
- Seller totals: 02:00 UTC +$202, 06:00 UTC −$440, 09:00 UTC +$88; all −$149 (the two sides do not sum to zero because both pay fees). Seller's worst three positions are all 21 Sep calls: 82000C credit $14.98 → −$273, 82400C $6.58 → −$241, 82800C $6.59 → −$201. Excluding 21 Sep the seller's total is +$935 over 1,410 positions. — [`verify\out_hero.md` "Totals"; `verify\scripts\hero_check.py` output]
- By month, pooled over all cells (mean net P&L per position): Aug (from the 8th) buyer +$0.64 / seller −$0.85 on 390 positions, hit rate 4 %; Sep buyer +$1.07 / seller −$1.25 on 478, 3 %; Oct buyer −$1.59 / seller +$1.41 on 483, 2 %; Nov (5 days) buyer −$1.53 / seller +$1.34 on 75, 1 %. — [`verify\out_hero.md` "By month"]

### Inferences
- Plain verdict on buying: no positive expectancy in this sample. The headline total of −$124 (−4.7 % of premium) hides the structure: the 1,410 positions outside one day lost 46 % of the premium paid, and the one day returned 18-102 times the premium on calls. The buyer's result is a lottery whose single jackpot nearly paid for 89 losing days; whether that is "positive expectancy" depends entirely on how often 4-5 % expiry-day rallies happen, and 90 days contains one.
- Puts lost in every cell at every entry time (total −$946): the sample's large moves were all upward (biggest down move from 02:00 was −1.91 %, never enough to put a 2 % put in the money). The call-versus-put asymmetry is a property of these three months (a rising, then falling but gently, BTC), not a structural finding.
- The 09:00 UTC (14:30 IST) entries are economically dead for both sides: premiums of $0.04-$1 for 0.1 BTC and hit rates 0-2 %, so the buyer loses the whole premium on 98-100 % of days and the seller earns cents for an uncapped liability (the fee itself is small here, 3.5 % of the premium plus GST, because the 0.01 %-of-notional leg of the rule, about $0.80 for 0.1 BTC, only applies when it is the smaller of the two). These cells confirm the earlier finding in `backtest-daily-structures.md` that the 14:00-16:00 IST window is a scalp of the last dollars of decay.
- Plain verdict on selling: a high win rate (88-100 %) with a loss distribution that makes the strategy unpayable without margin modelling: the seller's worst day was 37x the average credit for 1 % calls at 02:00, 94x for 2 % calls, 160x for 3 % calls, and 560x for 3 % calls at 06:00. Over the 90 days the seller of 1 % and 2 % calls at 02:00 and 06:00 UTC lost money in total (−$100 to −$295 per cell) despite winning 88-98 % of days; the seller of puts made money in every cell, for the mirror reason that there was no large down day.

### Gaps
- One regime, 90 expiries, one large up-move; nothing can be said about the frequency of 3 %+ expiry-day moves from this sample. The 2 % and 3 % cells have 0-2 in-the-money events each, so their hit rates are not estimates, they are counts.
- Mark prices are model prices: a 3 % OTM daily option with a $0.16 mark had no bid under it in reality; the buyer's fills would be worse and the seller's credit smaller than modelled. Spreads, the maker rebate, margin, and liquidation are all absent.
- Settlement is approximated by the last 5-minute mark before 12:00 UTC; the exchange settles on an index average (the companion document treats the difference as small).
- Strikes 3 % away were not listed on 21-37 % of expiries, so the 3 % cells are survivorship-filtered towards days when the exchange expected enough range to list them.

## Part C (control): does a simple short-horizon mean-reversion rule on BTC work?

### Takeaway
On hourly BTC mark closes, going long for 24 hours after a 24-hour drop of more than 3 % had a 55-59 % hit rate and a positive gross mean (+0.13 to +0.30 % per trade) but after 0.14 % round-trip costs and funding it was flat to slightly negative in the India era (Sharpe −0.07) and marginal over 2019-2026 (Sharpe 0.31); shorting after a +3 % rise lost money in every variant, and the 48-hour z-score version was worse on both sides; the control is negative to inconclusive.

### Cited Findings
Method for this part: at every hour t, rule 1 fires long when close(t)/close(t−24) − 1 < −3 % and short when > +3 %; rule 2 fires long when the close is more than 2 population standard deviations below its trailing 48-hour mean and short when above. A trade holds exactly 24 hours; no new trade opens while one is open (non-overlapping; the count of all hours with a signal is also shown). Net return per trade = side × 24-hour return − 2 × 0.07 % − side × actual funding over the holding day. Sharpe = mean / standard deviation of net per-trade returns × sqrt(trades per year), zero risk-free. "Sum net" is the simple sum of per-trade returns on 1x notional (not compounded). — [`verify\scripts\meanrev.py`; outputs `verify\out_meanrev_india.md`, `verify\out_meanrev_full.md`]

- India-era BTC mark 1h, 2023-12-18 .. 2026-11-07 (25,331 hourly candles, 2.89 years) — [`verify\out_meanrev_india.md`]:

| Rule | Side | Trades (signals) | Hit rate (gross) | Mean gross / trade | Mean net / trade | Sum net | Sharpe | Worst / best trade | Net by year |
|---|---|---|---|---|---|---|---|---|---|
| 24 h return ±3 % | long after drop | 190 | 57 % | +0.140 % | −0.025 % | −4.8 % | −0.07 | −7.2 % / +7.6 % | 2024 −6 %, 2025 +17 %, 2026 −18 % |
| 24 h return ±3 % | short after rise | 208 | 51 % | −0.077 % | −0.188 % | −39.1 % | −0.64 | −9.7 % / +7.9 % | 2024 −49 %, 2025 +9 %, 2026 +1 % |
| 24 h return ±3 % | both | 398 (4,278) | 54 % | +0.027 % | −0.110 % | −43.9 % | −0.50 | | 2024 −55 %, 2025 +26 %, 2026 −17 % |
| 48 h z-score ±2 | long after drop | 280 | 54 % | +0.151 % | −0.017 % | −4.8 % | −0.06 | −9.5 % / +10.9 % | 2024 +17 %, 2025 +11 %, 2026 −34 % |
| 48 h z-score ±2 | short after rise | 288 | 51 % | −0.109 % | −0.221 % | −63.6 % | −0.98 | −11.0 % / +7.8 % | 2024 −43 %, 2025 −8 %, 2026 −11 % |
| 48 h z-score ±2 | both | 568 (4,361) | 53 % | +0.019 % | −0.120 % | −68.4 % | −0.67 | | 2024 −26 %, 2025 +3 %, 2026 −45 % |

  Unconditional non-overlapping 24-hour returns in the same window: n 1,055, mean +0.086 %, 54 % positive, standard deviation 2.37 %. The long-after-drop gross mean (+0.14 to +0.15 %) is above this baseline; the short-after-rise gross mean (−0.08 to −0.11 %) is below zero, meaning prices kept rising after +3 % days more often than not.
- Full spliced BTC mark 1h, 2019-04-03 .. 2026-11-07 (66,618 hourly candles, 7.60 years) — [`verify\out_meanrev_full.md`]:

| Rule | Side | Trades (signals) | Hit rate (gross) | Mean gross / trade | Mean net / trade | Sum net | Sharpe | Worst / best trade | Net by year |
|---|---|---|---|---|---|---|---|---|---|
| 24 h return ±3 % | long after drop | 607 | 59 % | +0.298 % | +0.144 % | +87.1 % | 0.31 | −23.5 % / +16.6 % | 2019 +11, 2020 +22, 2021 +45, 2022 −6, 2023 +22, 2024 −6, 2025 +17, 2026 −18 (%) |
| 24 h return ±3 % | short after rise | 681 | 52 % | −0.205 % | −0.295 % | −200.7 % | −0.73 | −21.9 % / +13.4 % | 2019 −13, 2020 −119, 2021 −22, 2022 +32, 2023 −39, 2024 −49, 2025 +9, 2026 +1 |
| 24 h return ±3 % | both | 1,288 (15,695) | 55 % | +0.032 % | −0.088 % | −113.5 % | −0.29 | | |
| 48 h z-score ±2 | long after drop | 685 | 53 % | −0.004 % | −0.160 % | −109.3 % | −0.42 | −20.0 % / +14.5 % | 2019 −29, 2020 −35, 2021 +20, 2022 −35, 2023 −26, 2024 +17, 2025 +11, 2026 −34 |
| 48 h z-score ±2 | short after rise | 753 | 51 % | −0.352 % | −0.450 % | −338.8 % | −1.33 | −21.8 % / +15.4 % | 2019 −77, 2020 −83, 2021 −46, 2022 +13, 2023 −83, 2024 −43, 2025 −8, 2026 −11 |
| 48 h z-score ±2 | both | 1,438 (11,478) | 52 % | −0.186 % | −0.312 % | −448.2 % | −1.24 | | |

  Unconditional non-overlapping 24-hour returns 2019-2026: n 2,775, mean +0.152 %, 52 % positive, standard deviation 3.26 %. The 2020 column (−119 % for shorts in one year, 1x notional, simple sum) is the March 2020 crash and the late-2020 rally: shorting +3 % days in a vertical rally.
- The India-era run on the perp series (`BTCUSD` rather than the mark, 25,067 bars) gave the same picture: long after drop 184 trades, 55 %, net −0.034 %/trade, Sharpe −0.10; short after rise 201 trades, 51 %, net −0.232 %, Sharpe −0.78; z-score both 556 trades, net −0.122 %, Sharpe −0.68. — [first `meanrev.py` run in the session log, before switching to mark closes]

### Inferences
- The long-after-drop half of the rule has a real but small gross edge in this data (59 % hit rate and +0.30 % per trade over 7.6 years, versus an unconditional 52 % and +0.15 %), and the costs of a perp round trip plus one day of funding (about 0.15-0.2 %) consume most or all of it. It is a candidate to monitor, not a strategy to trade at taker fees.
- The short-after-rise half is simply wrong for BTC in 2019-2026: large up-days continued more often than they reversed, in 6 of 8 years. Any symmetric mean-reversion rule inherits that loss.
- The z-score version has no edge at all on hourly data; its "both" Sharpe is −0.67 to −1.24 in every window.
- As a control it does what it should: a plausible-looking rule with a 53-55 % hit rate loses after costs, which is the standard to hold the trend and option results to.

### Gaps
- Only ±3 % and ±2 sigma thresholds and a fixed 24-hour hold were tested; no sweep, so "mean reversion fails" is specific to these parameters.
- Per-trade Sharpe annualised by trades-per-year is not comparable to the daily-return Sharpe in Part A.
- The 2019-2023 hourly data is the global exchange's mark; the flat-bar count there (50 in 41,287 bars) was small but not zero.

## Overall verdicts and caveats

### Takeaway
Trend following on BTC: positive (medium lookbacks, long/flat, mostly as drawdown control; two parameter plateaus, not one peak). Trend following on ETH: inconclusive to weakly positive (only SMA 40-60 and 130-200 long/flat positive; 12-1 momentum strongly negative). Hero-or-zero buying: negative (−46 % of premium outside one day, one day decides the sign of the whole sample). Selling the same options: inconclusive and not safely testable without margin (high win rate, worst day 37-560x the credit). Mean reversion control: negative (short side) to inconclusive (long side).

### Cited Findings
- The verdict rests on the numbers in the three sections above, each traceable to `verify\out_trend_btc.md`, `verify\out_trend_eth.md`, `verify\out_sweep_btc.md`, `verify\out_sweep_eth.md`, `verify\out_trend_btc_2024.md`, `verify\out_trend_eth_2024.md`, `verify\out_hero.md`, `verify\cache\hero-result.json`, `verify\out_meanrev_india.md`, `verify\out_meanrev_full.md`, produced by `verify\scripts\trend.py`, `verify\scripts\hero.py`, `verify\scripts\hero_check.py`, `verify\scripts\meanrev.py` on the caches built by `verify\scripts\fetch_daily.py`, `verify\scripts\dl.py`, `verify\scripts\splice.py`, `verify\scripts\hero_missing.py` (which reported no missing option symbols, so it fetched nothing). The earlier backtest's cache and scripts referenced are `E:\Subash\Projects\HapieCoin\docs\research\scripts\paper-timing\fetch.py` and `sim.py` and the method in `E:\Subash\Projects\HapieCoin\docs\research\backtest-daily-structures.md` §1-§2.

### Inferences
- Caveats the report should carry verbatim: (1) mark prices are model prices, there is no bid/ask, so every option fill is optimistic for the buyer and generous to the seller, and perp fills at the close plus 0.02 % slippage are an assumption; (2) no margin, liquidation or maker rebate anywhere; (3) survivorship is not an issue for BTC and ETH themselves, but the option strikes 3 % away exist only on days the exchange chose to list them; (4) the option sample is 90 days in one regime (Aug-Nov 2026) with one large up-move and no large down-move; (5) the BTC trend sample is one cycle (2020-2026) and the ETH sample starts after ETH's main bull market; (6) the pre-2024 data is the global Delta exchange's, spliced in front of Delta India's; (7) funding is the exchange's actual historical rate, which is a strength, but it also means the 2021 result embeds that year's unusually expensive funding; (8) no statistical tests were run, the dispersion evidence is the yearly columns and the parameter sweep.

### Gaps
- Not done, by scope: ETH options, XAUT, weekly or monthly options, intraday trend rules, volatility-scaled position sizing, any out-of-sample split beyond the yearly columns, and any test of the "buy before a scheduled event" variant of hero-or-zero.
