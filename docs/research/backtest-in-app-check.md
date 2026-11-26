# The backtest in the app, checked against the research figures (26 November 2026)

ADR-144 point 5 asks that the app's own backtest reproduce the typed figures of a few built-in strategies before a
button offers it. This is that check. Paper arithmetic only: public prices were read, nothing was placed.

## The answer

On the three strategies tried, the app's aggregate figures agree with the research scripts': the average result is
within 13 % (13 % under, 3 % under, 5 % over), the share of winning trades within one point, the number of trades the
same. The worst single trade differs by 10 to 21 dollars; whether it is the same trade in both was not compared.

No margin was set before the runs, so "within 13 %" is what was found, not a bar that was cleared. The owner decides
whether it is close enough to offer the button.

| Strategy (BTC, 100 lots) | Period of entries | | Average | Winning trades | Worst trade | Trades |
|---|---|---|---|---|---|---|
| Evening strangle, stop at 3x (`evening-strangle-stop-3x`) | 7 Aug to 20 Nov 2026 | Research | $12.00 a day | 61 % | -$98.00 | 106 |
| | | App | $10.48 a day | 60.4 % | -$108.27 | 106 |
| Evening strangle, buy back at $5 (`evening-strangle-buy-back`) | 7 Aug to 20 Nov 2026 | Research | $11.30 a day | 66 % | -$106.30 | 106 |
| | | App | $10.95 a day | 66 % | -$94.82 | 106 |
| Friday weekly strangle, stop at 3x (`weekly-fri-strangle-stop-3x`) | 28 Nov 2025 to 13 Nov 2026 | Research | $40.65 a week | 57 % | -$168.00 | 51 |
| | | App | $42.77 a week | 56.9 % | -$189.26 | 51 |

All figures are in USD after the exchange's fees. The research figures are the ones typed in
`packages/pricing/src/playbooks.ts` from `docs/research/scripts/autopilot-study`. The daily runs used 5-minute mark
prices, the weekly run hourly ones, as the research did. The comparison is of these four figures only: the trades were
not compared one by one.

## How it was run

- Each built-in strategy was copied with "Copy as my own" in the admin screen by a throwaway admin, saved as a draft
  (never published), and backtested through `POST /v1/admin/autopilot-strategies/{id}/backtests` on the local stack
  over the period the research covered. The drafts were deleted afterwards and the throwaway admin deactivated.
- The prices came from Delta Exchange India's public candle history (`MARK:` series), downloaded once and kept: 570
  series, about 2.4 MB, after three rounds. The first daily run took 90 seconds; a repeat takes about 10.
- No bar of any of the 212 daily or 51 weekly trades was skipped for a missing price.

## What the check found and changed

The first round was short by 6 trades on one daily strategy and 3 on the other. On those days the price had moved
several per cent after the noon recording of the chain. Example: on 19 August 2026 the chain recorded at 12:00 UTC
ended at the 66,200 strike with the price at 64,486; by the 16:00 entry the price was 68,534, and the exchange had
started pricing the 68,600, 69,000 and 69,200 calls at about 15:30. The run could not see them, so it dropped the day.
Those are the days with the largest moves, so dropping them flattered the figures:

| Round | Stop at 3x: average, trades | Buy back at $5: average, trades |
|---|---|---|
| 1, recorded strikes only | $12.48 a day, 100 | $12.12 a day, 103 |
| 2, strikes priced beyond the recording added by distance | $11.13 a day, 105 | $10.95 a day, 106 |
| 3, strikes counted for a leg "n strikes out", an entry tried again on the next bar | $10.48 a day, 106 | $10.95 a day, 106 |

The fix: where the price has moved towards or past an end of the recorded strikes, the run looks beyond that end for
strikes the exchange was pricing at the entry instant, on the grid the nightly chain history walks, and takes only
those that had a price then. The last trade it recovered (20 November, a day the price fell 4 % after the recording)
lost $58.02.

The fix was made on the same 106 days it is then measured on. It was not tuned to the figures (it changes which
strikes are on offer, by a rule, and nothing else), but an independent period has not been run.

## What still differs, and why

- **Entry instant.** The app enters on the 16:00 UTC bar; the research scripts enter at their own instant in the
  window. Prices a few minutes apart give slightly different premiums.
- **Which strikes are on offer.** The app counts "three strikes out" on the strikes it knows (recorded, and priced
  beyond the recording); the research scripts have their own way to find strikes. On 20 November the app's put was
  58,000 with the price at 59,442.
- **A stop is seen on a bar.** Both step through bars, and a stop is booked at the bar's price.
- **A bar with a missing leg price** is skipped whole by the app, as the live engine does; the research judges a leg
  stop on that leg's own bar. It did not occur in these runs.
- **Strikes listed inside the recorded range** after the recording are still not seen by the app.

## What this does and does not show

It shows that on sold BTC strangles with a stop, with a buy-back, daily and weekly, the app's four headline figures
come out close to the research's. It does not cover: strategies with a profit take, steps, a lock or a trail; legs by
premium; one side after a move; bought structures with whole-trade exits; ETH and Gold; the monthly expiry. Those
paths are tested on made-up prices and against the live rules engine (`clock-sim-parity.test.ts`), not against
research figures. The figures of a run say their own limits every time.
