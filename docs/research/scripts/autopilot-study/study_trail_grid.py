"""The target with trail on the sold strangle, as a grid (the owner, 23 Nov 2026, relayed by the build thread: "how
optimistically we can set it?"): the trail arms when the whole trade's profit reaches a share of the premium; from
then the exit level is the best profit less a give-back (a share of that best); the trade closes at the first bar
close at or under the level, otherwise it settles. A stop at a multiple of the entry price on each sold option in
every row. Beside it the stop alone and the fixed lock 50 > 25. "slip" is how far under its exit level the average
trail exit filled, in points of the premium; "at level" is the mean had every trail exit filled exactly at its level
(the live engine checks every few seconds, so the truth lies between "mean" and "at level").
Same trades, fees and fills as study_exits.py (imported; run without -I from this folder).

Usage: python study_trail_grid.py <cache_dir> <lot_size> <bar_minutes> <entry_hours_before> <percent_away> "" "" <label> <stop multiple>"""
import sys
import study_exits as X

LABEL, MULT = sys.argv[8], int(sys.argv[9])
ARMS, GIVES = (0.40, 0.50, 0.60, 0.75), (0.10, 0.20, 0.30, 0.40)


def run(tr, arm=None, give=None, lock=None):
    """Returns (result, exit kind, points of the premium the close was under its level)."""
    live, realised, t, floor, best, stopped = list(range(len(tr.legs))), -tr.fee_in, tr.t0 + X.BAR, None, None, False
    while t <= tr.last_b and live:
        sp = tr.spot.get(t, tr.settle_spot)
        px = {i: tr.series[i].get(t) for i in live}
        for i in list(live):
            if px[i] is not None and px[i] >= MULT * tr.entry[i]:
                realised += -(px[i] - tr.entry[i]) * X.Q - X.fee(sp, px[i])
                live.remove(i)
                stopped = True
        if live and all(px[i] is not None for i in live):
            rest = sum(-(px[i] - tr.entry[i]) * X.Q for i in live)
            total = (realised + tr.fee_in + rest) / tr.credit
            level = None
            if lock is not None:
                if total >= lock[0]:
                    floor = lock[1]
                level = floor
            if arm is not None and (best is not None or total >= arm):
                best = total if best is None else max(best, total)
                level = best * (1 - give)
            if level is not None and total <= level:
                return realised + rest - sum(X.fee(sp, px[i]) for i in live), "trail", level - total
        t += X.BAR
    return realised + sum(tr.settle_leg(i) for i in live), ("leg stop" if stopped else "settlement"), None


def line(name, **kw):
    rows = [(e, tr.credit, *run(tr, **kw)) for e, tr in sorted(X.trades, key=lambda x: x[0])]
    vals = [r[2] for r in rows]
    n = len(vals)
    mid = sorted(r[0] for r in rows)[n // 2]
    cum = peak = dd = 0.0
    for v in vals:
        cum += v
        peak = max(peak, cum)
        dd = max(dd, peak - cum)
    k = {x: sum(1 for r in rows if r[3] == x) for x in ("trail", "leg stop", "settlement")}
    slips = [r[4] for r in rows if r[3] == "trail"]
    at_level = sum(r[2] + (r[4] * r[1] if r[3] == "trail" else 0) for r in rows) / n
    h = f"{sum(r[2] for r in rows if r[0] < mid):+.0f} / {sum(r[2] for r in rows if r[0] >= mid):+.0f}"
    print(f"   {name:40s} {n:4d} {sum(vals) / n:+8.2f} {100 * sum(1 for v in vals if v > 0) / n:4.0f}% {sum(vals):+8.0f} {min(vals):+8.1f} {-dd:+9.1f} {h:>14s}   {k['trail']:3d} / {k['leg stop']:3d} / {k['settlement']:3d}" + (f"   {100 * sum(slips) / len(slips):5.1f}   {at_level:+8.2f}" if slips else ""))


print(f"## {LABEL}: {len(X.trades)} trades, each side {X.PCT * 100:g} % away, entered {X.ENTRY:g} h before settlement, stop {MULT}x on each sold option in every row; bars of {int(X.BAR.total_seconds() // 60)} minutes; mean premium {sum(tr.credit for _, tr in X.trades) / len(X.trades):.1f}")
print(f"   {'':40s} {'n':>4s} {'mean':>8s} {'win':>5s} {'total':>8s} {'worst':>8s} {'drawdown':>9s} {'halves':>14s}   exits: trail or floor / a leg stopped, rest settled / settled untouched   slip   at level")
line("the stop only, held to settlement")
line("fixed lock: 50 > 25", lock=(0.50, 0.25))
for arm in ARMS:
    for give in GIVES:
        line(f"trail from {100 * arm:g} %, give back {100 * give:g} % of the best", arm=arm, give=give)
print()
