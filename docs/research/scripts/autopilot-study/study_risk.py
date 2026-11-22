"""Risk figures for every exit we have on one sold strangle (strategy lab backlog 14, risk-profile bundles): besides
the mean, the share positive and the worst trade, the worst run of losing trades and the deepest drawdown of the
running total. Same trades, fees and fills as study_exits.py (imported; judged on bar closes; 100 lots a leg).

Usage: python study_risk.py <cache_dir> <lot_size> <bar_minutes> <entry_hours_before> <percent_away> <early exit, hours before settlement, or empty> "" <label>
       (run from this folder, without -I, so that study_exits.py is found; ASCII output, one row per exit)"""
import sys, datetime as dt
import study_exits as X

LABEL = sys.argv[8]
EARLY = X.TIMED[0] if X.TIMED else None
LADDERS = {"early 10/25/40/55/exp": [10, 25, 40, 55, None], "standard 25/50/75/exp": [25, 50, 75, None], "late 50/75/exp": [50, 75, None]}


def ladder(tr, m, steps):
    return sum(tr.run(mult=m, take=None if lv is None else lv / 100) for lv in steps) / len(steps)


variants = [("hold to settlement", lambda tr: tr.hold())]
for m in (2, 3):
    variants += [
        (f"stop {m}x", lambda tr, m=m: tr.run(mult=m)),
        (f"stop {m}x, take half", lambda tr, m=m: tr.run(mult=m, take=0.5)),
        (f"stop {m}x, half then trail 20", lambda tr, m=m: tr.run(mult=m, half_trail=0.2)),
        (f"stop {m}x, lock 50 > 25", lambda tr, m=m: tr.run(mult=m, lock=(0.5, 0.25))),
    ]
    if EARLY is not None:
        variants.append((f"stop {m}x, out {EARLY:g} h before", lambda tr, m=m: tr.run(mult=m, t_exit=tr.settle - dt.timedelta(hours=EARLY) - X.shift)))
    variants += [(f"stop {m}x, ladder {name}", lambda tr, m=m, steps=steps: ladder(tr, m, steps)) for name, steps in LADDERS.items()]

n = len(X.trades)
print(f"## {LABEL}: {n} trades ({X.trades[0][0]} .. {X.trades[-1][0]}), each side {X.PCT * 100:g} % away, entered {X.ENTRY:g} h before settlement, mean premium {sum(tr.credit for _, tr in X.trades) / n:.1f}")
print(f"   {'exit':36s} {'mean':>8s} {'pos':>4s} {'worst':>8s} {'run':>4s} {'run loss':>9s} {'drawdown':>9s} {'total':>8s}  halves")
for name, fn in variants:
    rows = [(e, fn(tr)) for e, tr in X.trades]
    vals = [v for _, v in rows]
    run = run_sum = worst_run = worst_sum = 0
    peak = cum = dd = 0.0
    for v in vals:
        if v <= 0:
            run, run_sum = run + 1, run_sum + v
            worst_run, worst_sum = max(worst_run, run), min(worst_sum, run_sum)
        else:
            run = run_sum = 0
        cum += v
        peak = max(peak, cum)
        dd = max(dd, peak - cum)
    mid = sorted(e for e, _ in rows)[n // 2]
    h1, h2 = sum(v for e, v in rows if e < mid), sum(v for e, v in rows if e >= mid)
    print(f"   {name:36s} {sum(vals) / n:+8.2f} {100 * sum(1 for v in vals if v > 0) / n:3.0f}% {min(vals):+8.1f} {worst_run:4d} {worst_sum:+9.1f} {-dd:+9.1f} {sum(vals):+8.0f}  {h1:+.0f} / {h2:+.0f}")
print()
