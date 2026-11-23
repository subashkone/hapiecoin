"""The target with trail, switched on only late in the trade (from the paper review of 23 Nov 2026: a brief dip nine
hours before settlement closed the half-then-trail trades at 40 % of a premium that then went to zero). The trail
(arm at 50 % of the premium, give back 20 % of the best) and the fixed lock 50 > 25 are judged only from a number of
hours before settlement; before that only the stop on each sold option acts. The best profit is counted from the
moment the rule switches on. Same trades, fees and fills as study_exits.py (imported; run without -I from this folder).

Usage: python study_late_trail.py <cache_dir> <lot_size> <bar_minutes> <entry_hours_before> <percent_away> "" "" <label> <stop multiple> <hours before settlement, comma>"""
import sys, datetime as dt
import study_exits as X

LABEL, MULT = sys.argv[8], int(sys.argv[9])
HOURS = [float(x) for x in sys.argv[10].split(",")]


def run(tr, trail=None, lock=None, hours=None):
    start = tr.t0 if hours is None else tr.settle - dt.timedelta(hours=hours)
    live, realised, t, floor, best, stopped = list(range(len(tr.legs))), -tr.fee_in, tr.t0 + X.BAR, None, None, False
    while t <= tr.last_b and live:
        sp = tr.spot.get(t, tr.settle_spot)
        px = {i: tr.series[i].get(t) for i in live}
        for i in list(live):
            if px[i] is not None and px[i] >= MULT * tr.entry[i]:
                realised += -(px[i] - tr.entry[i]) * X.Q - X.fee(sp, px[i])
                live.remove(i)
                stopped = True
        if t >= start and live and all(px[i] is not None for i in live):
            rest = sum(-(px[i] - tr.entry[i]) * X.Q for i in live)
            total = (realised + tr.fee_in + rest) / tr.credit
            close = False
            if lock is not None:
                if total >= lock[0]:
                    floor = lock[1]
                close = floor is not None and total <= floor
            if trail is not None and (best is not None or total >= trail[0]):
                best = total if best is None else max(best, total)
                close = close or total <= best * (1 - trail[1])
            if close:
                return realised + rest - sum(X.fee(sp, px[i]) for i in live), "rule"
        t += X.BAR
    return realised + sum(tr.settle_leg(i) for i in live), ("leg stop" if stopped else "settlement")


def line(name, **kw):
    rows = [(e, *run(tr, **kw)) for e, tr in sorted(X.trades, key=lambda x: x[0])]
    vals = [r[1] for r in rows]
    n = len(vals)
    mid = sorted(r[0] for r in rows)[n // 2]
    cum = peak = dd = 0.0
    for v in vals:
        cum += v
        peak = max(peak, cum)
        dd = max(dd, peak - cum)
    h = f"{sum(r[1] for r in rows if r[0] < mid):+.0f} / {sum(r[1] for r in rows if r[0] >= mid):+.0f}"
    print(f"   {name:52s} {n:4d} {sum(vals) / n:+8.2f} {100 * sum(1 for v in vals if v > 0) / n:4.0f}% {sum(vals):+8.0f} {min(vals):+8.1f} {-dd:+9.1f} {h:>14s}   {sum(1 for r in rows if r[2] == 'rule'):3d}")


print(f"## {LABEL}: {len(X.trades)} trades, each side {X.PCT * 100:g} % away, entered {X.ENTRY:g} h before settlement, stop {MULT}x on each sold option in every row")
print(f"   {'':52s} {'n':>4s} {'mean':>8s} {'win':>5s} {'total':>8s} {'worst':>8s} {'drawdown':>9s} {'halves':>14s}   rule exits")
line("the stop only, held to settlement")
line("trail 50 / 20, from the entry", trail=(0.5, 0.2))
for h in HOURS:
    line(f"trail 50 / 20, only in the last {h:g} h", trail=(0.5, 0.2), hours=h)
line("lock 50 > 25, from the entry", lock=(0.5, 0.25))
for h in HOURS:
    line(f"lock 50 > 25, only in the last {h:g} h", lock=(0.5, 0.25), hours=h)
print()
