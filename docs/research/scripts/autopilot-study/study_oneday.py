"""The weekly strangle held for one day only (found in results-exits-BTC-weekly-2026-11-22.txt, "out 144 h before":
the first 20 hours of the Friday weekly were positive on 86 % of the weeks). Here the same one-day hold is tried from
every evening of the week: the Friday weekly's strangle is sold at the hour given and closed a number of hours later,
whatever the result, with and without a stop on each sold option. One row per call; loop the entry hour outside.
Same trades, fees and fills as study_exits.py (imported; run without -I from this folder).

Usage: python study_oneday.py <cache_dir> <lot_size> <bar_minutes> <entry_hours_before> <percent_away> "" "" <label> <hours held>"""
import sys, datetime as dt
import study_exits as X

LABEL, HOLD = sys.argv[8], float(sys.argv[9])


def st(vals_e):
    vals = [v for _, v in vals_e]
    n = len(vals)
    mid = sorted(e for e, _ in vals_e)[n // 2]
    cum = peak = dd = 0.0
    for v in vals:
        cum += v
        peak = max(peak, cum)
        dd = max(dd, peak - cum)
    return f"n={n:3d} mean={sum(vals) / n:+8.2f} win={100 * sum(1 for v in vals if v > 0) / n:3.0f}% total={sum(vals):+7.0f} worst={min(vals):+8.1f} worst3={sum(sorted(vals)[:3]):+8.1f} drawdown={-dd:+8.1f} halves {sum(v for e, v in vals_e if e < mid):+.0f} / {sum(v for e, v in vals_e if e >= mid):+.0f}"


prem = sum(tr.credit for _, tr in X.trades) / len(X.trades)
print(f"## {LABEL}: sold {X.PCT * 100:g} % away {X.ENTRY:g} h before the settlement, closed {HOLD:g} h later ({X.ENTRY - HOLD:g} h before); mean premium {prem:.1f}")
for name, mult in (("no stop", None), ("stop at double", 2), ("stop at triple", 3)):
    rows = [(e, tr.run(mult=mult, t_exit=tr.settle - dt.timedelta(hours=X.ENTRY - HOLD))) for e, tr in sorted(X.trades, key=lambda x: x[0])]
    print(f"   {name:16s} {st(rows)}")
